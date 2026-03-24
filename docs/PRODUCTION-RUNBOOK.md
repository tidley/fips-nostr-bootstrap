# Production Runbook (Single Daemon: Relay + STUN + FIPS)

## Overview

This deployment runs all required services on one VPS:

1. **Nostr relay transport** (embedded WS relay on `127.0.0.1:1717`)
2. **STUN server** (UDP `3478`)
3. **FIPS rendezvous node** (UDP `9999`)

Caddy exposes relay transport publicly at `wss://fips.tomdwyer.uk`.

---

## 1) Systemd service

`/etc/systemd/system/fips-stun.service`

```ini
[Unit]
Description=FIPS Daemon (all roles: fips + relay + stun)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=tom
WorkingDirectory=/opt/fips-nostr-bootstrap
Environment=PATH=/home/tom/.nvm/versions/node/v25.8.1/bin:/usr/local/go/bin:/usr/bin:/bin
Environment=STUN_CMD=/usr/local/go/bin/go
Environment=NOSTR_RELAYS=ws://127.0.0.1:1717
Environment=NOSTR_NSEC=<REPLACE_WITH_DAEMON_NSEC>
Environment=FIPS_UDP_PUBLIC_HOST=45.77.228.152
ExecStart=/home/tom/.nvm/versions/node/v25.8.1/bin/node /opt/fips-nostr-bootstrap/apps/fips-daemon.mjs --role all --fips-udp-port 9999 --stun-port 3478 --relay-listen-host 127.0.0.1 --relay-listen-port 1717
Restart=always
RestartSec=2

[Install]
WantedBy=multi-user.target
```

Apply:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now fips-stun
sudo systemctl status fips-stun --no-pager -l
```

---

## 2) Caddy config

`/etc/caddy/Caddyfile`

```caddy
fips.tomdwyer.uk {
  reverse_proxy 127.0.0.1:1717
}
```

Apply:

```bash
sudo caddy fmt --overwrite /etc/caddy/Caddyfile
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

---

## 3) Firewall (UFW)

Required open ports:

- `443/tcp` (WSS via Caddy)
- `3478/udp` (STUN)
- `9999/udp` (FIPS)

Commands:

```bash
sudo ufw allow 443/tcp
sudo ufw allow 3478/udp
sudo ufw allow 9999/udp
sudo ufw status
```

---

## 4) Health checks

### Service/listeners

```bash
sudo systemctl status fips-stun --no-pager -l
sudo ss -ltnp | grep :1717
sudo ss -lunp | egrep ':3478|:9999'
```

Expected:
- relay on `127.0.0.1:1717`
- STUN on `0.0.0.0:3478`
- FIPS on `0.0.0.0:9999`

### Relay endpoint

```bash
curl -I https://fips.tomdwyer.uk
```

`426` is acceptable for websocket-only endpoint.

### Runtime log signal

```bash
sudo journalctl -u fips-stun -n 120 --no-pager
```

Look for JSON startup block with:
- `role: all`
- `relayCount: 1`
- relay list containing only `ws://127.0.0.1:1717`

---

## 5) End-to-end smoke test

From client/devbox:

```bash
FIPS_TEST_RELAYS='wss://fips.tomdwyer.uk' \
FIPS_TEST_SERVER_NPUB='<SERVER_NPUB_FROM_DAEMON_STARTUP_LOG>' \
npx vitest run src/rendezvous_live_relay.integration.test.ts
```

Expected: `2 passed`.

---

## 6) Security notes

- Use a dedicated daemon key (`NOSTR_NSEC`), not personal key.
- If key leaks, rotate immediately and restart service.
- Consider setting `FIPS_TRUSTED_NPUBS` once clients are known.
- Keep relay local-only (`127.0.0.1`) and expose only through Caddy TLS.
