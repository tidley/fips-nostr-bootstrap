# fips-bootstrap-client (Rust)

Legacy Rust bootstrap client focused on the older `hello -> server-info` flow.

This crate is no longer the primary runtime path in the repo. The main functional traversal path now lives in:
- [rust/fips-nostr-rendezvous/src/bin/fips-shell-server.rs](/home/tom/code/fips-nostr-bootstrap/rust/fips-nostr-rendezvous/src/bin/fips-shell-server.rs)
- [rust/fips-nostr-rendezvous/src/bin/fips-web-daemon.rs](/home/tom/code/fips-nostr-bootstrap/rust/fips-nostr-rendezvous/src/bin/fips-web-daemon.rs)

## What This Crate Still Does

- sends `fips.rendezvous.hello`
- receives `fips.rendezvous.server-info`
- optionally performs legacy UDP punch probing
- writes handoff JSON for downstream startup experiments

Important files:
- [src/main.rs](/home/tom/code/fips-nostr-bootstrap/rust/bootstrap-client/src/main.rs)
- [src/handoff.rs](/home/tom/code/fips-nostr-bootstrap/rust/bootstrap-client/src/handoff.rs)

## Current Value

Useful as:
- a reference for older bootstrap-only flows
- a handoff JSON shape example
- a small compatibility tool

Not useful as:
- the preferred traversal implementation
- the forward-looking FIPS integration path

## Build

```bash
cd /home/tom/code/fips-nostr-bootstrap/rust/bootstrap-client
cargo build --release
```

## Example

```bash
./target/release/fips-bootstrap-client \
  --relay wss://offchain.pub \
  --server-npub <server_npub> \
  --mode bootstrap
```

## Handoff Note

The JSON written by this crate is metadata-only. It does not solve the real remaining problem for FIPS integration, which is handing over an already established punched UDP path to the transport/session layer.

That real handoff work should now happen in the upstream FIPS repo branch, not here.
