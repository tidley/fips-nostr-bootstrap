# STATUS

Phase: STUN-only media path stabilized; preparing FIPS integration bridge

Objective: Keep NIP-17 DM bootstrap + STUN-only call path reliable, then define/implement a clean handoff into `jmcorgan/fips` as the post-bootstrap data plane.

Current snapshot:
- Signaling classification is working (`is_call_signal=true` with matched tags).
- STUN-only connectivity is working with standalone Vultr STUN endpoint.
- ICE candidate ordering bug fixed (queue until remoteDescription).
- Join flow improved (auto media acquire + explicit receive-only fallback).
- Remaining issue area: intermittent “connected but no media” debugging and state-machine hardening.
