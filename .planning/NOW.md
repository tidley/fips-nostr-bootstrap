# NOW

1. Finish video media-flow reliability pass:
   - verify transceiver/sender logs on both peers
   - remove stale/misleading failure hint when connected
   - ensure no glare/offer overlap regressions

2. Document and lock STUN-lite production runbook on Vultr:
   - systemd service
   - firewall and health checks
   - basic troubleshooting matrix

3. Draft `jmcorgan/fips` integration adapter:
   - NIP-17 bootstrap transcript schema
   - handshake state transitions
   - handoff contract to FIPS session/data plane
