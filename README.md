# FIPS Nostr Bootstrap

Prototype workspace for Nostr-signaled NAT traversal and bootstrap toward upstream FIPS integration.

This repo is now best treated as a traversal/bootstrap lab with a working Rust demo path. It proves:
- advert publication and discovery over Nostr
- `kind 10050` inbox relay publication and lookup
- STUN-driven reflexive address discovery
- NIP-17/NIP-59 private signaling
- Rust `offer` / `answer` signaling with legacy `hello -> server-info` fallback
- binary UDP punch / ack packets
- a Rust shell demo over the punched path

It does **not** yet contain the real downstream FIPS transport handoff. That is the next phase and likely belongs in a branch of the upstream FIPS repo.

In this repo, "FIPS" means alignment with the upstream FIPS transport/bootstrap direction. It is not a FIPS 140 validation claim.

## Current State

What is actually used now:
- Rust runtime for the functional path:
  - [lib.rs](/home/tom/code/fips-nostr-bootstrap/rust/fips-nostr-rendezvous/src/lib.rs)
  - [fips-shell-server.rs](/home/tom/code/fips-nostr-bootstrap/rust/fips-nostr-rendezvous/src/bin/fips-shell-server.rs)
  - [fips-web-daemon.rs](/home/tom/code/fips-nostr-bootstrap/rust/fips-nostr-rendezvous/src/bin/fips-web-daemon.rs)
- Thin Node UI/process wrapper:
  - [fips-web-console.mjs](/home/tom/code/fips-nostr-bootstrap/apps/fips-web-console.mjs)
- TypeScript protocol/planner/testbed:
  - [src/traversal_runtime.ts](/home/tom/code/fips-nostr-bootstrap/src/traversal_runtime.ts)
  - [src/traversal_signal.ts](/home/tom/code/fips-nostr-bootstrap/src/traversal_signal.ts)
  - [src/punch_planner.ts](/home/tom/code/fips-nostr-bootstrap/src/punch_planner.ts)
  - [src/traversal_flow.ts](/home/tom/code/fips-nostr-bootstrap/src/traversal_flow.ts)

What still exists mainly as reference or compatibility:
- JS runtime package:
  - [packages/fips-nostr-rendezvous/src/index.ts](/home/tom/code/fips-nostr-bootstrap/packages/fips-nostr-rendezvous/src/index.ts)
- legacy `hello -> server-info` signaling in both JS and Rust runtimes
- demo `FIPS1` session framing rather than a real FIPS transport handoff

What is still missing:
- handoff of an established punched UDP path into the actual FIPS transport/session layer
- final per-peer socket ownership decision for the handoff boundary
- transport startup on top of the punched socket
- production-grade public relay hardening and failure policy

## Folder Guide

### `rust/fips-nostr-rendezvous/`

Primary functional implementation now.

Important files:
- [lib.rs](/home/tom/code/fips-nostr-bootstrap/rust/fips-nostr-rendezvous/src/lib.rs)
  - shared protocol structs
  - binary punch packet helpers
  - traversal offer/answer helpers
  - punch planning helpers
  - Rust NAT/planner tests
- [fips-shell-server.rs](/home/tom/code/fips-nostr-bootstrap/rust/fips-nostr-rendezvous/src/bin/fips-shell-server.rs)
  - long-running advertised server
  - STUN observation
  - advert publication
  - inbox relay publication
  - Rust offer/answer responder
  - legacy fallback responder
  - UDP punch responder
  - shell demo server
- [fips-web-daemon.rs](/home/tom/code/fips-nostr-bootstrap/rust/fips-nostr-rendezvous/src/bin/fips-web-daemon.rs)
  - Rust client/daemon
  - advert discovery
  - `kind 10050`-first relay routing
  - Rust offer initiator
  - legacy fallback initiator
  - UDP punch initiator
  - HTTP/SSE API for the web UI

### `apps/`

Demo/UI/process glue.

Important files:
- [fips-web-console.mjs](/home/tom/code/fips-nostr-bootstrap/apps/fips-web-console.mjs)
  - browser UI
  - spawns and proxies the Rust web daemon
  - not part of the core traversal logic
- [fips-shell-server.mjs](/home/tom/code/fips-nostr-bootstrap/apps/fips-shell-server.mjs)
  - older Node server path
  - useful for interop and regression checks

### `src/`

TypeScript reference implementation and main test harness.

Important files:
- [traversal_signal.ts](/home/tom/code/fips-nostr-bootstrap/src/traversal_signal.ts)
  - offer/answer schema and validation
- [punch_planner.ts](/home/tom/code/fips-nostr-bootstrap/src/punch_planner.ts)
  - target ordering
  - punch window negotiation
  - retry schedule generation
- [traversal_runtime.ts](/home/tom/code/fips-nostr-bootstrap/src/traversal_runtime.ts)
  - pure composition of STUN -> signaling -> punch planning
- [traversal_flow.ts](/home/tom/code/fips-nostr-bootstrap/src/traversal_flow.ts)
  - pure bootstrap scenario modeling
- [embedded_relay.ts](/home/tom/code/fips-nostr-bootstrap/src/embedded_relay.ts)
  - local relay used by integration tests

This directory remains the easiest place to reason about protocol behavior before porting or refining it in Rust.

### `packages/fips-nostr-rendezvous/`

Older JS library/runtime path.

Still useful for:
- interop
- reference behavior
- demo compatibility

Not the preferred place for new functional work.

### `rust/bootstrap-client/`

Older Rust bootstrap helper built around legacy `hello -> server-info`.

Still useful as a reference for:
- handoff JSON shape
- bootstrap-only flows

Not the primary runtime path anymore.

### `docs/`, `spec/`, `.planning/`

Reference material, architecture notes, protocol notes, and work tracking.

## Working Demo Path

Known-good internet demo profile:
- advert relays: `wss://offchain.pub,wss://strfry.bitsbytom.com`
- DM relays: `wss://nip17.com,wss://offchain.pub`
- STUN servers: `stun:fips.tomdwyer.uk:3478,stun:stun.l.google.com:19302`

Server:

```bash
cd /home/tom/code/fips-nostr-bootstrap && \
FIPS_STUN_SERVERS='stun:fips.tomdwyer.uk:3478,stun:stun.l.google.com:19302' \
cargo run --manifest-path rust/fips-nostr-rendezvous/Cargo.toml --bin fips-shell-server -- \
  --nsec '<SERVER_NSEC>' \
  --udp-port 9999 \
  --advert-relays 'wss://offchain.pub,wss://strfry.bitsbytom.com' \
  --dm-relays 'wss://nip17.com,wss://offchain.pub'
```

Client:

```bash
cd /home/tom/code/fips-nostr-bootstrap && \
FIPS_STUN_SERVERS='stun:fips.tomdwyer.uk:3478,stun:stun.l.google.com:19302' \
NOSTR_NSEC='<CLIENT_NSEC>' \
node apps/fips-web-console.mjs \
  --advert-relays 'wss://offchain.pub,wss://strfry.bitsbytom.com' \
  --dm-relays 'wss://nip17.com,wss://offchain.pub'
```

## Tests That Matter Most

Rust crate tests:

```bash
cd /home/tom/code/fips-nostr-bootstrap/rust/fips-nostr-rendezvous
cargo test
```

Key integration tests:

```bash
cd /home/tom/code/fips-nostr-bootstrap
npm test -- src/rust_offer_answer.integration.test.ts
npm test -- src/rust_shell_server.integration.test.ts
npm test -- src/rust_runtime_stun_startup.integration.test.ts
npm test -- src/nat_traversal_simulation.integration.test.ts
```

What these cover:
- Rust offer/answer path
- Rust shell server end-to-end interop
- startup STUN correctness in Rust binaries
- simulated LAN preference and symmetric NAT fallback behavior

## Next Logical Steps

This repo is now at the point where the next major work should likely happen in a branch of the upstream FIPS repo.

Recommended order:
1. Define the FIPS handoff boundary.
   - established UDP socket ownership
   - peer/session metadata
   - timeout/cleanup semantics
2. Move or port the proven Rust rendezvous core into a FIPS branch.
3. Replace demo `FIPS1` frames with the real FIPS transport/session startup.
4. Decide and implement per-peer socket ownership for the post-punch transport boundary.
5. Add end-to-end tests that prove:
   - punch success
   - FIPS transport startup
   - first authenticated transport message

This repo should remain the lab/reference environment while that integration is happening.
