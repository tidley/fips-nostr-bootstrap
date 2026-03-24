# NOW

1. Validate new docs + test baseline in CI/local:
   - run `npm test`
   - run `go test ./...` under `tools/stun-lite`
   - fix any regressions

2. Implement runtime role surface for combined daemon:
   - `--role fips|relay|stun|all`
   - fail-fast config validation per role

3. Start FIPS adapter implementation from parity matrix:
   - keep transport semantics aligned with `jmcorgan/fips`
   - integrate NIP-17 bootstrap transcript and STUN endpoint hints as adapters only
