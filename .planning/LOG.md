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
