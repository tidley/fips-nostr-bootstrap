# DECISIONS

- Use issue-37-aligned event kinds where sensible:
  - advert: `30078`
  - private traversal signaling: `21059`
- Keep advert data separate from private signaling:
  - advert carries relay/STUN/transports metadata
  - offer / answer carries reflexive + local addresses
- Keep live relay and live STUN checks opt-in:
  - default local test runs should not fail on external network instability
- Prefer incremental migration:
  - add pure traversal flow and harness bridge first
  - replace older runtime bootstrap path only after the new flow is proven end-to-end
- Keep the current UDP probe path alive during migration instead of rewriting live runtime behavior in one step.
