# FIPS Nostr Bootstrap

Prototype workspace for Nostr-signaled NAT traversal and bootstrap toward upstream FIPS integration.

The repo is intentionally mixed. It contains:
- a TypeScript package and test suite for rendezvous, adverts, signaling, STUN handling, and UDP punch orchestration
- runnable Node `.mjs` apps for web/CLI demos
- a Rust functional runtime that is starting to replace the JS server side
- a Rust bootstrap client
- mobile, Android, and browser demo experiments
- docs, specs, runbooks, and planning material

In this repo, "FIPS" means alignment with the upstream FIPS transport/bootstrap direction. It is not a FIPS 140 validation claim.

## Current status

What works today:
- public traversal adverts over Nostr
- advert discovery without pre-known peer identity
- private NIP-17/NIP-59 signaling
- STUN-assisted address observation
- UDP hole punching with binary probe/ack packets
- a working shell demo over the punched UDP path
- a Rust shell server and a Rust web daemon behind the `.mjs` web UI

What is still incomplete:
- full upstream FIPS handoff
- Rust `offer/answer` parity with the richer JS traversal path
- full live public-relay reliability hardening
- final transport policy/fallback story for upstream FIPS

## Main directories

### `src/`

TypeScript core modules and the main Vitest suite.

This is where most of the protocol and runtime logic is modeled and tested:
- traversal adverts
- offer/answer signaling
- STUN normalization
- punch planning
- relay/test harnesses
- runtime simulations and integration tests

### `packages/fips-nostr-rendezvous/`

Reusable TS package for the current JS runtime path.

It contains:
- `src/index.ts` as the package source of truth
- generated runtime JS used by the `.mjs` apps
- the current JS rendezvous node implementation

See [packages/fips-nostr-rendezvous/README.md](/home/tom/code/fips-nostr-bootstrap/packages/fips-nostr-rendezvous/README.md).

### `apps/`

Runnable Node entry points built on the package:
- [apps/fips-web-console.mjs](/home/tom/code/fips-nostr-bootstrap/apps/fips-web-console.mjs)
- [apps/fips-shell-server.mjs](/home/tom/code/fips-nostr-bootstrap/apps/fips-shell-server.mjs)
- [apps/fips-daemon.mjs](/home/tom/code/fips-nostr-bootstrap/apps/fips-daemon.mjs)
- [apps/fips-pty-client.mjs](/home/tom/code/fips-nostr-bootstrap/apps/fips-pty-client.mjs)
- [apps/fips-pty-server.mjs](/home/tom/code/fips-nostr-bootstrap/apps/fips-pty-server.mjs)
- [apps/fips-combo-client.mjs](/home/tom/code/fips-nostr-bootstrap/apps/fips-combo-client.mjs)
- [apps/fips-video-chat.mjs](/home/tom/code/fips-nostr-bootstrap/apps/fips-video-chat.mjs)

These are useful as demo surfaces and integration targets, not just examples.

### `rust/fips-nostr-rendezvous/`

Rust runtime/protocol crate for the functional migration.

Current scope:
- protocol types and packet helpers
- legacy `hello -> server-info` wire structs
- `FIPS1` session frame helpers
- long-running Rust shell server binary
- Rust web daemon used by the web console client path

See [rust/fips-nostr-rendezvous/README.md](/home/tom/code/fips-nostr-bootstrap/rust/fips-nostr-rendezvous/README.md).

### `rust/bootstrap-client/`

Rust bootstrap client for:
- sending `fips.rendezvous.hello`
- receiving `fips.rendezvous.server-info`
- optional punch probing
- writing handoff JSON for downstream startup

See [rust/bootstrap-client/README.md](/home/tom/code/fips-nostr-bootstrap/rust/bootstrap-client/README.md).

### `mobile/` and `android/`

Client packaging experiments:
- [mobile/flutter_fips_client](/home/tom/code/fips-nostr-bootstrap/mobile/flutter_fips_client)
- [android/fips-termux-wrapper](/home/tom/code/fips-nostr-bootstrap/android/fips-termux-wrapper)

These are useful context, but they are not yet the center of gravity.

### `docs/`, `spec/`, `demo/`, `.planning/`

These contain:
- architecture and protocol docs
- runbooks and security/operations notes
- demo scenarios
- roadmap/status/todo material

Useful starting points:
- [docs/ARCHITECTURE.md](/home/tom/code/fips-nostr-bootstrap/docs/ARCHITECTURE.md)
- [docs/FIPS-PARITY.md](/home/tom/code/fips-nostr-bootstrap/docs/FIPS-PARITY.md)
- [docs/PROTOCOLS.md](/home/tom/code/fips-nostr-bootstrap/docs/PROTOCOLS.md)
- [docs/PRODUCTION-RUNBOOK.md](/home/tom/code/fips-nostr-bootstrap/docs/PRODUCTION-RUNBOOK.md)

### `tools/stun-lite/`

Small Go STUN server for local binding tests and diagnostics.

## Quick start

Install and run the TS/JS side:

```bash
npm install
npm run build
npm test
```

Useful Node entry points:

```bash
node apps/fips-web-console.mjs
node apps/fips-shell-server.mjs
node apps/fips-daemon.mjs
node scripts/demo.mjs happy
```

Build and test the Rust runtime crate:

```bash
cd rust/fips-nostr-rendezvous
cargo test
```

Run the known-good Rust demo profile:

```bash
cd /home/tom/code/fips-nostr-bootstrap && \
FIPS_STUN_SERVERS='stun:fips.tomdwyer.uk:3478,stun:stun.l.google.com:19302' \
cargo run --manifest-path rust/fips-nostr-rendezvous/Cargo.toml --bin fips-shell-server -- \
  --nsec "$NOSTR_NSEC" \
  --udp-port 9999 \
  --advert-relays 'wss://offchain.pub' \
  --dm-relays 'wss://nip17.com,wss://offchain.pub'
```

Run the Rust-backed web console client:

```bash
cd /home/tom/code/fips-nostr-bootstrap && \
FIPS_STUN_SERVERS='stun:fips.tomdwyer.uk:3478,stun:stun.l.google.com:19302' \
NOSTR_NSEC="$NOSTR_NSEC" \
node apps/fips-web-console.mjs \
  --advert-relays 'wss://offchain.pub' \
  --dm-relays 'wss://nip17.com,wss://offchain.pub'
```

Build and test the Rust bootstrap client:

```bash
cd rust/bootstrap-client
cargo test
```

## Recommended mental model

Treat this repo as a bootstrap/traversal lab, not a single polished product.

The practical split right now is:
- TS/JS still provides UI/test harness surface
- Rust now carries the working shell server path and the web-console client/daemon path
- both coexist while the functional side is migrated toward Rust

## Verification

The repo currently uses:
- `vitest` for TypeScript/unit/integration coverage
- embedded relay integration tests for JS and JS/Rust interop
- `cargo test` for the Rust crates

Notable current interop proof:
- the Rust shell server can publish adverts, receive gift-wrapped DMs, establish a punched session, and serve shell commands to the Rust web daemon behind the current web UI

## Bottom line

This repository contains real working traversal/bootstrap code, but it is still a convergence workspace.

If you want the shortest description:
- Nostr for discovery/signaling
- STUN for endpoint observation
- UDP punch for direct path establishment
- eventual FIPS transport integration as the target end state
