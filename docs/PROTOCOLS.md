# Protocol Contracts (Bridge)

## Nostr signaling (NIP-17)

The rendezvous wire contract is versioned and encoded as encrypted NIP-17 DM payloads.

Canonical message types:

- `fips.rendezvous.hello`
- `fips.rendezvous.server-info`
- `fips.rendezvous.error`

Mandatory envelope fields for all types:

- `version` (currently `"1.0"`)
- `sessionId`
- `nonce`
- `issuedAt`

Reference schema: `docs/rendezvous-wire-schema.json`

### `fips.rendezvous.hello`

Client-to-server intent message.

Required fields:

- `type: "fips.rendezvous.hello"`
- `wants.stunInfo: boolean`
- `wants.fipsConnect: boolean`

Optional:

- `clientEndpoint` (host/port hint)
- `capabilities` (string list)

### `fips.rendezvous.server-info`

Server-to-client rendezvous response.

Required fields:

- `type: "fips.rendezvous.server-info"`
- `endpoint.host`
- `endpoint.port`

Optional:

- `punch` (`startAtMs`, `intervalMs`, `durationMs`)
- `stun.uri` (e.g. `stun:45.77.228.152:3478`)
- `stun.metadataTag`

### `fips.rendezvous.error`

Server-to-client failure response.

Required fields:

- `type: "fips.rendezvous.error"`
- `code` in: `bad-request | untrusted-peer | unsupported-version | internal-error`
- `message`

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
