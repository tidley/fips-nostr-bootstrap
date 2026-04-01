# Upstream FIPS integrated bootstrap (Option 1)

This is for running **upstream `jmcorgan/fips`** with integrated Nostr bootstrap:

```bash
fips \
  --config /path/to/fips.yaml \
  --bootstrap-relay wss://fips.tomdwyer.uk \
  --bootstrap-server-npub <SERVER_NPUB> \
  --bootstrap-timeout-ms 15000
```

## Why this config exists

If upstream `fips` starts with no transport configured, bootstrap peer injection succeeds but it cannot connect (`transports: 0`).

The minimal config below provides one UDP transport so data-plane connection can be attempted immediately.

See: `docs/upstream-fips-minimal-bootstrap.yaml`

## Minimal run

```bash
# in jmcorgan/fips repo
cp /path/to/upstream-fips-minimal-bootstrap.yaml ./fips.yaml

fips \
  --config ./fips.yaml \
  --bootstrap-relay wss://fips.tomdwyer.uk \
  --bootstrap-server-npub <SERVER_NPUB> \
  --bootstrap-timeout-ms 15000
```

Expected log line when bootstrap injects peer:

- `Applied live bootstrap peer ...`

Then node should show non-zero transports and proceed with UDP peer connect attempts.
