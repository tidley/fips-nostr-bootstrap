# FIPS over Nostr Bootstrap v0.1

## 1) Scope

Nostr is used only for:
- peer discovery
- capability advertisement
- signed bootstrap handshake exchange
- optional retry/rekey rendezvous

Nostr is NOT used for persistent session transport.

## 2) Identity model

- `nostr_pubkey`: signalling identity for event authenticity.
- `fips_identity`: FIPS session identity (static or rotating), bound via signed claim.
- Mapping MUST be explicit in bootstrap messages.

## 3) Event kinds and tags (proposed)

Use replaceable/event kinds in app namespace (example: `34100-34103`).

### Kind 34100: `fips.bootstrap.init`

Fields:
- `session_id` (UUID/nonce)
- `from_nostr_pubkey`
- `to_nostr_pubkey` (or discovery target)
- `from_fips_identity`
- `supported_transports` (direct-tcp, quic, webrtc, etc.)
- `supported_ciphersuites`
- `ephemeral_pubkey`
- `expires_at`

Tags:
- `p`: target nostr pubkey
- `fips`: protocol version
- `sid`: session id

### Kind 34101: `fips.bootstrap.ack`

Fields:
- `session_id`
- `ack_from_nostr_pubkey`
- `ack_from_fips_identity`
- `selected_transport`
- `selected_ciphersuite`
- `ephemeral_pubkey`
- `connection_hints` (optional)
- `expires_at`

Tags:
- `p`: initiator pubkey
- `sid`: session id

### Kind 34102: `fips.bootstrap.confirm`

Fields:
- `session_id`
- `transport_params_commitment`
- `key_confirm_mac`
- `switch_deadline`

### Kind 34103: `fips.bootstrap.fail`

Fields:
- `session_id`
- `error_code`
- `retry_after`
- `diagnostic` (optional)

## 4) Handshake state machine

States:
1. `IDLE`
2. `INIT_SENT`
3. `ACK_RECEIVED`
4. `CONFIRM_SENT`
5. `SWITCHING`
6. `ESTABLISHED`
7. `FAILED`

Flow:
1. Initiator publishes `init`.
2. Responder validates + publishes `ack`.
3. Initiator validates + publishes `confirm`.
4. Both derive session keys and switch to selected FIPS transport.
5. Nostr usage stops for data plane.

## 5) Failure and retry

- Retries MUST use new `session_id` and fresh ephemeral keys.
- Backoff SHOULD be exponential with jitter.
- `fail` events MAY include retry hints.

## 6) Replay protection

- Reject expired bootstrap events (`expires_at`).
- Maintain `(session_id, sender_pubkey)` replay cache.
- Require monotonic bootstrap timestamps per peer window.

## 7) Key lifecycle

- Bootstrap ephemeral keys: single-use per session.
- Session keys: derived after confirm; rotate on policy or rekey event.
- Long-term identity keys: nostr + fips identities remain separate but linked by signed claims.

## 8) Security requirements

- Signature verification MUST succeed for every bootstrap event.
- Relay behavior MUST NOT be trusted for ordering/confidentiality.
- Final session establishment MUST require cryptographic key confirmation.

## 9) Reference implementation requirements

A conformant implementation MUST:
- parse/validate kinds 34100-34103
- enforce replay checks
- execute state transitions deterministically
- emit transport switch callback after `CONFIRM_SENT`
