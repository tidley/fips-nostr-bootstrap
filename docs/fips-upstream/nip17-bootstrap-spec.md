# NIP-17 Bootstrap Spec (Draft)

Status: draft for upstream discussion  
Scope: discovery/bootstrap only (not session/data transport)

## 1) Goal

Define a minimal, interoperable NIP-17-based bootstrap protocol for peers that:

- know each other by `npub`
- need endpoint discovery + rendezvous coordination
- want to establish direct UDP/WebRTC paths
- do **not** trust relays for authenticity or integrity

This protocol is intentionally narrow: relay DMs are control-plane signaling only.

---

## 2) Non-goals

- No relay-media fallback
- No relay-based data plane
- No trust in relays for endpoint/session authenticity
- No long-term storage requirements

---

## 3) Design principles

1. **Bootstrap/signaling only over Nostr**
2. **Direct transport preferred** (UDP/WebRTC candidates)
3. **Peer identity = Nostr pubkey**
4. **Deterministic state machine + bounded retries**
5. **Observable diagnostics for NAT/punch behavior**

---

## 4) Message transport

- Nostr NIP-17 gift-wrap (`kind:1059`)
- receiver filter by `#p=[receiver_pubkey]`
- sender signs with its Nostr key (ephemeral or user-provided `nsec`)
- message content is JSON payload with `app` namespace

Envelope (inside rumor content):

```json
{
  "app": "fips.bootstrap.v1",
  "type": "...",
  "ts": 1710000000000,
  "...": "..."
}
```

`app` is required to avoid cross-app collisions.

---

## 5) Message types

## 5.1 `request_connect`
Initiator -> receiver: intent to start bootstrap.

```json
{
  "app":"fips.bootstrap.v1",
  "type":"request_connect",
  "ts":1710000000000
}
```

## 5.2 `request_accept`
Receiver -> initiator: acceptance + permission to proceed.

```json
{
  "app":"fips.bootstrap.v1",
  "type":"request_accept",
  "ts":1710000001000
}
```

## 5.3 `fips_candidates`
Either direction: candidate set + compact bloom summary for diagnostics/path hints.

```json
{
  "app":"fips.bootstrap.v1",
  "type":"fips_candidates",
  "candidates":[
    {"protocol":"udp","ip":"192.168.1.5","port":58877,"type":"host"},
    {"protocol":"udp","ip":"203.0.113.4","port":49152,"type":"srflx"}
  ],
  "bloom":"0f1a2b3c4d5e6f70",
  "ts":1710000001500
}
```

## 5.4 `offer`
Caller side SDP offer.

```json
{
  "app":"fips.bootstrap.v1",
  "type":"offer",
  "sdp": {"type":"offer","sdp":"..."},
  "ts":1710000002000
}
```

## 5.5 `answer`
Callee side SDP answer.

```json
{
  "app":"fips.bootstrap.v1",
  "type":"answer",
  "sdp": {"type":"answer","sdp":"..."},
  "ts":1710000002300
}
```

## 5.6 `ice`
Trickle ICE candidate.

```json
{
  "app":"fips.bootstrap.v1",
  "type":"ice",
  "candidate": {"candidate":"...","sdpMid":"0","sdpMLineIndex":0},
  "ts":1710000002400
}
```

## 5.7 `call_end`
Session teardown signal.

```json
{
  "app":"fips.bootstrap.v1",
  "type":"call_end",
  "ts":1710000010000
}
```

---

## 6) State machine (high level)

1. **Idle**
2. `request_connect` sent/received
3. **Accepted** (`request_accept`)
4. **Offer/answer exchange**
5. **ICE exchange**
6. **Connected** (direct path established)
7. **Failed** (bounded retries exhausted)
8. **Ended** (`call_end` or manual end)

Rules:
- Ignore messages from unaccepted peers after accept-gating is active.
- Reset pending offers/candidates on full reconnect cycle.
- Keep retries bounded.

---

## 7) Reliability policy (UDP-only philosophy)

- Immediate ICE candidate forwarding (no delayed relay fallback paths)
- Bounded reconnect attempts (`max=3` default)
- One-shot ICE restart before full peer rebuild
- Explicit fail terminal state when budget exhausted

No TURN requirement in baseline policy.

---

## 8) Security notes

- Relay is untrusted transport for signaling only.
- Authenticity derives from sender signature + app-level peer gating.
- Receiver should maintain allowlist/accept list for active peer.
- Do not assume relay order/delivery guarantees.

---

## 9) Interop requirements

Required:
- NIP-17 wrapping/unwrapping
- `app` namespace check
- unknown-message ignore behavior
- tolerate duplicate/reordered messages

Recommended:
- include timestamps for local observability
- expose user-facing status transitions
- provide machine-readable diagnostics output

---

## 10) CLI Harness (detailed)

Purpose: provide reproducible, machine-readable validation of bootstrap reliability across NAT/network scenarios.

## 10.1 What the harness does

Given two peers (server/client mode), it runs full bootstrap cycles and records:

- signaling success/failure by phase
  - request/accept
  - offer/answer
  - ICE exchange
  - connected/failed terminal state
- timing per phase (ms)
- retry stage used
  - none
  - ice-restart
  - full-reconnect
- candidate diagnostics
  - local/remote candidate classes (host/srflx/relay)
  - bloom summary
- throughput/latency snapshots (if connected)
- failure taxonomy
  - timeout
  - permission/context issue
  - ice-failed
  - peer-unreachable

Output should be both:
1. human log lines
2. JSON result artifact for analysis/aggregation

## 10.2 Suggested CLI shape

```bash
node scripts/bootstrap-harness.mjs \
  --mode server|client|local \
  --npub <SERVER_NPUB> \
  --rounds 20 \
  --wait-ms 60000 \
  --retry-max 3 \
  --out results/bootstrap-run.json \
  --debug
```

## 10.3 JSON result schema (suggested)

```json
{
  "runId": "2026-03-15T23:00:00Z-abc123",
  "app": "fips.bootstrap.v1",
  "rounds": 20,
  "successes": 14,
  "failures": 6,
  "phases": {
    "requestAcceptOk": 19,
    "offerAnswerOk": 17,
    "iceConnected": 14
  },
  "retry": {
    "none": 9,
    "iceRestart": 3,
    "fullReconnect": 2,
    "exhausted": 6
  },
  "timingMs": {
    "requestAcceptP50": 420,
    "offerAnswerP50": 210,
    "iceConnectP50": 3100,
    "totalP95": 18400
  },
  "failReasons": {
    "ice-failed": 4,
    "timeout": 1,
    "permission": 1
  }
}
```

## 10.4 Why this harness matters for FIPS upstream

- Gives concrete evidence for Nostr-bootstrap viability
- Quantifies reliability under different NAT pairs
- Separates control-plane success from data-plane success
- Surfaces whether simple retry policy materially improves outcomes

---

## 11) Incremental upstream plan

1. Land this spec as discussion doc
2. Add test vectors + JSON fixtures
3. Share harness output from 2+ real NAT scenarios
4. Align message names/fields with FIPS core naming conventions
5. Promote to versioned bootstrap profile (e.g. `fips.bootstrap.v1`)

---

## 12) Open questions

- Should `request_accept` carry explicit capability hints?
- Should candidate snapshots be mandatory or optional diagnostics?
- Should failure taxonomy be standardized in protocol or implementation docs?
- How strict should clock/timestamp handling be for replay resistance in bootstrap layer?
