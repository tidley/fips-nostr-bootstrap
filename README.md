# FIPS Nostr Bootstrap

Prototype where **Nostr is signalling-only** and FIPS transport is direct UDP (with fallback).

## Implemented in this repo

### Protocol + artifacts
- `docs/protocol-spec-v0.2.md` — protocol phases, security boundary, deterministic state model
- `docs/message-schema.json` — required common signalling fields
- `docs/state-machine.mmd` — state machine diagram (Mermaid)
- `docs/nat-test-plan.md` — NAT traversal test matrix and metrics
- `docs/failure-taxonomy.md` — failure classes + refinement checklist

### Reference implementation modules (`src/`)
- `identity.ts` — nonce/session generation + message signing/verification
- `signal_nostr.ts` — in-memory signalling adapter abstraction (Nostr role)
- `handshake.ts` — deterministic state machine with replay/timestamp/expiry checks
- `nat_probe.ts` — direct UDP probe strategy model
- `session.ts` — post-bootstrap session binding store
- `fallback.ts` — fallback decision logic
- `metrics.ts` — handshake/direct/fallback metrics
- `test_harness.ts` — deterministic local integration harness

## Quick start

```bash
npm install
npm run build
npm test
```

## Real transport latency/speed test (runnable from repo)

### Single-host quick check
```bash
npm run test:transport
```

### Two-computer test via Nostr DM (client input = only npub)

Set relays on both machines (optional, defaults are built in):
```bash
export NOSTR_RELAYS="wss://relay.damus.io,wss://nos.lol,wss://relay.primal.net,wss://nip17.tomdwyer.uk"
```

Optional (if you want a fixed identity instead of auto-generated ephemeral key):
```bash
export NOSTR_NSEC=<your_nsec>
```

On **server machine**:
```bash
# Optional: advertised host override if auto-detect is wrong
export FIPS_UDP_PUBLIC_HOST=<server_public_or_routable_ip>
node scripts/udp-transport-via-nostr.mjs --mode server --port 9999 --debug
```
Server prints its generated/loaded `npub` (copy this to client).

On **client machine**:
```bash
node scripts/udp-transport-via-nostr.mjs --mode client --npub <SERVER_NPUB> --rounds 500 --payload 256 --warmup 30 --timeout 3000 --debug

# Optional hole-punch tuning
# --retry-ms 5000 --punch-interval-ms 300 --punch-duration-ms 30000 --punch-start-delay-ms 3000

# Optional duplex "video-call style" UDP simulation (simultaneous both ways)
# --duplex-bytes 10485760 --duplex-chunk-bytes 1200 --duplex-interval-ms 0 --duplex-timeout-ms 90000
```

The client discovers endpoint info through encrypted Nostr DM handshake, performs simultaneous UDP hole punching, then runs UDP latency/speed benchmark.

(Implementation detail: NIP-17 gift-wrap events use randomized `created_at`, so subscriptions intentionally use a wider `since` window.)

Outputs JSON including:
- setup time (first successful probe RTT + setup duration)
- RTT stats (avg/p50/p95/p99/min/max)
- estimated throughput (Mbps)

Notes:
- Client requires only `--npub` as input.
- Script now attempts NIP-42 AUTH automatically when relay requires auth.
- Allow inbound UDP on server port (example: 9999).
- Add `--show-endpoints` if you want endpoint addresses printed in output.

## Notes
- Relays are coordination-only; data plane leaves Nostr after connect-confirm.
- Replay safety is enforced with nonce cache + monotonic timestamp checks.
- Direct establishment attempts are bounded; failures transition cleanly to fallback.
