# Issue 37 Execution TODO

Goal: evolve this repo from "known peer bootstrap + punch" into "advertise -> discover -> private signaling -> exchange candidates -> punch", excluding the final upstream FIPS transport handoff.

## Current status

- Existing:
  - NIP-17/NIP-59 private bootstrap messages
  - endpoint reply and punch timing
  - UDP punch probe / ack flow
  - STUN probe test coverage
- Missing front-half:
  - public advertisement event model
  - discovery/query + advert selection
  - explicit offer / answer candidate exchange
  - deeper STUN integration into signaling state

## Execution slices

### Slice 1: Advertisement schema + discovery selection

Outcome:
- publishable advertisement shape for NAT traversal capability
- validation rules for adverts
- deterministic selection of the best advert for a target peer

Tasks:
- [x] Add TS types for traversal advertisement and candidate metadata
- [x] Add pure validation helpers for advert shape and freshness
- [x] Add deterministic advert selection for a peer and protocol version
- [x] Export the new module from `src/index.ts`
- [x] Add unit tests covering valid advert, stale advert, bad protocol, and selection ordering

### Slice 2: In-memory advert directory

Outcome:
- testable stand-in for Nostr replaceable advert discovery

Tasks:
- [x] Add in-memory publish/query store for advertisements
- [x] Query by `npub`, protocol, and freshness window
- [x] Replace older adverts from the same publisher/version
- [x] Add unit tests for replacement, filtering, and query ordering

### Slice 3: Offer / answer wire contract

Outcome:
- explicit traversal offer / answer messages instead of custom `hello -> server-info`

Tasks:
- [x] Define offer payload with session id, candidate set, and timing hints
- [x] Define answer payload with responder candidate set and acceptance
- [x] Add validation helpers for replay/freshness checks
- [x] Add unit tests for encode/decode and reject cases

### Slice 4: Signaling adapter support for adverts + offer / answer

Outcome:
- one adapter model that can handle both public advert discovery and private traversal signaling

Tasks:
- [x] Extend the in-memory signal layer to handle adverts and private messages separately
- [x] Add pull/query helpers for public adverts
- [x] Preserve ordered delivery for private signaling
- [x] Add unit tests for mixed advert/private traffic

### Slice 5: STUN result integration

Outcome:
- signaling uses actual candidate data, not just endpoint + optional STUN URI

Tasks:
- [x] Introduce candidate model for `host` and `srflx`
- [x] Convert STUN probe output into candidate records
- [x] Attach candidate sets to offer / answer
- [x] Add unit tests for candidate normalization and fallback

### Slice 6: Punch planner

Outcome:
- pure planner deciding when and where to punch

Tasks:
- [x] Add selection logic for local vs reflexive endpoints
- [x] Add negotiated punch start window helper
- [x] Add bounded retry schedule
- [x] Add unit tests for LAN preference and retry schedule

### Slice 7: Runtime integration

Outcome:
- end-to-end prototype flow: advertise -> discover -> signal -> punch

Tasks:
- [x] Wire advert directory into demo/runtime code
- [x] Replace custom bootstrap path with offer / answer flow in the JS rendezvous package runtime
- [x] Keep existing working punch mechanism until binary punch format work starts
- [x] Keep legacy `hello -> server-info` compatibility during the migration window
- [x] Add integration tests for unknown-peer discovery flow
- [x] Add advert-browsing runtime path that can connect without a pre-known `npub`
- [ ] Update remaining app/test entry points to assume `offer` / `answer` first and `hello` fallback second

### Slice 8: Runtime hardening toward issue #37

Outcome:
- live runtime uses STUN reflexive addresses and recipient inbox relay hints instead of only local interface guesses

Tasks:
- [x] Add live STUN observation on the JS rendezvous socket with fallback across configured STUN servers
- [x] Feed STUN-derived reflexive/local addresses into advert publish and offer / answer creation
- [x] Publish `kind 10050` inbox relay metadata with sensible defaults
- [x] Resolve recipient inbox relay hints from `kind 10050` before DM signaling, with default relay fallback
- [x] Replace JSON-only punch packets with binary punch / ack support using session-hash magic values
- [x] Add public-event cleanup metadata: NIP-40 expiration on adverts and NIP-09 deletion for superseded/shutdown public events
- [ ] Add disappearing-message cleanup for wrapped DM signaling events

### Slice 9: Reliability and topology verification

Outcome:
- repo has explicit regression coverage for NAT edge cases and multi-client runtime behavior

Tasks:
- [x] Add runtime STUN integration test against a fake local STUN server
- [x] Add simulated NAT integration tests for LAN-preferred success and symmetric NAT fallback
- [x] Add shared-socket multi-client integration test to prove current runtime can multiplex sessions
- [ ] Add same-subnet parallel local+reflexive punch attempts in the live JS runtime
- [ ] Add Docker/netns-style NAT integration beyond the pure simulation layer
- [ ] Add recipient `kind 10050` lookup against live public relays in the live suite

### Slice 10: Functional migration onto Rust

Outcome:
- long-running functional runtime moves from the JS package into Rust, while `.mjs` remains acceptable for UI/test harnesses

Tasks:
- [x] Add Rust long-running shell server binary interoperable with the current JS client/web console path
- [x] Publish adverts and inbox relay metadata from Rust
- [x] Receive gift-wrapped DMs and answer legacy `hello -> server-info` from Rust
- [x] Perform binary punch / ack and shell-session handling from Rust
- [x] Add JS/Rust interop coverage with the embedded relay harness
- [ ] Move the dialing/client runtime into Rust
- [ ] Decide whether `.mjs` UI should spawn a Rust local daemon or call a Rust HTTP bridge
- [ ] Port offer / answer handling into the Rust runtime so the legacy `hello` path can become fallback-only
- [ ] Port STUN refresh and LAN-parallel candidate attempts into the Rust runtime

### Auto-connect / retry / fallback checklist

- [ ] Add peer config flag for NAT traversal enablement in downstream consumers
- [ ] Try advert discovery first for configured NAT peers before direct UDP assumptions
- [ ] Resolve recipient `kind 10050` inbox relays before each new DM signaling session
- [ ] Refresh STUN observation before each new outbound traversal attempt
- [ ] Retry offer delivery with exponential backoff instead of fixed 5s cadence
- [ ] Apply a short punch timeout path distinct from the longer relay-answer timeout
- [ ] Detect symmetric NAT / unrecoverable direct failure and mark the attempt as non-punchable
- [ ] Fall back to alternate configured transports (TCP/Tor/FIPS-specific fallback) after punch failure
- [ ] Persist failure reason taxonomy for relay timeout vs STUN failure vs punch timeout vs symmetric NAT
- [ ] Add reconnect scheduling so failed traversal attempts feed the existing auto-connect loop cleanly

## Nice-to-have after Slice 7

- capture/replay harness for signaling transcripts
- metrics taxonomy for NAT failure modes
- multi-relay advert reconciliation
- mobile-client validation pass against the new signaling flow

## Active now

- Completed: Slice 1, test-first
- Completed: Slice 2, test-first
- Completed: Slice 3, test-first
- Completed: Slice 4, test-first
- Completed: Slice 5, test-first
- Completed: Slice 6, test-first
- In progress: Slice 7
- Next concrete test target:
  - tighten relay-delivery failure handling in the live suite
  - add recipient `kind 10050` lookup against real public relays
  - implement live LAN optimization with parallel local + reflexive attempts
