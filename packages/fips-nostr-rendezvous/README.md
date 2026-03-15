# @fips/nostr-rendezvous

Standalone library for **NIP-17 Nostr rendezvous + UDP hole punching**.

Purpose: bootstrap a direct path and then hand off to your app transport (SSH shell proxying, file transfer protocol, media, etc.).

## Install

```bash
npm i @fips/nostr-rendezvous
```

## Quick usage

```js
import { createFipsNostrRendezvousNode } from '@fips/nostr-rendezvous';

const server = createFipsNostrRendezvousNode({
  relays: ['wss://nos.lol'],
  trustedNpubs: [], // optional allowlist
  udpPort: 9999,
});

await server.start();
console.log('server npub:', server.getNpub());

// On another machine/process:
const client = createFipsNostrRendezvousNode({ relays: ['wss://nos.lol'], udpPort: 0 });
await client.start();
const session = await client.connect('<SERVER_NPUB>');
console.log(session);
```

`session` includes:
- `established` state
- selected `remote` endpoint
- active UDP `socket` for higher-level protocols

## Trusted npubs

Set ACL with:

```js
node.setTrustedNpubs(['npub1...','npub1...']);
```

Incoming rendezvous requests from unknown npubs are rejected (`reject` event).

## Current scope

- NIP-17 DM rendezvous
- optional NIP-42 relay auth (via nostr-tools)
- simultaneous UDP punch probes
- allowlist-based trust gate

Not yet included:
- TURN/relay data fallback
- built-in SSH/file/video protocol layers (you attach these after session establishment)
