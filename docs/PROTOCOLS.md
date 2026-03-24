# Protocol Contracts (Bridge)

## Nostr signaling (NIP-17)
- Payloads are encrypted DMs carrying bridge control messages.
- Mandatory fields:
  - `type`
  - `nonce`
  - `issuedAt` (or equivalent freshness marker)
  - `sessionId` (for multi-session correlation)
- Validation requirements:
  - recognized `type`
  - nonce/freshness checks
  - endpoint shape validation

## STUN binding (RFC5389-style)
- Listener: UDP binding requests.
- Request accepted when:
  - message decodes correctly
  - method = Binding
  - class = Request
- Response includes XOR-MAPPED-ADDRESS and fingerprint.
- Malformed/unsupported requests are ignored (no crash, no panic).

## Bridge contract
Nostr signaling exchanges coordination data; STUN discovery produces endpoint hints; FIPS transport consumes those hints for session establishment.

Contract invariants:
1. Nostr layer does not alter transport cryptographic semantics.
2. STUN output is advisory endpoint data, not trust material.
3. Transport layer remains source of truth for session success/failure.
