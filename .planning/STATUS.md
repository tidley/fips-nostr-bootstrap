# STATUS

Phase: Issue 37 traversal prototype build-out

Objective: move the repo from "known-peer bootstrap + punch" toward "advertise -> discover -> private signaling -> exchange addresses -> punch", while keeping upstream FIPS handoff out of scope for now.

Current snapshot:
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
- Default DM relay set now includes:
  - `wss://nip17.com`
  - `wss://nip17.tomdwyer.uk`
- Default STUN set now includes and prefers:
  - `stun:fips.tomdwyer.uk:3478`
- Live validation status:
  - STUN smoke test against `fips.tomdwyer.uk` passed
  - live NIP-17 relay publish succeeded, but DM receipt/server roundtrip was not proven in the current test run
- Current gap:
  - the package runtime now supports the target local flow: long-running advertiser plus advert-only client discovery/connect
  - relay/live E2E coverage still does not prove public-relay DM delivery and full server roundtrip reliably
  - not all auxiliary app/test paths have been updated off the older `hello -> server-info` assumptions yet
  - the current UDP `PROBE` / `PROBE_ACK` path is still the data-plane/punch mechanism during migration
