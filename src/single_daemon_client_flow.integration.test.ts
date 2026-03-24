import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SimplePool, generateSecretKey, getPublicKey } from 'nostr-tools';
import { useWebSocketImplementation } from 'nostr-tools/relay';
import { wrapEvent, unwrapEvent } from 'nostr-tools/nip17';
import { startEmbeddedRelay } from './embedded_relay.js';
// @ts-expect-error local JS package without type declarations
import { createFipsNostrRendezvousNode } from '../packages/fips-nostr-rendezvous/src/index.js';
import { isServerInfoMessage } from './rendezvous_nip17.js';

const runSingleDaemonE2E = process.env.RUN_SINGLE_DAEMON_E2E === '1';
const describeSingle = runSingleDaemonE2E ? describe : describe.skip;

describeSingle('single-daemon client flow (relay + stun info + fips endpoint)', () => {
  let relay: Awaited<ReturnType<typeof startEmbeddedRelay>>;
  let node: ReturnType<typeof createFipsNostrRendezvousNode>;
  const pool = new SimplePool();

  beforeAll(async () => {
    const wsMod = await import('ws');
    // @ts-ignore
    useWebSocketImplementation(wsMod.WebSocket || wsMod.default);

    relay = await startEmbeddedRelay({ port: 0 });

    node = createFipsNostrRendezvousNode({
      relays: [relay.url],
      udpPort: 0,
      publicHost: '45.77.228.152',
      stunPort: 3478,
      stunUri: 'stun:45.77.228.152:3478',
    });
    await node.start();
  });

  afterAll(async () => {
    pool.close([relay.url]);
    node.close();
    await relay.close();
  });

  it('client can send hello over relay and receive server-info with stun + fips endpoint', async () => {
    const clientSk = generateSecretKey();
    const clientPubkey = getPublicKey(clientSk);
    const serverPubkey = node.pubkey;

    const sessionId = `sess-${Date.now()}`;
    const nonce = `nonce-${Math.random().toString(16).slice(2)}`;

    const helloPayload = {
      type: 'fips.rendezvous.hello',
      version: '1.0',
      sessionId,
      nonce,
      issuedAt: Date.now(),
      wants: { stunInfo: true, fipsConnect: true },
      clientEndpoint: { host: '127.0.0.1', port: 40000 },
    };

    const helloEvent = wrapEvent(clientSk, { publicKey: serverPubkey }, JSON.stringify(helloPayload));

    const gotServerInfo = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('timeout waiting for server-info')), 8000);

      const sub = pool.subscribeMany(
        [relay.url],
        { kinds: [1059], '#p': [clientPubkey], since: Math.floor(Date.now() / 1000) - 10 },
        {
          onevent: (evt) => {
            try {
              const rumor = unwrapEvent(evt, clientSk);
              if (rumor.pubkey !== serverPubkey) return;
              const msg = JSON.parse(rumor.content);
              if (!isServerInfoMessage(msg)) return;
              if (msg.nonce !== nonce || msg.sessionId !== sessionId) return;

              expect(msg.endpoint.host).toBe('45.77.228.152');
              expect(msg.endpoint.port).toBeGreaterThan(0);
              expect(msg.stun?.uri).toBe('stun:45.77.228.152:3478');
              expect(msg.punch?.intervalMs).toBeGreaterThan(0);

              clearTimeout(timeout);
              sub.close();
              resolve();
            } catch {
              // ignore unrelated events
            }
          },
        },
      );
    });

    await Promise.allSettled(pool.publish([relay.url], helloEvent));
    await gotServerInfo;
  }, 20000);
});
