# fips-bootstrap-client (Rust)

Rust bootstrap client for:

1. Sending `fips.rendezvous.hello` over Nostr (NIP-17 gift wrap)
2. Receiving/decrypting `fips.rendezvous.server-info`
3. Optionally running UDP punch probing (`--mode connect`)
4. Writing handoff JSON for downstream FIPS data-plane startup

## Implemented (Phase 1)

- ✅ Nostr relay websocket transport (`REQ` / `EVENT` / `OK` handling)
- ✅ NIP-17-compatible wrapping + unwrapping via `nostr` crate gift wrap APIs
- ✅ Wire schema validation (`version`, `sessionId`, `nonce`)
- ✅ Bootstrap response parsing (`endpoint`, `stun`, `punch`)
- ✅ UDP punch probe loop (`PROBE` / `PROBE_ACK`)
- ✅ Handoff JSON output (`--out-handoff`)

## Build

```bash
cd rust/bootstrap-client
cargo build --release
```

## Run (bootstrap only)

```bash
./target/release/fips-bootstrap-client \
  --relay wss://fips.tomdwyer.uk \
  --server-npub <server_npub> \
  --mode bootstrap
```

## Run (bootstrap + connect)

```bash
./target/release/fips-bootstrap-client \
  --relay wss://fips.tomdwyer.uk \
  --server-npub <server_npub> \
  --mode connect \
  --timeout-ms 25000
```

## Write handoff

```bash
./target/release/fips-bootstrap-client \
  --relay wss://fips.tomdwyer.uk \
  --server-npub <server_npub> \
  --mode connect \
  --out-handoff /tmp/fips-handoff.json
```

## Notes

- `9999` is not protocol-fixed; any reachable UDP port can work if advertised in `server-info.endpoint.port` and reachable via NAT traversal.
- For stable identity in testing, pass `--nsec <nsec...>`; otherwise an ephemeral key is generated each run.
