# STATUS

Phase: Documentation + test hardening for FIPS/STUN/NIP-17 merge readiness

Objective: Build a merge-ready baseline that treats `jmcorgan/fips` as the transport reference, with NIP-17 signaling and STUN as integration adapters.

Current snapshot:
- Added architecture/protocol/security/operations docs for combined FIPS + STUN + relay model.
- Added parity matrix governance doc (`docs/FIPS-PARITY.md`).
- Added bridge contract tests in TS (`src/bridge_contract.test.ts`).
- Added STUN/NAT policy tests in TS (`src/stun_lite.test.ts`).
- Added Go tests for `tools/stun-lite` and extracted testable packet handling helper.
