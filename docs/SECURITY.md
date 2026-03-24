# Security Baseline

## Threats in scope
- Signaling replay/spoof attempts
- Endpoint poisoning/malformed control payloads
- STUN abuse and reflective traffic misuse
- Session confusion across concurrent handshakes

## Controls
- Freshness checks (nonce + bounded timestamp window)
- Strict schema validation for signaling payloads
- Trusted peer policy / allowlists where required
- Correlation IDs and session binding checks
- STUN listener rate limiting + observability
- Structured logs without secret leakage

## Key handling
- Keep private keys outside source tree.
- Prefer env/file secrets with restricted permissions.
- Rotate keys and maintain revocation procedures.

## Security test expectations
- Replay test cases
- Invalid/malformed payload rejection tests
- Session mix-up regression tests
- STUN malformed packet robustness tests
