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
  advertRelays: ['wss://offchain.pub', 'wss://www.nostr.ltd', 'wss://relay.nostr.band'],
  dmRelays: ['wss://nip17.com', 'wss://nip17.tomdwyer.uk', 'wss://relay.nostr.band', 'wss://offchain.pub', 'wss://www.nostr.ltd'],
  trustedNpubs: [], // optional allowlist
  udpPort: 9999,
});

await server.start();
console.log('server npub:', server.getNpub());
// server now publishes a public traversal advert by default

// On another machine/process:
const client = createFipsNostrRendezvousNode({
  advertRelays: ['wss://offchain.pub', 'wss://www.nostr.ltd', 'wss://relay.nostr.band'],
  dmRelays: ['wss://nip17.com', 'wss://nip17.tomdwyer.uk', 'wss://relay.nostr.band', 'wss://offchain.pub', 'wss://www.nostr.ltd'],
  udpPort: 0,
});
await client.start();
const peers = await client.listAdvertisedPeers({ waitMs: 5000 });
const session = await client.connectToDiscoveredPeer({ discoveryWaitMs: 5000, waitMs: 30000 });
console.log(session);
```

If you already know the target identity, `connectToAdvertisedPeer('<SERVER_NPUB>')` is still supported.

If you omit relay settings, the library uses separate embedded defaults for advert relays and DM relays. You can still pass `relays` as a legacy shorthand to use one shared list for both.

`session` includes:
- `established` state
- selected `remote` endpoint
- active UDP `socket`
- `session` channel object with `.send(channel, payload, type)`

Example channels:

```js
// app-level channels over established punched path
session.session.send('shell', { cmd: 'uname -a' }, 'request');
session.session.send('file', { name: 'foo.txt', chunk: 'base64...' }, 'chunk');
session.session.send('media', { audio: 'opus-frame-base64' }, 'frame');

session.session.on('channel:shell', (payload, frame) => {
  console.log('shell payload', payload, frame.type);
});
```

This is a lightweight framing layer to start integrating SSH/file/video style protocols; reliability/ordering/encryption policy beyond transport should be added by higher layers.

## Trusted npubs

Set ACL with:

```js
node.setTrustedNpubs(['npub1...','npub1...']);
```

Incoming rendezvous requests from unknown npubs are rejected (`reject` event).

## Current scope

- NIP-17 DM rendezvous
- public availability advert publication/discovery
- optional NIP-42 relay auth (via nostr-tools)
- simultaneous UDP punch probes
- allowlist-based trust gate

Not yet included:
- TURN/relay data fallback
- built-in SSH/file/video protocol layers (you attach these after session establishment)
