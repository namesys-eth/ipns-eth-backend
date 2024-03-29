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
  /// READ
  if (nature === "read") {
    let response = {
      data: {},
    };
    let promises = [];
    let promise = new Promise((resolve, reject) => {
      connection.query(
        `SELECT e.ipns, e.sequence as max_sequence, e.timestamp,
         e.ipfs, e.revision, e.name, e.ens, e.hidden
         FROM events e
         JOIN (
           SELECT ipns, MAX(sequence) as max_sequence
           FROM events
           WHERE timestamp > ${Launch} AND user = '${user}' AND revision != '0x0'
           GROUP BY ipns
         ) subquery
         ON e.ipns = subquery.ipns AND e.sequence = subquery.max_sequence`,
        function (error, results, fields) {
          if (error) {
            console.error("Error reading events from database:", error);
            return;
          }
          const ipnsList = results.map((row) => row["ipns"]);
          const maxSequenceList = results.map((row) => row["max_sequence"]);
          const timestampList = results.map((row) => row["timestamp"]);
          const ipfsList = results.map((row) => row["ipfs"]);
          const revisionList = results.map((row) => row["revision"]);
          const nameList = results.map((row) => row["name"]);
          const ensList = results.map((row) => row["ens"]);
          const hiddenList = results.map((row) => row["hidden"]);
          resolve({
            type: "data",
            data: {
              ipns: ipnsList,
              sequence: maxSequenceList,
              timestamp: timestampList,
              ipfs: ipfsList,
              revision: revisionList,
              name: nameList,
              ens: ensList,
              hidden: hiddenList,
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
    let dataLength = request.ipns.length;
    for (let i = 0; i < dataLength; i++) {
      let ipns = request.ipns[i].split("ipns://")[1];
      let ipfs = request.ipfs[i].split("ipfs://")[1];
      let timestamp = request.timestamp[i];
      let name = request.name[i];
      let ens = request.ens[i];
      let hidden = request.hidden[i];
      let writePath = `${fileStore}/${user}/${ipns}`;
      if (!fs.existsSync(writePath)) {
        mkdirpSync(writePath); // Make repo if it doesn't exist
      }
      // Wrap the database query in a Promise
      const queryPromise = new Promise((resolve, reject) => {
        connection.query(
          `INSERT INTO events (user, timestamp, ipfs, ipns, revision, sequence, name, ens, hidden) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [user, timestamp, ipfs, ipns, "0x0", 0, name, ens || "0", hidden],
          (error, results, fields) => {
            if (error) {
              console.error("Error executing database update:", error);
              reject(error);
            } else {
              response.status = true;
              resolve();
            }
          }
        );
      });
      await queryPromise;
    }
    return JSON.stringify(response);
  }
  /// REVISION
  if (nature === "revision") {
    let response = {
      status: false,
    };
    let dataLength = request.ipns.length;
    for (let i = 0; i < dataLength; i++) {
      let ipns = request.ipns[i].split("ipns://")[1];
      let ipfs = request.ipfs[i].split("ipfs://")[1];
      let name = request.name[i];
      let timestamp = request.timestamp[i];
      let sequence = request.sequence[i];
      let revision = request.revision[i];
      let version = JSON.parse(request.version[i].replace("\\", ""));
      let writePath = `${fileStore}/${user}/${ipns}`;
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
          _sequence[_result.type] =
            _result.data && Number(_result.data) <= Number(sequence) // [!!!]
              ? String(Number(sequence))
              : "0";
        });
      } else {
        _sequence["sequence"] = "0";
      }
      let _revision = new Uint8Array(Object.values(revision)).toString("utf-8");
      // Update DB
      console.log([iterator, ":", "Updating Database..."]);
      connection.query(
        `UPDATE events SET revision = ?, sequence = ? WHERE ipns = ? AND name = ? AND revision = '0x0' AND sequence = '0'`,
        [_revision, _sequence.sequence, ipns, name],
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
    }
    return JSON.stringify(response);
  }
  /// META
  if (nature === "meta") {
    let response = {
      status: false,
    };
    let dataLength = request.ipns.length;
    for (let i = 0; i < dataLength; i++) {
      let ipns = request.ipns[i].split("ipns://")[1];
      let ens = request.ens[i];
      let hidden = request.hidden[i];
      try {
        await new Promise((resolve, reject) => {
          connection.query(
            ens
              ? `UPDATE events SET ens = ? WHERE ipns = ?`
              : `UPDATE events SET hidden = ? WHERE ipns = ?`,
            ens ? [ens, ipns] : [hidden, ipns],
            (error, results, fields) => {
              if (error) {
                console.error("Error executing meta update:", error);
                reject(error);
              } else {
                response.status = true;
                resolve();
              }
            }
          );
        });
      } catch (error) {
        console.error("Error in meta update:", error);
      }
    }
    return JSON.stringify(response);
  }
  /// CLEAN
  if (nature === "clean") {
    let response = {
      status: false,
    };
    let dataLength = request.ipns.length;
    for (let i = 0; i < dataLength; i++) {
      let ipns = request.ipns[i].split("ipns://")[1];
      try {
        await new Promise((resolve, reject) => {
          connection.query(
            `DELETE FROM events WHERE ipns = ? AND revision = '0x0'`,
            [ipns],
            (error, results, fields) => {
              if (error) {
                console.error("Error executing meta reset:", error);
                reject(error);
              } else {
                response.status = true;
                resolve();
              }
            }
          );
        });
      } catch (error) {
        console.error("Error in meta reset:", error);
      }
    }
    return JSON.stringify(response);
  }
}

const url = workerData.url;
const request = JSON.parse(workerData.body);
const iterator = JSON.parse(workerData.iterator);
const res = await handleCall(url, request, iterator);
let callback = res;
parentPort.postMessage(callback);
