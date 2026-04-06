# Architecture

## Current Shape

This repository now has a clear split:

- **Control/discovery plane**
  - Nostr adverts
  - `kind 10050` inbox relay metadata
  - private gift-wrapped signaling
- **Traversal plane**
  - STUN binding discovery
  - offer/answer address exchange
  - binary UDP punch/ack traffic
- **Demo payload plane**
  - lightweight `FIPS1` session frames over the established UDP path

The control and traversal planes are now implemented primarily in Rust. The browser UI is still `.mjs`, but it talks to a Rust daemon.

## What Runs Where

Primary runtime components:

- [rust/fips-nostr-rendezvous/src/bin/fips-shell-server.rs](/home/tom/code/fips-nostr-bootstrap/rust/fips-nostr-rendezvous/src/bin/fips-shell-server.rs)
  - long-running advertised server
  - receives DMs
  - answers traversal offers
  - performs punch responses
  - serves the demo shell

- [rust/fips-nostr-rendezvous/src/bin/fips-web-daemon.rs](/home/tom/code/fips-nostr-bootstrap/rust/fips-nostr-rendezvous/src/bin/fips-web-daemon.rs)
  - client/daemon runtime
  - discovers adverts
  - resolves inbox relays
  - initiates traversal offers
  - performs punch attempts
  - exposes HTTP/SSE for the web UI

- [apps/fips-web-console.mjs](/home/tom/code/fips-nostr-bootstrap/apps/fips-web-console.mjs)
  - web UI and process wrapper
  - not part of the traversal core

- [rust/fips-nostr-rendezvous/src/lib.rs](/home/tom/code/fips-nostr-bootstrap/rust/fips-nostr-rendezvous/src/lib.rs)
  - shared protocol and punch-planning helpers

Reference/testbed implementation:

- [src/traversal_runtime.ts](/home/tom/code/fips-nostr-bootstrap/src/traversal_runtime.ts)
- [src/punch_planner.ts](/home/tom/code/fips-nostr-bootstrap/src/punch_planner.ts)
- [src/traversal_signal.ts](/home/tom/code/fips-nostr-bootstrap/src/traversal_signal.ts)

## Runtime Flow

1. Server publishes:
   - traversal advert (`kind 30078`)
   - inbox relay list (`kind 10050`)
2. Client discovers advert or targets an explicit `npub`.
3. Client looks up recipient inbox relays first.
4. Client performs STUN on its runtime UDP socket.
5. Client sends traversal `offer`.
6. Server performs STUN on its runtime UDP socket.
7. Server replies with traversal `answer`.
8. Both sides derive punch targets from:
   - reflexive addresses
   - local interface addresses
9. Both sides send binary UDP punch packets.
10. On success, the runtime currently switches to the demo `FIPS1` payload framing.

Fallback:
- if the Rust offer/answer path does not complete, the runtime can still fall back to legacy `hello -> server-info`

## Architectural Boundary That Matters Now

The critical unfinished boundary is **post-punch handoff**.

Today:
- traversal runtime owns the punched UDP socket
- demo payloads are sent directly over `FIPS1` frames

Target state:
- traversal runtime establishes the direct UDP path
- FIPS transport/session code takes ownership of that path
- rendezvous/traversal logic steps out of the data plane

That means the next architecture decision is not about more signaling. It is about the handoff contract:
- same-process or cross-process
- shared socket or per-peer connected socket
- metadata passed into FIPS transport startup
- cleanup rules if the transport handshake fails

## What Is Proven vs What Is Still Lab Work

Proven in this repo:
- advert discovery
- inbox relay routing
- STUN observation on the real runtime socket
- offer/answer exchange
- UDP punching
- demo shell session over the punched path

Still lab/prototype:
- final FIPS transport ownership
- production relay reliability policy
- final timeout/fallback behavior
- removal of legacy bootstrap compatibility

## Next Logical Architecture Step

The next major implementation should likely happen in a branch of the upstream FIPS repo:
1. define `EstablishedTraversal` handoff data
2. move or vendor the Rust traversal core there
3. replace `FIPS1` demo frames with real FIPS transport/session startup
4. add end-to-end tests for punch success plus authenticated transport startup
