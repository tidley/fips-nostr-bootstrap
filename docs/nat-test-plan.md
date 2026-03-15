# NAT Traversal Test Plan

Matrix:
- open/no NAT
- full cone
- restricted cone
- port-restricted cone
- symmetric

For each pair (A,B):
1. Run `runLocalHandshakeScenario`
2. Record: direct success, fallback usage, probes, elapsed time
3. Repeat N cycles (>=100 for soak)

Capture:
- establishment success rate
- time to establishment (median/p95/p99)
- probes per success
- fallback rate
- false-positive binds (must be 0)

Expected:
- direct succeeds for permissive combinations
- symmetric-involved combinations bias to fallback
- bounded timeout before fallback
