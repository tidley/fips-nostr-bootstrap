# FIPS Parity Matrix (Reference: jmcorgan/fips)

Purpose: track what is reused, adapted, or newly introduced in this repo.

> NOTE: This is a living document. Each protocol/transport PR should update this table.

| Area | Status | Notes |
|---|---|---|
| Session lifecycle/state transitions | Adapted reuse | Keep FIPS transition semantics; integrate Nostr bootstrap preface. |
| Handshake material exchange | Adapted reuse | Preserve FIPS expectations; carried via NIP-17 payload. |
| Transport framing | Reuse target | Prefer unchanged FIPS framing once session established. |
| Retry/timeout ladder | Adapted reuse | NAT-aware timing for punch windows added. |
| Peer identity/trust checks | Adapted reuse | Nostr identities map into trust policy layer. |
| Endpoint discovery | New | STUN binding integration introduced. |
| Relay signaling transport | New | NIP-17/NIP-42 integration layer. |
| Failure taxonomy | Adapted reuse | Extend for relay/STUN-specific failure reasons. |
| Observability dimensions | New | Correlation IDs across planes + NAT outcome metrics. |

## Governance rules
1. No transport semantic changes without parity impact note.
2. Any divergence from FIPS reference requires explicit justification + test evidence.
3. New bridge logic must remain adapter-only; avoid transport core drift.
