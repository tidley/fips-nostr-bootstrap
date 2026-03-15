# FIPS Termux Wrapper (Android)

Small Android app wrapper that launches the working Node client in Termux.

## What this is

- Native Android UI for entering server `npub`
- Launches Termux command:
  - `node apps/fips-pty-client.mjs --npub <SERVER_NPUB> --wait <MS>`

## Requirements on phone

1. Install Termux (`com.termux`)
2. In Termux:
   ```bash
   pkg update
   pkg install nodejs git
   git clone https://github.com/tidley/fips-nostr-bootstrap.git
   cd fips-nostr-bootstrap
   npm install
   ```
3. Ensure repo path is:
   `/data/data/com.termux/files/home/fips-nostr-bootstrap`

## Build app

Open `android/fips-termux-wrapper` in Android Studio and run.

## Notes

- This wrapper does not replace Termux yet; it drives the existing Node client.
- Best for quick mobile usage without manually typing long commands.
- For stricter security, pin/validate trusted server npub in app preferences (next step).
