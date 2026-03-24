# Operations Runbook

## Deployment model
Recommended production topology:
- `fips-transport.service`
- `nostr-relay-bridge.service`
- `stun-lite.service`

Or single-binary dev mode with `--role all`.

## Network ports
- STUN: UDP 3478 (or configured alternative)
- Relay: WSS/TLS endpoint (typically 443)
- FIPS transport: configured UDP ports for session establishment

## Health checks
- Relay health: websocket accept + publish/subscribe smoke check.
- STUN health: synthetic binding request receives valid mapped response.
- Transport health: session establishment smoke test in staging.

## Incident triage quick path
1. Check relay availability and auth/rate-limit logs.
2. Check STUN binding request volume and response rate.
3. Check NAT outcome metrics (symmetric NAT concentration).
4. Check transport handshake failure taxonomy.
5. Validate fallback path activation metrics.

## Release checklist
- Unit/integration/e2e suite green.
- Metrics dashboards updated.
- Runbook tested by non-author.
- Rollback plan documented.
