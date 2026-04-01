# NOW

1. Continue the Rust functional migration:
   - keep the server-side runtime in Rust as the default direction from now on
   - move the dialing/client runtime out of the JS package and into Rust
   - decide how the `.mjs` UI should talk to Rust locally: spawned daemon vs HTTP bridge

2. Tighten live validation:
   - treat "publish succeeded but DM not observed" as a real relay delivery failure
   - separate relay-delivery checks from server-roundtrip checks more clearly
   - verify live roundtrip against the new Rust shell server path, not only the JS server path

3. Prepare downstream consumer integration:
   - carry the traversal flow into `ops-dashboard` once edit approval is available
   - use the new advert/discovery model instead of pre-known endpoint exchange
   - prefer “browse adverts -> connect” UX over “paste peer npub” UX
