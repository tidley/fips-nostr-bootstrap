Below is a concrete checklist for phases 1-6 of [issue #37](https://github.com/jmcorgan/fips/issues/37), augmented with the practical steps needed to turn this repo’s prototype into something upstreamable.

**Phase 1: Protocol Finalization**
- Decide whether NAT traversal advertisement is merged with peer discovery from `#34` or remains a separate event kind.
- Define the canonical event schemas for advertisement, discovery result, offer, answer, and optional error.
- Normalize this repo’s current `fips.rendezvous.hello` / `server-info` flow into the issue’s offer/answer model, or explicitly document why FIPS should diverge.
- Specify session identity, nonce, freshness window, replay handling, duplicate handling, and timeout semantics.
- Specify LAN optimization behavior: when to attempt local and reflexive candidates in parallel.
- Specify the exact punch packet wire format for upstream FIPS. This repo currently uses JSON `PROBE` / `PROBE_ACK`; issue `#37` wants binary magic plus session hash.
- Define handoff to FIPS Noise/FMP precisely: which side initiates, when the punched socket is promoted, and what counts as punch success versus transport success.
- Decide socket lifecycle: per-peer punch sockets versus shared socket. This is a major upstream design decision.
- Write a short state machine doc for initiator and responder with terminal failure states.
- Capture parity constraints with upstream transport semantics, using [docs/FIPS-PARITY.md](/home/tom/code/fips-nostr-bootstrap/docs/FIPS-PARITY.md#L1) as the starting point.

**Phase 2: STUN Client**
- Replace the current minimal probe in [src/stun_connectivity.test.ts](/home/tom/code/fips-nostr-bootstrap/src/stun_connectivity.test.ts#L1) with a reusable Rust STUN client library.
- Implement RFC 8489 Binding Request and Binding Success parsing.
- Parse `XOR-MAPPED-ADDRESS` into a reflexive candidate object.
- Add transaction ID validation and reject mismatched responses.
- Add fallback across multiple STUN servers with bounded retry policy.
- Define how STUN server preference is selected from discovery/advertisement metadata.
- Preserve socket continuity if the chosen design requires using the same socket for STUN, punch, and handoff.
- Add unit tests for encode/decode, malformed packets, timeout handling, and multi-server fallback.
- Add metrics/logging for STUN attempts, success rate, chosen server, and observed reflexive address.

**Phase 3: Nostr Signaling**
- Implement advertisement publishing for NAT-traversal capability with relay list and STUN hints.
- Implement discovery queries by `npub` and protocol tag.
- Implement offer construction using the final schema, not the current bootstrap-only message used in [rust/bootstrap-client/src/main.rs](/home/tom/code/fips-nostr-bootstrap/rust/bootstrap-client/src/main.rs#L91).
- Implement answer construction with responder reflexive address and session binding.
- Standardize on NIP-44 payload content inside NIP-59 gift-wrap for private signaling.
- Add relay subscription management for incoming signaling events, including reconnect/resubscribe behavior.
- Add expiration and cleanup policy for ephemeral events, including NIP-40 expiration and deletion if desired.
- Add replay protection and stale-session rejection.
- Add responder trust policy and allowlist behavior for unsolicited offers.
- Reconcile the current working signaling in [packages/fips-nostr-rendezvous/src/index.js](/home/tom/code/fips-nostr-bootstrap/packages/fips-nostr-rendezvous/src/index.js#L157) with the upstream event model.

**Phase 4: Hole Punch And Handoff**
- Replace the prototype JSON punch/ack with the issue’s final binary wire format.
- Keep the punch socket open from STUN through successful Noise/FMP handshake.
- Implement bounded punch timeout, retry, and backoff behavior.
- Support parallel attempts to local and reflexive candidates when LAN optimization applies.
- Decide whether both sides start punching immediately after answer, or at a negotiated `startAt`.
- Promote a successful punch into an upstream FIPS UDP transport link, instead of stopping at a test session as this repo currently does in [packages/fips-nostr-rendezvous/src/index.js](/home/tom/code/fips-nostr-bootstrap/packages/fips-nostr-rendezvous/src/index.js#L133).
- Integrate with existing UDP link management, receive loop, peer bookkeeping, and reconnect logic in upstream FIPS.
- Ensure auto-connect for configured peers can choose NAT traversal instead of direct UDP when `addr: "nat"` is configured.
- Ensure fallback to TCP/Tor is triggered cleanly when traversal fails or symmetric NAT is detected.
- Confirm keepalive intervals are short enough to preserve NAT mappings during idle periods.

**Phase 5: Testing**
- Keep the current bootstrap/punch prototype tests, but add upstream-facing Rust tests around the final protocol.
- Add unit tests for STUN client behavior.
- Add unit tests for signaling event encode/decode and session validation.
- Add unit tests for binary punch/ack packet handling.
- Add integration tests for two peers behind simulated NAT using Docker plus `iptables`/netns.
- Add failure tests for one-sided symmetric NAT and both-sided symmetric NAT.
- Add fallback tests proving TCP/Tor takeover works when UDP traversal fails.
- Add LAN optimization tests proving same-subnet peers connect via local address.
- Add long-idle tests to validate heartbeat-driven NAT mapping retention.
- Add packet-loss and relay-latency tests so the retry logic is exercised, not just the happy path.

**Phase 6: Upstream Integration And Delivery**
- Split reusable pieces from this repo into upstream-appropriate modules: STUN client, signaling client, punch engine, and transport handoff adapter.
- Port the Rust bootstrap prototype into upstream FIPS rather than keeping it as a sidecar CLI only. The current handoff artifact in [rust/bootstrap-client/src/main.rs](/home/tom/code/fips-nostr-bootstrap/rust/bootstrap-client/src/main.rs#L204) is useful scaffolding, not the final architecture.
- Add config parsing for NAT traversal options from the issue’s proposed config shape.
- Integrate traversal into peer dialing policy and transport priority selection.
- Add observability: session IDs, STUN result, punch result, chosen candidate path, fallback reason, and handshake outcome.
- Document operational requirements: relay quality, STUN availability, NAT limits, firewall expectations, and fallback behavior.
- Write an upstream operator runbook and migration notes.
- Land in slices: protocol/spec PR, STUN PR, signaling PR, punch/handoff PR, test/ops PR.

**Sensible Extra Steps Beyond The Issue Text**
- Freeze one versioned protocol namespace early so prototype drift stops.
- Build a capture/replay harness for signaling transcripts and UDP punch traces; it will make debugging much faster.
- Add a NAT capability taxonomy in logs and metrics so failures become classifiable rather than “timeout”.
- Support multiple relays per session and define how relay disagreement or delay affects offer/answer freshness.
- Decide whether advertisement data is signed long-lived identity state or ephemeral capability state.
- Add a small interop harness using this repo as the non-upstream peer until upstream FIPS has both initiator and responder implementations.
- Use the existing mobile client in [mobile/flutter_fips_client/README.md](/home/tom/code/fips-nostr-bootstrap/mobile/flutter_fips_client/README.md#L1) as a validation target after the Rust signaling and punch layers stabilize.

**Recommended Execution Order**
1. Finalize protocol and socket strategy.
2. Build the reusable Rust STUN client.
3. Implement upstream Nostr signaling with final schemas.
4. Implement binary punch/ack on the real transport socket.
5. Integrate handoff into upstream UDP plus Noise/FMP.
6. Add NAT simulation, fallback, and LAN optimization tests.
7. Only then wire in advertisement/discovery polish and operational hardening.

