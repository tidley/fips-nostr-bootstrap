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

## Fast demo (2 machines)

Use same relay list on both sides (example):

```bash
export NOSTR_RELAYS="wss://nos.lol"
```

### 1) Start server (machine A)

```bash
node scripts/udp-transport-via-nostr.mjs --mode server --port 9999 --debug
```

Copy printed `identity` (`npub...`).

### 2) Start client (machine B)

```bash
node scripts/udp-transport-via-nostr.mjs --mode client --npub <SERVER_NPUB> --wait 60000 --debug
```

If successful, final JSON includes:
- `rendezvous.endpointDiscovered: true`
- `punching.established: true`
- `duplex.localSentBytes/localReceivedBytes` (~10MB)
- latency and speed metrics

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

## Dev

```bash
npm install
npm run build
npm test
```
