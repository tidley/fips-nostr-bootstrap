# Failure taxonomy + refinement checklist

## Classes
1. signalling_loss
2. timing_mismatch
3. nat_incompatibility
4. endpoint_misprediction
5. identity_or_signature_mismatch
6. replay_or_nonce_reuse
7. retry_exhaustion

## Checklist per failed case
- classify failure class
- inspect state transition logs
- inspect probe attempts and candidate ordering
- change one variable only:
  - probe interval
  - max attempts
  - ack timeout
  - session expiry
  - fallback threshold
- rerun same scenario until stable
- accept only if deterministic + replay-safe
