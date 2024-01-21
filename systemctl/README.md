## Persistent node.js service with `systemctl`

### Service file

- Put `ipns.service` in `/etc/systemd/system/`

### Service Handling

- Start: `systemctl start ipns.service`
- Stop: `systemctl stop ipns.service`

### Verify

- `journalctl -u ipns.service`

FAQ: [Source](https://github.com/natancabral/run-nodejs-on-service-with-systemd-on-linux/)
