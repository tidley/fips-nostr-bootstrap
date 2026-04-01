# RISKS

- Live relay tests still do not prove NIP-17 DM receipt or server roundtrip reliably; publish success alone is not enough.
- There are now two traversal models in the repo; drift is possible until the live runtime adopts the new flow.
- Downstream integration target (`ops-dashboard`) is outside current writable roots, so implementation there is blocked on approval.
- The new traversal flow is still pure/harness-level; production runtime behavior may expose additional state/timing issues once wired in.
