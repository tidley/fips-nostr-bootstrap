// @ts-nocheck
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { useWebSocketImplementation } from 'nostr-tools/relay';
import { startEmbeddedRelay } from './embedded_relay.js';
import { createFipsNostrRendezvousNode } from '../packages/fips-nostr-rendezvous/src/index.js';

const runUnknownPeerE2E = process.env.RUN_UNKNOWN_PEER_E2E === '1';
const describeUnknownPeer = runUnknownPeerE2E ? describe : describe.skip;

describeUnknownPeer('unknown-peer advert discovery flow', () => {
  let relay: Awaited<ReturnType<typeof startEmbeddedRelay>>;
  let server: ReturnType<typeof createFipsNostrRendezvousNode>;
  let client: ReturnType<typeof createFipsNostrRendezvousNode>;

  beforeAll(async () => {
    const wsMod = await import('ws');
    // @ts-ignore
    useWebSocketImplementation(wsMod.WebSocket || wsMod.default);

    relay = await startEmbeddedRelay({ port: 0 });

    server = createFipsNostrRendezvousNode({
      relays: [relay.url],
      udpPort: 0,
      publicHost: '127.0.0.1',
      advertiseIntervalMs: 250,
    });
    client = createFipsNostrRendezvousNode({
      relays: [relay.url],
      udpPort: 0,
      publicHost: '127.0.0.1',
      advertise: false,
      punchStartDelayMs: 50,
      punchIntervalMs: 50,
      punchDurationMs: 1_000,
    });

    await server.start();
    await client.start();
  });

  afterAll(async () => {
    client.close();
    server.close();
    await relay.close();
  });

  it('discovers a long-running advertised server and connects without a pre-known npub', async () => {
    const adverts = await client.listAdvertisedPeers({ waitMs: 500, maxPeers: 5 });
    expect(adverts.length).toBeGreaterThan(0);

    const conn = await client.connectToDiscoveredPeer({ discoveryWaitMs: 1_000, waitMs: 5_000, retryMs: 250 });

    expect(conn.discoveredAdvert.publisherNpub).toBe(server.getNpub());
    expect(conn.remote.port).toBeGreaterThan(0);
    expect(conn.established?.established).toBe(true);
  }, 20_000);
});
