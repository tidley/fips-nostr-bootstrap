# STATUS

Phase: Issue 37 traversal prototype build-out

Objective: move the repo from "known-peer bootstrap + punch" toward "advertise -> discover -> private signaling -> exchange addresses -> punch", while keeping upstream FIPS handoff out of scope for now.

Current snapshot:
- Rust functional migration has started:
  - package source-of-truth moved to TS, but new functional server work is now landing in Rust
  - added Rust crate `rust/fips-nostr-rendezvous` with protocol helpers, legacy wire structs, and session frame encode/decode
  - added Rust long-running shell server binary `fips-shell-server` that:
    - publishes adverts and `kind 10050` inbox relay metadata
    - receives gift-wrapped NIP-17 messages over long-lived subscriptions
    - answers legacy `hello -> server-info`
    - performs binary UDP punch / ack
    - serves shell commands over the existing `FIPS1` UDP session channel
  - added JS/Rust interop proof with embedded relay coverage in `src/rust_shell_server.integration.test.ts`
- Slices 1-6 are complete:
  - advert schema + validation
  - in-memory advert directory
  - issue-aligned offer / answer wire contract
  - mixed public advert + private signal adapter
  - STUN normalization into reflexive/local addresses
  - pure punch planner
- Slice 7 is in progress:
  - added pure runtime composition layer (`src/traversal_runtime.ts`)
  - added end-to-end pure traversal flow (`src/traversal_flow.ts`)
  - added harness migration entry point (`runAdvertisedTraversalScenario`)
  - added advert publication/discovery support to the JS rendezvous package
  - switched current CLI/web clients to use discovery-based connect by default
  - upgraded the JS rendezvous runtime to publish issue-aligned private traversal `offer` messages
  - upgraded the JS rendezvous runtime to answer traversal `offer` messages with issue-aligned `answer` messages
  - kept compatibility by publishing legacy `hello` fallback from `connect()` and still accepting `server-info`
  - added advert browsing/runtime dialing without a pre-known `npub`
  - updated current CLI/web clients so discovery can start from broadcast adverts alone
  - added embedded-relay proof for unknown-peer advert discovery and connect
- Slice 8 has now partially landed in the live JS runtime:
  - added live STUN observation on the bound UDP socket with fallback across configured STUN servers
  - traversal adverts and offer / answer payloads now use STUN-derived reflexive/local addresses when available
  - added `kind 10050` inbox relay publish and recipient lookup with default fallback
  - split advert relay targeting from DM inbox relay targeting
  - replaced JSON-only probe handling with binary punch / ack support keyed by session hash, while preserving current session behavior
  - added NIP-40 expiration tags to public advert events
  - added NIP-09 deletion events for superseded/shutdown public advert and inbox metadata events
- Verification expanded:
  - runtime STUN integration test against a fake local STUN server
  - simulated NAT integration coverage for LAN-preferred success and symmetric NAT fallback
  - shared-socket multi-client runtime integration proving one server socket can currently multiplex two clients
- Default DM relay set now includes:
  - `wss://nip17.com`
  - `wss://nip17.tomdwyer.uk`
- Default STUN set now includes and prefers:
  - `stun:fips.tomdwyer.uk:3478`
- Live validation status:
  - STUN smoke test against `fips.tomdwyer.uk` passed
  - live NIP-17 relay publish succeeded, but DM receipt/server roundtrip was not proven in the current test run
- Current gap:
  - client/daemon functional path is still JS; the server path now has a Rust replacement
  - the package runtime now supports the target local flow: long-running advertiser plus advert-only client discovery/connect
  - relay/live E2E coverage still does not prove public-relay DM delivery and full server roundtrip reliably
  - not all auxiliary app/test paths have been updated off the older `hello -> server-info` assumptions yet
  - wrapped DM signaling cleanup is still partial because the current NIP-17 helper path does not yet add signed expiration/deletion metadata to the outer gift-wrap events
  - per-peer punch sockets are still not implemented; the runtime currently proves shared-socket multiplexing, not the issue-37 preferred socket model
  - LAN optimization is still only planned/tested in pure simulation modules, not yet parallelized in the live JS runtime
