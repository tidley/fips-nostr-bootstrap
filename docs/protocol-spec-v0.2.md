# FIPS Bootstrap over Nostr (v0.2 prototype)

## Objective
Nostr is signalling-only. FIPS session/data transport is direct UDP where possible, fallback when needed.

## Roles
- **Nostr**: async rendezvous and signed handshake events only.
- **FIPS direct transport**: post-bootstrap channel and payload transport.
- **Relay**: coordination, not trusted for ordering/confidentiality/authenticity.

## Phases
1. `bootstrap_announce`
2. `bootstrap_ack`
3. `connect_probe` (simultaneous outbound)
4. `connect_confirm` (session bind)
5. Handover (all traffic off Nostr)
6. Fallback (`retry_hint` / `abort` / relay-assisted ack)

## Deterministic state machine
`idle -> awaiting_ack -> acknowledged -> probing -> direct_established`

Fallback paths:
- `awaiting_ack --timeout--> fallback_pending`
- `probing --timeout--> fallback_pending`
- `fallback_pending --bootstrap_ack--> fallback_established`
- terminal: `failed|closed`

## Security properties
- Signatures verified per message.
- Nonce replay cache `(session, sender, nonce)`.
- Monotonic timestamp checks per sender/session.
- Expiry checks on every message.
- Session binding pins remote identity + negotiated parameters + selected endpoint pair.

## NAT traversal behavior
- Simultaneous outbound UDP probes against candidate endpoint pairs.
- Probe loop bounded by attempts/timeout.
- Symmetric NAT modeled as direct-fail and fallback trigger.

## Success criteria mapping
- deterministic transitions: explicit machine + logs
- replay-safe signalling: nonce/timestamp validation
- direct establishment on permissive NATs: harness + NAT model
- bounded failure on incompatible NATs: timeout -> fallback
- zero Nostr dependence post-bootstrap: session established in local `SessionStore`
