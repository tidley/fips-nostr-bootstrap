# FIPS Parity Matrix

Reference target: upstream `jmcorgan/fips`.

Purpose: track what in this repo is already a good candidate for reuse, what is still adapter logic, and what still blocks a real move into the FIPS repo.

## Current Matrix

| Area | Status | Current location | Notes |
|---|---|---|---|
| Nostr advert publication/discovery | New adapter logic | [rust/fips-nostr-rendezvous/src/bin/fips-shell-server.rs](/home/tom/code/fips-nostr-bootstrap/rust/fips-nostr-rendezvous/src/bin/fips-shell-server.rs), [rust/fips-nostr-rendezvous/src/bin/fips-web-daemon.rs](/home/tom/code/fips-nostr-bootstrap/rust/fips-nostr-rendezvous/src/bin/fips-web-daemon.rs) | Useful to port into FIPS branch as bootstrap/control-plane code. |
| `kind 10050` inbox relay routing | New adapter logic | [rust/fips-nostr-rendezvous/src/bin/fips-web-daemon.rs](/home/tom/code/fips-nostr-bootstrap/rust/fips-nostr-rendezvous/src/bin/fips-web-daemon.rs), [rust/fips-nostr-rendezvous/src/bin/fips-shell-server.rs](/home/tom/code/fips-nostr-bootstrap/rust/fips-nostr-rendezvous/src/bin/fips-shell-server.rs) | Now primary route selection; should stay adapter-side. |
| STUN endpoint discovery | New adapter logic | [rust/fips-nostr-rendezvous/src/bin/fips-shell-server.rs](/home/tom/code/fips-nostr-bootstrap/rust/fips-nostr-rendezvous/src/bin/fips-shell-server.rs), [rust/fips-nostr-rendezvous/src/bin/fips-web-daemon.rs](/home/tom/code/fips-nostr-bootstrap/rust/fips-nostr-rendezvous/src/bin/fips-web-daemon.rs) | Good candidate to reuse as pre-transport setup. |
| Offer/answer traversal signaling | New adapter logic | [rust/fips-nostr-rendezvous/src/lib.rs](/home/tom/code/fips-nostr-bootstrap/rust/fips-nostr-rendezvous/src/lib.rs) and Rust binaries | This is now the preferred bootstrap protocol in this repo. |
| Punch target planning | Adapted reusable helper | [rust/fips-nostr-rendezvous/src/lib.rs](/home/tom/code/fips-nostr-bootstrap/rust/fips-nostr-rendezvous/src/lib.rs) | Likely portable as-is into FIPS-side bootstrap. |
| Binary UDP punch packets | Adapted reusable helper | [rust/fips-nostr-rendezvous/src/lib.rs](/home/tom/code/fips-nostr-bootstrap/rust/fips-nostr-rendezvous/src/lib.rs) | Good candidate to keep unchanged. |
| Post-punch payload framing | Prototype only | [rust/fips-nostr-rendezvous/src/lib.rs](/home/tom/code/fips-nostr-bootstrap/rust/fips-nostr-rendezvous/src/lib.rs) | `FIPS1` demo frames are not the real FIPS transport. |
| Session lifecycle/state transitions | Partial adapter | mixed | Traversal setup is here; real FIPS session lifecycle is not yet integrated. |
| Real FIPS transport startup | Missing | n/a | Main remaining gap. |
| Handoff contract into FIPS | Missing | n/a | Needs to be defined before porting into upstream. |

## What Is Ready To Move

Best candidates to port into a FIPS branch:
- Rust STUN observation
- Rust advert and inbox relay logic
- Rust offer/answer structs and validation
- Rust punch packet helpers
- Rust punch target planning

## What Should Not Move As-is

These are repo-local demo/reference layers:
- `.mjs` web UI
- JS compatibility/runtime layers
- demo `FIPS1` session framing
- shell-demo payload handling
- long-term reliance on legacy `hello -> server-info`

## Remaining Parity Gap

The parity blocker is no longer discovery/signaling. It is transport ownership after punch success.

To close parity:
1. define the established-socket handoff contract
2. start real FIPS transport/session code on that punched path
3. remove demo framing from the data plane
4. add tests that prove authenticated transport startup after traversal

## Governance Rules

1. Keep traversal bootstrap adapter logic separate from FIPS transport semantics.
2. Do not change FIPS transport behavior inside this repo just to fit the prototype.
3. Any future divergence from upstream FIPS should be justified with test evidence.
