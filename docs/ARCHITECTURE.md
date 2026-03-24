# Architecture: FIPS + Nostr + STUN (Bridge)

## Goal
Build a single deployable system that combines:
- FIPS transport/session core (primary data plane)
- NIP-17/NIP-42 Nostr relay signaling (rendezvous/control plane)
- STUN binding service (endpoint discovery/NAT diagnostics)

This repository treats Nostr and STUN as adapters around the FIPS transport model.

## Runtime roles
Use one runtime with role flags:
- `--role fips` (transport/session only)
- `--role relay` (Nostr signaling only)
- `--role stun` (STUN binding service only)
- `--role all` (dev/integration mode)

Production recommendation: run separate service units for `fips`, `relay`, and `stun` for least privilege and independent scaling.

## Planes and boundaries
- **Data plane**: FIPS transport/session flow and payload movement.
- **Signal plane**: Nostr event exchange (bootstrap, endpoint exchange, coordination hints).
- **Discovery plane**: STUN binding requests and XOR-MAPPED-ADDRESS responses.

Boundary rule: signal and discovery planes must not redefine core transport semantics.

## High-level flow
1. Peer A and B exchange bootstrap payloads via NIP-17.
2. Each peer obtains reflexive endpoint info via STUN.
3. Peers coordinate punch window over Nostr signaling.
4. FIPS transport attempts direct session establishment.
5. On success, data plane moves to direct UDP session.
6. On repeated failure, fallback policy is triggered.

## Observability requirements
- Correlation ID across all planes per session.
- Metrics:
  - rendezvous_success_total
  - punch_success_total / punch_fail_total
  - stun_binding_requests_total
  - session_establish_latency_ms
  - fallback_invocations_total

## Security baseline
- Trusted peer policy for initiators/recipients.
- Replay mitigation (nonce + bounded freshness).
- Structured validation and fail-closed behavior on malformed signaling.
- STUN listener rate limiting and abuse controls.
