# IPNS.eth Backend Service

Backend support for IPNS.eth

## Persistent node.js service with `systemctl`

### Service file

- Put `ipns-eth.service.conf` in `/etc/systemd/system/`

### Service Handling

- Start: `systemctl start ipns-eth.service`
- Stop: `systemctl stop ipns-eth.service`

### Verify

- `journalctl -u ipns-eth.service`

FAQ: [Source](https://github.com/natancabral/run-nodejs-on-service-with-systemd-on-linux/)
