# @fips/nostr-rendezvous

TypeScript/JavaScript rendezvous library for Nostr discovery/signaling plus UDP hole punching.

This package is still useful, but it is no longer the primary functional runtime in this repo. New functional work is now centered on the Rust crate in [rust/fips-nostr-rendezvous](/home/tom/code/fips-nostr-bootstrap/rust/fips-nostr-rendezvous).

## What This Package Is For

Use it for:
- protocol/reference behavior
- JS interop
- Node-based demos
- test harnesses

Do not treat it as the preferred place for new transport integration work.

## Important Files

- [src/index.ts](/home/tom/code/fips-nostr-bootstrap/packages/fips-nostr-rendezvous/src/index.ts)
  - JS rendezvous node
  - advert publication/discovery
  - STUN observation
  - offer/answer support
  - legacy compatibility
- [src/index.js](/home/tom/code/fips-nostr-bootstrap/packages/fips-nostr-rendezvous/src/index.js)
  - generated runtime artifact used by the `.mjs` apps
- [src/index.d.ts](/home/tom/code/fips-nostr-bootstrap/packages/fips-nostr-rendezvous/src/index.d.ts)
  - package types

## Current Capabilities

- NIP-17 DM rendezvous
- public traversal advert publication/discovery
- `kind 10050` inbox relay publication/lookup
- STUN-driven endpoint discovery
- Rust-aligned offer/answer support in the JS runtime
- simultaneous UDP punch probes
- lightweight `FIPS1` demo session framing

## Still Missing

- real downstream FIPS handoff
- production-grade transport/fallback policy
- replacement of demo framing with actual FIPS transport startup

## Minimal Usage

```js
import { createFipsNostrRendezvousNode } from '@fips/nostr-rendezvous';

const server = createFipsNostrRendezvousNode({
  advertRelays: ['wss://offchain.pub', 'wss://strfry.bitsbytom.com'],
  dmRelays: ['wss://nip17.com', 'wss://offchain.pub'],
  udpPort: 9999,
});

await server.start();
console.log(server.getNpub());
```

Client side:

```js
const client = createFipsNostrRendezvousNode({
  advertRelays: ['wss://offchain.pub', 'wss://strfry.bitsbytom.com'],
  dmRelays: ['wss://nip17.com', 'wss://offchain.pub'],
  udpPort: 0,
});

await client.start();
const peers = await client.listAdvertisedPeers({ waitMs: 5000 });
const session = await client.connectToDiscoveredPeer({ discoveryWaitMs: 5000, waitMs: 30000 });
```

## Session Surface

`session` includes:
- `established`
- selected `remote`
- active UDP `socket`
- `session` channel object with `.send(channel, payload, type)`

Example:

```js
session.session.send('shell', { cmd: 'uname -a' }, 'request');
session.session.on('channel:shell', (payload, frame) => {
  console.log(payload, frame.type);
});
```

This remains a demo/reference framing layer, not the final FIPS transport.

## Next Logical Step

For real FIPS integration, move to the Rust runtime and then into a branch of the upstream FIPS repo. This package should remain as:
- interop/reference implementation
- UI/demo support
- regression surface for the Rust migration
