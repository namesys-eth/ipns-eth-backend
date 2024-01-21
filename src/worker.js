import { parentPort, workerData } from "worker_threads";
import "isomorphic-fetch";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
import fs from "fs";
require("dotenv").config();
const process = require("process");
const mysql = require("mysql");
const path = require("path");

// Safely make directories recursively 'mkdir -p a/b/c' equivalent
function mkdirpSync(directoryPath) {
  const parts = directoryPath.split(path.sep);
  for (let i = 4; i <= parts.length; i++) {
    const currentPath = "/" + path.join(...parts.slice(0, i));
    console.log([iterator, ":", "Checking DIR: ", currentPath]);
    if (!fs.existsSync(currentPath)) {
      console.log([iterator, ":", "Making DIR:  ", currentPath]);
      fs.mkdirSync(currentPath);
    }
  }
}

const fileStore = "/root/ipns-eth-data";
const Launch = "1704035524"; // ~ 20:42, 31 Dec 2023 IST

const connection = mysql.createConnection({
  host: process.env.MYSQL_HOST,
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE,
});

function logMessage(message) {
  parentPort.postMessage({ type: "log", message: message.join(" ") });
}
console.log = logMessage;

async function handleCall(url, request, iterator) {
  connection.connect((err) => {
    if (err) {
      console.error(
        iterator,
        ":",
        "Error connecting to MySQL database:",
        err.stack
      );
      return;
    }
    console.log([
      iterator,
      ":",
      "Connected to MySQL database as ID:",
      connection.threadId,
    ]);
  });
  let paths = url.toLowerCase().split("/");
  let nature = paths[paths.length - 1];
  let user = request.user;
  let timestamp = request.timestamp;

  /// READ
  if (nature === "read") {
    let response = {
      data: {},
    };
    let promises = [];
    let promise = new Promise((resolve, reject) => {
      connection.query(
        `SELECT ipns, MAX(sequence) as max_sequence, MAX(timestamp) as max_timestamp,
         ipfs, revision
         FROM events 
         WHERE timestamp > ${Launch} AND user = ${user} 
         GROUP BY ipns`,
        function (error, results, fields) {
          if (error) {
            console.error("Error reading events from database:", error);
            return;
          }

          const ipnsList = results.map((row) => row["ipns"]);
          const maxSequenceList = results.map((row) => row["max_sequence"]);
          const maxTimestampList = results.map((row) => row["max_timestamp"]);
          const ipfsList = results.map((row) => row["ipfs"]);
          const revisionList = results.map((row) => row["revision"]);

          resolve({
            type: "data",
            data: {
              ipns: ipnsList,
              sequence: maxSequenceList,
              timestamp: maxTimestampList,
              ipfs: ipfsList,
              revision: revisionList,
            },
          });
        }
      );

      console.log([iterator, ":", "Closing MySQL Connection"]);
      connection.end();
    });
    promises.push(promise);
    let results = await Promise.all(promises);
    results.forEach((result) => {
      response[result.type] = result.data;
    });
    return JSON.stringify(response);
  }
  /// WRITE
  if (nature === "write") {
    let response = {
      status: false,
    };
    let ipns = request.ipns;
    let ipfs = request.ipfs;
    let writePath = `${fileStore}/${user}/${ipns}`;
    let revisionFile = `${writePath}/revision.json`;

    if (!fs.existsSync(writePath)) {
      mkdirpSync(writePath); // Make repo if it doesn't exist
    }

    // Update DB
    console.log([iterator, ":", "Updating Database..."]);
    connection.query(
      `INSERT INTO events (user, timestamp, ipfs, ipns, revision, sequence) VALUES (?, ?, ?, ?, ?, ?)`,
      [user, timestamp, ipfs, ipns, "0x0", "0"],
      (error, results, fields) => {
        if (error) {
          console.error("Error executing database update:", error);
        } else {
          response.status = true;
        }
      }
    );
    return JSON.stringify(response);
  }
  /// REVISION
  if (nature === "revision") {
    let writePath = `${fileStore}/${user}`;
    let response = {
      status: false,
    };
    let ipns = request.ipns;
    let ipfs = request.ipfs;
    let revision = request.revision;
    let version = JSON.parse(request.version.replace("\\", ""));
    let revisionFile = `${writePath}/revision.json`;
    let _sequence = {};

    if (!fs.existsSync(writePath)) {
      mkdirpSync(writePath); // Make repo if it doesn't exist
    }

    // Get history [can also read from database alternatively]
    if (fs.existsSync(revisionFile)) {
      let promises = [];
      let promise = new Promise((resolve, reject) => {
        fs.readFile(revisionFile, function (err, data) {
          if (err) {
            reject(err);
          } else {
            let cache = JSON.parse(data);
            resolve({
              type: "sequence",
              data: cache.sequence,
            });
            cache = {};
          }
        });
      });
      promises.push(promise);
      let _results = await Promise.all(promises);
      _results.forEach((_result) => {
        _sequence[_result.type] = _result.data
          ? String(Number(_result.data) + 1)
          : "0";
      });
    } else {
      _sequence["sequence"] = "0";
    }

    // Update DB
    console.log([iterator, ":", "Updating Database..."]);
    connection.query(
      `UPDATE events SET revision = ?, sequence = ? WHERE ipns = ? AND revision = '0x0' AND sequence = '0'`,
      [revision, ipns, _sequence.sequence],
      (error, results, fields) => {
        if (error) {
          console.error("Error executing database update:", error);
        }
      }
    );

    // Write revision.json
    let promises = [];
    let promise = new Promise((resolve, reject) => {
      fs.writeFile(
        revisionFile,
        JSON.stringify({
          user: user,
          data: revision,
          timestamp: timestamp,
          ipns: ipns,
          ipfs: ipfs,
          sequence: _sequence.sequence,
          version: version,
        }),
        (err) => {
          if (err) {
            reject(err);
          } else {
            console.log([iterator, ":", "Making Revision File..."]);
            response.status = true;
            resolve();
          }
        }
      );
    });
    promises.push(promise);
    await Promise.all(promises);

    // Write version.json
    // Encoded version metadata required by W3Name to republish IPNS records
    promises = [];
    promise = new Promise((resolve, reject) => {
      fs.writeFile(
        `${writePath}/version.json`,
        JSON.stringify(version),
        (err) => {
          if (err) {
            reject(err);
          } else {
            console.log([iterator, ":", "Making Version File..."]);
            response.status = true;
            resolve();
          }
        }
      );
    });
    promises.push(promise);
    await Promise.all(promises);
    return JSON.stringify(response);
  }
}

const url = workerData.url;
const request = JSON.parse(workerData.body);
const iterator = JSON.parse(workerData.iterator);
const res = await handleCall(url, request, iterator);
let callback = res;
parentPort.postMessage(callback);
