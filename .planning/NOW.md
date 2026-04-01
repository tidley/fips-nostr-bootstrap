# NOW

1. Finish Slice 7 runtime integration:
   - propagate the new private `offer` / `answer` runtime path through the remaining app and integration-test entry points
   - remove remaining user-facing assumptions that a target `npub` is required for discovery-first clients
   - keep the working UDP probe path intact during migration

2. Tighten live validation:
   - treat "publish succeeded but DM not observed" as a real relay delivery failure
   - separate relay-delivery checks from server-roundtrip checks more clearly
   - verify live server roundtrip against both traversal `answer` and legacy `server-info` responders

3. Prepare downstream consumer integration:
   - carry the traversal flow into `ops-dashboard` once edit approval is available
   - use the new advert/discovery model instead of pre-known endpoint exchange
   - prefer “browse adverts -> connect” UX over “paste peer npub” UX
