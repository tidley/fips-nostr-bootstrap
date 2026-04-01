# DONE

- Repo initialized and pushed to ngit + GitHub.
- Protocol draft and TS skeleton created.
- Added GSD `.planning` workflow.
- Added TDD harness (vitest + coverage gates >=95%).
- Implemented bootstrap event validation module + tests.
- Implemented handshake state-machine tests incl. replay/expiry/invalid transitions.
- Achieved 100% coverage (lines/branches/functions/statements).
- Implemented deterministic demo engine + fixture files.
- Added demo commands (`demo:preflight`, `demo:happy`, `demo:failures`).

## 2026-03-17 delivery

- Cherry-picked STUN/signal-tag updates onto `main` and resolved merge conflicts.
- Synced GitHub Pages app (`docs/video-chat/app.js`) with latest signaling behavior.
- Added standard `#t` call tags for chapar classifier matching.
- Added live STUN probe test: `src/stun_connectivity.test.ts`.
- Switched default STUN target to `stun:45.77.228.152:3478`.
- Added standalone lightweight STUN server (`tools/stun-lite`).
- Improved ICE robustness:
  - queue remote ICE until remote description exists
  - short ICE-gather wait before sending SDP
  - richer ICE diagnostics in UI/console
- Added deep media debug logs:
  - transceivers
  - sender track states
  - SDP m-line directions
- Updated join behavior:
  - auto-acquire media on join
  - explicit “joined receive-only” state when permissions denied

## 2026-03-31 delivery

- Implemented traversal advert model and validation:
  - `src/traversal_advert.ts`
  - `src/traversal_advert.test.ts`
- Implemented in-memory traversal advert directory:
  - `src/traversal_directory.ts`
  - `src/traversal_directory.test.ts`
- Implemented issue-aligned traversal offer / answer model:
  - `src/traversal_signal.ts`
  - `src/traversal_signal.test.ts`
- Extended signal adapter for public adverts + private ordered delivery:
  - `src/signal_nostr.ts`
  - `src/signal_nostr.test.ts`
- Added centralized DM relay defaults:
  - `src/dm_relays.ts`
  - `src/dm_relays.test.ts`
- Added centralized STUN defaults and parsing:
  - `src/stun_defaults.ts`
  - `src/stun_defaults.test.ts`
- Added STUN normalization into traversal address model:
  - `src/traversal_stun.ts`
  - `src/traversal_stun.test.ts`
- Added pure punch planner:
  - `src/punch_planner.ts`
  - `src/punch_planner.test.ts`
- Added pure runtime traversal composition:
  - `src/traversal_runtime.ts`
  - `src/traversal_runtime.test.ts`
- Added pure end-to-end traversal flow:
  - `src/traversal_flow.ts`
  - `src/traversal_flow.test.ts`
- Added harness migration entry point:
  - `runAdvertisedTraversalScenario` in `src/test_harness.ts`
- Verified local regression set:
  - `14` test files passed
  - `52` tests passed

## 2026-04-01 delivery

- Upgraded the JS rendezvous runtime toward the issue-37 private signaling model:
  - `packages/fips-nostr-rendezvous/src/index.js`
- Added package-level runtime tests for advert/discovery + traversal private signaling:
  - `src/rendezvous_advertised_runtime.test.ts`
- `connect()` now:
  - discovers adverts before connect in current client entry points
  - publishes a traversal `offer`
  - keeps a legacy `hello` fallback for compatibility
  - accepts either traversal `answer` or legacy `server-info`
- `start()` now:
  - responds to traversal `offer` with traversal `answer`
  - preserves legacy `hello -> server-info` handling
- Added advert-browsing runtime path:
  - `listAdvertisedPeers`
  - `connectFromAdvert`
  - `connectToDiscoveredPeer`
- Updated discovery-first client surfaces:
  - `apps/fips-pty-client.mjs`
  - `apps/fips-web-console.mjs`
- Added unknown-peer embedded-relay integration proof:
  - `src/rendezvous_unknown_peer.integration.test.ts`
- Fixed `udpPort: 0` handling so ephemeral client sockets work correctly
- Verified local regression set:
  - `npm run build`
  - `src/rendezvous_advertised_runtime.test.ts` passed
  - `RUN_UNKNOWN_PEER_E2E=1 src/rendezvous_unknown_peer.integration.test.ts` passed
