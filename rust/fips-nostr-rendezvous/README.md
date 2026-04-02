# fips-nostr-rendezvous (Rust)

Rust protocol/runtime crate for the functional rendezvous path.

Current scope:
- protocol types and packet helpers
- legacy `hello -> server-info` wire structs
- `FIPS1` session frame helpers
- long-running shell server binary
- Rust web daemon for the web console client path

## Build

```bash
cd rust/fips-nostr-rendezvous
cargo build
```

## Known-good demo profile

These are the current known-good defaults for the internet demo:
- advert relays: `wss://offchain.pub`
- DM relays: `wss://nip17.com,wss://offchain.pub`
- STUN servers: `stun:fips.tomdwyer.uk:3478,stun:stun.l.google.com:19302`

## Run the Rust shell server

```bash
cd /home/tom/code/fips-nostr-bootstrap && \
FIPS_STUN_SERVERS='stun:fips.tomdwyer.uk:3478,stun:stun.l.google.com:19302' \
cargo run --manifest-path rust/fips-nostr-rendezvous/Cargo.toml --bin fips-shell-server -- \
  --nsec "$NOSTR_NSEC" \
  --udp-port 9999 \
  --advert-relays 'wss://offchain.pub' \
  --dm-relays 'wss://nip17.com,wss://offchain.pub'
```

## Run the web console client

```bash
cd /home/tom/code/fips-nostr-bootstrap && \
FIPS_STUN_SERVERS='stun:fips.tomdwyer.uk:3478,stun:stun.l.google.com:19302' \
NOSTR_NSEC="$NOSTR_NSEC" \
node apps/fips-web-console.mjs \
  --advert-relays 'wss://offchain.pub' \
  --dm-relays 'wss://nip17.com,wss://offchain.pub'
```

Useful options:

```bash
--advert-relays 'wss://offchain.pub'
--dm-relays 'wss://nip17.com,wss://offchain.pub'
--public-host '203.0.113.10'
--stun-servers 'stun:fips.tomdwyer.uk:3478,stun:stun.l.google.com:19302'
--trusted-npubs 'npub1...,npub1...'
```

For local embedded-relay tests, disable STUN by passing:

```bash
--stun-servers ''
```

The current web UI remains in `.mjs`, but both the long-running server path and the web-console client/daemon path now run on Rust.
