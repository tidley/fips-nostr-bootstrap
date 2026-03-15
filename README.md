# FIPS Nostr Bootstrap

This repo now contains a working prototype of:

1. **NIP-17 Nostr rendezvous** (bootstrap signalling)
2. **UDP hole punching** (simultaneous outbound probe window)
3. **Direct UDP test traffic** after establishment
4. **Duplex stream simulation** (~10MB each way by default)

> Note: this is transport/rendezvous engineering work. It is **not** a FIPS 140 validation claim.

---

## Current status

- ✅ NIP-17 DM bootstrap works
- ✅ NIP-42 relay auth path wired
- ✅ Hole punching works in tested environment
- ✅ Duplex 10MB each-way simulation works
- ✅ Quick latency benchmark runs after punch

Known caveats:
- NAT behavior varies; symmetric NAT may still require fallback relay paths
- relay quality/rate limits affect bootstrap reliability

---

## Shell commands: exact runbook

All scripts auto-load `.env` from repo root.

### 0) One-time setup (both machines)

```bash
git clone https://github.com/tidley/fips-nostr-bootstrap.git
cd fips-nostr-bootstrap
npm install
```

### 1) Create `.env` (both machines)

```bash
cat > .env <<'EOF'
NOSTR_RELAYS=wss://nos.lol
# Optional fixed identity (recommended for stable npub):
# NOSTR_NSEC=nsec1...
# Optional endpoint override:
# FIPS_UDP_PUBLIC_HOST=...
EOF
```

---

## Fast transport demo (NIP-17 + hole punch + duplex)

### Server (machine A)

```bash
cd ~/fips-nostr-bootstrap
node scripts/udp-transport-via-nostr.mjs --mode server --port 9999 --debug
```

Copy `identity` (`npub...`).

### Client (machine B)

```bash
cd ~/fips-nostr-bootstrap
node scripts/udp-transport-via-nostr.mjs --mode client --npub <SERVER_NPUB> --wait 60000 --debug
```

Success output includes:
- `rendezvous.endpointDiscovered: true`
- `punching.established: true`
- `duplex.localSentBytes/localReceivedBytes` (~10MB each way)

---

## Web console mode (SSH-like command/response)

### Receiver shell server (machine A)

```bash
cd ~/fips-nostr-bootstrap
node apps/fips-shell-server.mjs --udp-port 9999 --trusted-npubs "<WEB_UI_NPUB>"
```

### Web UI (machine B)

```bash
cd ~/fips-nostr-bootstrap
node apps/fips-web-console.mjs --http-port 8787 --udp-port 0
```

Open `http://127.0.0.1:8787`, paste server npub, connect, then type commands.

---

## Terminal-native mode (recommended for htop/nano)

### PTY server (machine A)

```bash
cd ~/fips-nostr-bootstrap
node apps/fips-pty-server.mjs --udp-port 9999 --trusted-npubs "<CLIENT_NPUB>"
```

### PTY client (machine B)

```bash
cd ~/fips-nostr-bootstrap
node apps/fips-pty-client.mjs --npub <SERVER_NPUB> --wait 60000
```

Exit PTY client with `Ctrl-]`.


---

## Useful flags

```bash
--rounds 10                     # ping rounds (default 10)
--timeout 3000                  # ping timeout per probe
--retry-ms 5000                 # DM resend interval
--punch-interval-ms 300         # punch send cadence
--punch-duration-ms 30000       # punch window length
--punch-start-delay-ms 3000     # coordinated start delay
--duplex-bytes 10485760         # per-direction stream size (10MB)
--duplex-chunk-bytes 1200       # UDP payload chunk
--duplex-interval-ms 0           # stream pacing
--duplex-timeout-ms 90000       # wait for remote stream completion
--show-endpoints                # print endpoint addresses in output
--debug                         # verbose logs
```

---

## Standalone library

A standalone package scaffold now exists at:

`packages/fips-nostr-rendezvous`

Package name:

`@fips/nostr-rendezvous`

This is the reusable library layer for trusted-npub rendezvous + punch establishment, so you can hand off the connected UDP socket/remote tuple to higher-level protocols (shell, file transfer, media).

---

## Simple web video chat demo

A lightweight browser-to-browser video call demo is included:

```bash
node apps/fips-video-chat.mjs --port 8088
```

Open the page on both devices (same URL). Each browser tab creates an **ephemeral npub**, listens on relays for NIP-17 messages, and shows a QR.

Flow:
1. Receiver opens page and waits (already listening).
2. Initiator scans/pastes receiver npub and clicks **Send Request**.
3. Receiver sees incoming request and clicks **Accept**.
4. Camera and mic start OFF by default.
5. Enable camera/mic with controls as needed.
6. One side clicks **Join call**.
6. Same button toggles to **End call** to tear down the peer connection.

Notes:
- No auto-join on incoming offer; receiver must click **Join call**.

QR notes:
- QR image is generated client-side.
- Scanning uses native `BarcodeDetector` when available.
- Falls back to in-browser `jsQR` for broader support.

Notes:
- Video signaling now uses NIP-17 DMs over relays (no local ws signaling path).
- Uses WebRTC + public STUN for media path traversal.
- Includes mic mute/unmute, speaker mute/unmute, and End call (with rejoin support).
- Dark UI with stats at page bottom: RTT, sent/received MB, throughput, ICE candidates, IPv6 hints.
- FIPS-style routing hints: candidate-set + bloom exchange, local/LAN-first preference, delayed broader candidate release, selected-path reason logging.
- Local preview is smaller; remote video is larger.
- Prototype quality: no auth hardening/recording yet.

## SSH-like demos

### A) Web console (single-pane, Terminator-like)

- `apps/fips-shell-server.mjs` (receiver/command executor)
- `apps/fips-web-console.mjs` (browser UI sender)

Receiver (machine B):

```bash
node apps/fips-shell-server.mjs --udp-port 9999 --trusted-npubs "<WEB_UI_NPUB>"
```

Sender UI (machine A):

```bash
node apps/fips-web-console.mjs --http-port 8787 --udp-port 0
```

Open `http://127.0.0.1:8787`, paste server npub, connect.

### B) Real terminal client (supports TUI apps like htop)

- `apps/fips-pty-server.mjs` (server-side PTY)
- `apps/fips-pty-client.mjs` (local terminal client)

### C) Android wrapper app (Termux launcher)

- `android/fips-termux-wrapper`
- Small native UI that launches the Termux Node client (`apps/fips-pty-client.mjs`) with entered npub.

Server (machine B):

```bash
node apps/fips-pty-server.mjs --udp-port 9999 --trusted-npubs "<CLIENT_NPUB>"
```

Client (machine A):

```bash
node apps/fips-pty-client.mjs --npub <SERVER_NPUB> --wait 60000
```

Notes:
- Press `Ctrl-]` to exit client locally.
- This path allocates a PTY (via `script`) so interactive apps (`htop`, `nano`, etc.) render properly.

Security notes:
- Prototype remote shell channel, **not full SSH protocol** yet.
- Keep trusted npub allowlist strict.
- Run with low-privilege user in testing.

---

## Dev

```bash
npm install
npm run build
npm test
```
