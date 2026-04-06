# fips-nostr-rendezvous (Rust)

Rust protocol/runtime crate for the functional rendezvous path.

This crate is now the primary implementation for:
- traversal adverts
- `kind 10050` inbox relay publication and lookup
- STUN-based reflexive address discovery
- Rust `offer` / `answer` signaling
- legacy `hello -> server-info` fallback
- binary UDP punch / ack packets
- shell-demo traffic over an established punched path

It is **not** yet the final FIPS transport integration. The current post-punch payload layer is still the demo `FIPS1` frame wrapper.

## What Lives Here

Shared protocol/helpers:
- [src/lib.rs](/home/tom/code/fips-nostr-bootstrap/rust/fips-nostr-rendezvous/src/lib.rs)
  - protocol constants
  - advert / offer / answer structs
  - STUN URL parsing
  - binary punch packet helpers
  - `FIPS1` session frame helpers
  - punch target planning helpers
  - Rust unit and simulation tests

Server runtime:
- [src/bin/fips-shell-server.rs](/home/tom/code/fips-nostr-bootstrap/rust/fips-nostr-rendezvous/src/bin/fips-shell-server.rs)
  - long-running advertised server
  - STUN observation
  - advert + inbox relay publication
  - incoming offer handling
  - answer publication
  - legacy fallback handling
  - UDP punch responder
  - shell demo service

Client/daemon runtime:
- [src/bin/fips-web-daemon.rs](/home/tom/code/fips-nostr-bootstrap/rust/fips-nostr-rendezvous/src/bin/fips-web-daemon.rs)
  - advert discovery
  - `kind 10050`-first DM route selection
  - offer initiation
  - answer receipt/validation
  - legacy fallback initiation
  - parallel local/reflexive punch attempts
  - HTTP/SSE API consumed by the web console

## Current Runtime Model

1. Server publishes advert and inbox relay list.
2. Client discovers advert or targets an explicit `npub`.
3. Client looks up recipient inbox relays (`kind 10050`) first.
4. Client sends Rust traversal `offer`.
5. Server replies with Rust traversal `answer`.
6. Both sides perform UDP punch attempts.
7. On success, demo traffic currently continues over `FIPS1` frames.

Fallback:
- if the responder does not answer the newer path, the daemon can still fall back to legacy `hello -> server-info`

## Known-good Demo Profile

Current good defaults for the internet demo:
- advert relays: `wss://offchain.pub,wss://strfry.bitsbytom.com`
- DM relays: `wss://nip17.com,wss://offchain.pub`
- STUN servers: `stun:fips.tomdwyer.uk:3478,stun:stun.l.google.com:19302`

## Run the Rust Shell Server

```bash
cd /home/tom/code/fips-nostr-bootstrap && \
FIPS_STUN_SERVERS='stun:fips.tomdwyer.uk:3478,stun:stun.l.google.com:19302' \
cargo run --manifest-path rust/fips-nostr-rendezvous/Cargo.toml --bin fips-shell-server -- \
  --nsec '<SERVER_NSEC>' \
  --udp-port 9999 \
  --advert-relays 'wss://offchain.pub,wss://strfry.bitsbytom.com' \
  --dm-relays 'wss://nip17.com,wss://offchain.pub'
```

## Run the Rust-backed Web Console Client

```bash
cd /home/tom/code/fips-nostr-bootstrap && \
FIPS_STUN_SERVERS='stun:fips.tomdwyer.uk:3478,stun:stun.l.google.com:19302' \
NOSTR_NSEC='<CLIENT_NSEC>' \
node apps/fips-web-console.mjs \
  --advert-relays 'wss://offchain.pub,wss://strfry.bitsbytom.com' \
  --dm-relays 'wss://nip17.com,wss://offchain.pub'
```

## Build And Test

```bash
cd /home/tom/code/fips-nostr-bootstrap/rust/fips-nostr-rendezvous
cargo build
cargo test
```

High-value repo-level integration checks:

```bash
cd /home/tom/code/fips-nostr-bootstrap
npm test -- src/rust_offer_answer.integration.test.ts
npm test -- src/rust_shell_server.integration.test.ts
npm test -- src/rust_runtime_stun_startup.integration.test.ts
```

## Current Gaps

Still missing before this can become the real FIPS path:
- handoff of the established punched UDP path into the actual FIPS transport/session layer
- per-peer socket ownership decision for the transport boundary
- removal of demo `FIPS1` framing in favor of real FIPS startup
- final transport timeout/fallback policy

## Next Logical Step

The next major work should likely move into a branch of the upstream FIPS repo:
1. define the established-socket handoff contract
2. port or vendor this Rust traversal core
3. replace demo framing with real FIPS transport startup
