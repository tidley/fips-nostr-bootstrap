// @ts-nocheck
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startEmbeddedRelay, type EmbeddedRelayServer } from './embedded_relay.js';
import { createFipsNostrRendezvousNode } from '../packages/fips-nostr-rendezvous/src/index.js';

describe('shared socket multi-client integration', () => {
  let relay: EmbeddedRelayServer;
  let server: ReturnType<typeof createFipsNostrRendezvousNode>;
  let clientA: ReturnType<typeof createFipsNostrRendezvousNode>;
  let clientB: ReturnType<typeof createFipsNostrRendezvousNode>;

  beforeAll(async () => {
    relay = await startEmbeddedRelay({ port: 0 });

    server = createFipsNostrRendezvousNode({
      relays: [relay.url],
      udpPort: 0,
      publicHost: '127.0.0.1',
      stunServers: [],
    });
    clientA = createFipsNostrRendezvousNode({
      relays: [relay.url],
      udpPort: 0,
      publicHost: '127.0.0.1',
      advertise: false,
      publishInboxRelays: false,
      stunServers: [],
    });
    clientB = createFipsNostrRendezvousNode({
      relays: [relay.url],
      udpPort: 0,
      publicHost: '127.0.0.1',
      advertise: false,
      publishInboxRelays: false,
      stunServers: [],
    });

    await Promise.all([server.start(), clientA.start(), clientB.start()]);
  }, 30000);

  afterAll(async () => {
    clientA?.close();
    clientB?.close();
    server?.close();
    await relay?.close();
  });

  async function waitForSessionCount(expected: number, timeoutMs = 5000) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      if (server.sessions.size >= expected) return;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error(`timed out waiting for ${expected} server sessions; saw ${server.sessions.size}`);
  }

  it('handles two concurrent traversal sessions on the same server socket', async () => {
    const [connA, connB] = await Promise.all([
      clientA.connect(server.getNpub(), { waitMs: 10_000, retryMs: 250, inboxWaitMs: 250 }),
      clientB.connect(server.getNpub(), { waitMs: 10_000, retryMs: 250, inboxWaitMs: 250 }),
    ]);

    await waitForSessionCount(2);

    expect(connA.established.established).toBe(true);
    expect(connB.established.established).toBe(true);
    expect(connA.nonce).not.toBe(connB.nonce);
    expect(server.sessions.size).toBeGreaterThanOrEqual(2);
    expect(server.sessions.has(connA.nonce)).toBe(true);
    expect(server.sessions.has(connB.nonce)).toBe(true);
  }, 30000);
});
