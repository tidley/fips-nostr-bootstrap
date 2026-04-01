# NEXT

1. Update the remaining integration tests and app entry points to treat traversal `offer` / `answer` as the primary private signaling path.
2. Tighten live relay tests so missing DM delivery is a hard failure instead of a warning.
3. Add live/public-relay coverage for advert-only discovery and connect without a pre-known `npub`.
4. Add transcript/debug export for advert discovery, offer / answer, and punch planning.
5. Revisit upstream FIPS handoff once the runtime path is using the new traversal flow by default.
