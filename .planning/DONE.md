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
