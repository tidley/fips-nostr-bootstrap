# LOG

## 2026-03-15
- Started structured GSD+TDD workflow for fips-nostr-bootstrap.
- Added Vitest with enforced coverage thresholds.
- Implemented and tested bootstrap event validation.
- Expanded state-machine tests for replay/expiry/invalid transitions.
- Verified build and reached 100% test coverage.
- Added deterministic demo fixtures and runnable demo CLI scripts.
- Validated demo preflight/happy/failures flows end-to-end.

## 2026-03-17
- Diagnosed call-signal classification mismatch; added standard `#t` tags.
- Diagnosed STUN reachability path issues and validated public endpoint behavior.
- Added automated STUN binding-response test and used it for live validation.
- Added standalone `stun-lite` server for A/B testing outside chapar.
- Fixed remote ICE ordering race (queue + flush strategy).
- Added richer ICE/media debug logging to browser app.
- Added join-time media auto-acquire + receive-only fallback messaging.
- Confirmed STUN-only P2P path with srflx candidates and connected ICE state.
- Identified remaining intermittent media-flow issue as app-state/track-level, not bootstrap transport.
- Began planning for `jmcorgan/fips` integration as post-bootstrap data plane.

## 2026-03-23
- Added director-level architecture docs for merged FIPS + Nostr relay + STUN stack:
  - `docs/ARCHITECTURE.md`
  - `docs/FIPS-PARITY.md`
  - `docs/PROTOCOLS.md`
  - `docs/OPERATIONS.md`
  - `docs/SECURITY.md`
- Added TS tests to enforce bridge message contract and STUN/NAT policy behavior:
  - `src/bridge_contract.test.ts`
  - `src/stun_lite.test.ts`
- Refactored `tools/stun-lite/main.go` to expose testable packet handling helper.
- Added Go unit tests for stun-lite request handling and env fallback:
  - `tools/stun-lite/main_test.go`

## 2026-03-31
- Broke issue-37 work into executable slices in `.planning/TODO.md`.
- Completed Slice 1:
  - traversal advert schema
  - advert validation
  - advert selection
- Completed Slice 2:
  - in-memory replaceable advert directory
- Completed Slice 3:
  - issue-aligned traversal offer / answer types
  - session/freshness validation
- Completed Slice 4:
  - signal adapter support for public adverts + ordered private messages
- Completed Slice 5:
  - STUN defaults helper
  - `fips.tomdwyer.uk` added as primary STUN server
  - STUN observation normalization into reflexive/local addresses
- Completed Slice 6:
  - pure punch planner for LAN/reflexive target ordering
  - negotiated punch window
  - bounded retry schedule
- Started Slice 7:
  - pure runtime composition layer (`src/traversal_runtime.ts`)
  - pure end-to-end traversal flow (`src/traversal_flow.ts`)
  - harness bridge (`runAdvertisedTraversalScenario`)
  - advert publication/discovery in `packages/fips-nostr-rendezvous`
  - client discovery-based connect path in `apps/fips-pty-client.mjs` and `apps/fips-web-console.mjs`
- Expanded relay defaults to include:
  - `wss://nip17.com`
  - `wss://nip17.tomdwyer.uk`
- Added live test gating and runbook guidance for:
  - real relay delivery checks
  - real STUN checks
- Live validation outcome:
  - STUN Binding Success confirmed from `stun:fips.tomdwyer.uk:3478`
  - relay publish succeeded on configured relays, but DM receipt/server roundtrip was not proven in the latest live run
- Identified next downstream target:
  - integrate the new advert/discovery traversal flow into `ops-dashboard` once editing that project is approved

## 2026-04-01
- Continued Slice 7 with TDD at the JS rendezvous package boundary.
- Added package-level runtime tests for:
  - traversal `offer` publication from `connect()`
  - traversal `answer` handling on the initiator side
  - traversal `offer` handling on the responder side
  - legacy `hello -> server-info` compatibility fallback from `connect()`
- Upgraded `packages/fips-nostr-rendezvous/src/index.js` to:
  - build and publish issue-aligned private traversal `offer` messages
  - handle private traversal `offer` messages on the responder and publish issue-aligned `answer` messages
  - keep the legacy `hello` fallback path alive for older responders during migration
  - keep the current UDP `PROBE` / `PROBE_ACK` punch mechanism intact
- Verified locally:
  - `npm run build`
  - `15` test files passed
  - `59` tests passed
- Continued toward the “long-running advertised server + advert-only client” goal:
  - added `listAdvertisedPeers`, `connectFromAdvert`, and `connectToDiscoveredPeer` to the JS rendezvous runtime
  - updated `apps/fips-pty-client.mjs` so it can connect with no `--npub` by selecting from active adverts
  - updated `apps/fips-web-console.mjs` with `/api/discover` and advert-browsing UI support
  - updated package docs to show advert-only discovery/connect usage
- Fixed a real runtime bug exposed by integration work:
  - `udpPort: 0` now remains `0` instead of falling back to `9999`
- Added embedded-relay integration proof:
  - `src/rendezvous_unknown_peer.integration.test.ts`
  - validates: long-running advertised server, client discovers advert, client connects without pre-known `npub`
