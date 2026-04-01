# fips-nostr-rendezvous (Rust)

Rust protocol/runtime crate for the functional rendezvous path.

Current scope:
- protocol types and packet helpers
- legacy `hello -> server-info` wire structs
- `FIPS1` session frame helpers
- long-running shell server binary

## Build

```bash
cd rust/fips-nostr-rendezvous
cargo build
```

## Run the Rust shell server

```bash
cd rust/fips-nostr-rendezvous
cargo run --bin fips-shell-server -- \
  --nsec "$NOSTR_NSEC" \
  --udp-port 9999
```

Useful options:

```bash
--advert-relays 'wss://offchain.pub,wss://www.nostr.ltd,wss://relay.nostr.band'
--dm-relays 'wss://nip17.com,wss://nip17.tomdwyer.uk,wss://relay.nostr.band,wss://offchain.pub,wss://www.nostr.ltd'
--public-host '203.0.113.10'
--stun-servers 'stun:fips.tomdwyer.uk:3478,stun:stun.l.google.com:19302'
--trusted-npubs 'npub1...,npub1...'
```

For local embedded-relay tests, disable STUN by passing:

```bash
--stun-servers ''
```

The current web UI remains in `.mjs`, but the long-running functional server path now has a Rust implementation.
