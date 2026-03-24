# FIPS Mobile Client (Flutter)

Thin Flutter app to bootstrap and test FIPS connectivity via a Nostr relay.

## Features
- Bootstrap: obtains server info, endpoint, STUN details, and RTT.
- Echo Test: sends a UDP probe and performs a FIPS1-framed roundtrip.
- Material 3 UI with live status cards.

## Setup

### Prerequisites
- Flutter SDK (>=3.3)
- Rust toolchain (stable)

### Build the Rust core and generate bindings

1. Add the Rust crate API:
   - The Rust implementation lives in `fips-nostr-bootstrap` (this repo).
   - For now, you need to copy or link the `rust/bootstrap-client` logic into a new crate `mobile/rust/fips_mobile_core` (or use the provided scaffolding).

2. Install `flutter_rust_bridge_codegen`:
   ```bash
   cargo install flutter_rust_bridge_codegen --version 2.11.1
   ```

3. Generate the Dart FFI bindings:
   ```bash
   cd /home/tom/code/fips-nostr-bootstrap/mobile/flutter_fips_client
   flutter pub get
   flutter_rust_bridge_codegen generate
   ```
   This will create `lib/src/rust/frb_generated.dart` and `rust/src/frb_generated.rs`.

4. Complete the Rust `Cargo.toml` dependencies:
   Ensure `flutter_rust_bridge` is in `[dependencies]` (already in pubspec.yaml).

5. Build the Rust library:
   ```bash
   cd rust
   cargo build --release
   ```

6. Run the Flutter app:
   ```bash
   flutter run
   ```

## Notes
- The `bridge.dart` wrapper provides `apiBootstrap` and `apiEchoTest` that return formatted JSON strings.
- Default relay and server npub are pre-filled; edit to change.
- The mobile app talks to the same Nostr relay used by the devbox FIPS server.

## Troubleshooting
- If bindings are not generated, you'll see `UnimplementedError`.
- Make sure `rust/src/lib.rs` declares `mod frb_generated;` (codegen does this automatically).
