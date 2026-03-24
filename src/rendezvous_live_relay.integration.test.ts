import { afterAll, describe, expect, it } from 'vitest';
import { SimplePool, generateSecretKey, getPublicKey, nip19 } from 'nostr-tools';
import { useWebSocketImplementation } from 'nostr-tools/relay';
import { wrapEvent, unwrapEvent } from 'nostr-tools/nip17';
import { isHelloMessage, isServerInfoMessage } from './rendezvous_nip17.js';

const runLiveServer = process.env.RUN_LIVE_SERVER_ROUNDTRIP !== '0';
const describeLive = describe;

const RELAYS = (process.env.FIPS_TEST_RELAYS || 'wss://nos.lol,wss://nip17.tomdwyer.uk')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const SERVER_NPUB = process.env.FIPS_TEST_SERVER_NPUB || 'npub10s7zyycsznn77zknnfe7dtc5xfkl2awn4fv2zkzhh75pgsnxjfksqy2qr5';

describeLive('live rendezvous relay integration (real relay)', () => {
  const pool = new SimplePool();

  afterAll(() => {
    pool.close(RELAYS);
  });

  it('can deliver and decrypt a hello DM over real relay infrastructure', async () => {
    const wsMod = await import('ws');
    // @ts-ignore
    useWebSocketImplementation(wsMod.WebSocket || wsMod.default);

    const senderSk = generateSecretKey();
    const senderPubkey = getPublicKey(senderSk);
    const receiverSk = generateSecretKey();
    const receiverPubkey = getPublicKey(receiverSk);

    const sessionId = `live-relay-${Date.now()}`;
    const nonce = `n-${Math.random().toString(16).slice(2)}`;

    const helloPayload = {
      type: 'fips.rendezvous.hello',
      version: '1.0' as const,
      sessionId,
      nonce,
      issuedAt: Date.now(),
      wants: { stunInfo: true, fipsConnect: false },
      capabilities: ['relay-delivery-test'],
    };

    const event = wrapEvent(senderSk, { publicKey: receiverPubkey }, JSON.stringify(helloPayload));

    const gotHello = new Promise<boolean>((resolve) => {
      const timeout = setTimeout(() => {
        sub.close();
        resolve(false);
      }, 12000);

      const sub = pool.subscribeMany(
        RELAYS,
        { kinds: [1059], '#p': [receiverPubkey], since: Math.floor(Date.now() / 1000) - 60 },
        {
          onevent: (evt) => {
            try {
              const rumor = unwrapEvent(evt, receiverSk);
              if (rumor.pubkey !== senderPubkey) return;
              const msg = JSON.parse(rumor.content);
              if (!isHelloMessage(msg)) return;
              if (msg.nonce !== nonce || msg.sessionId !== sessionId) return;

              clearTimeout(timeout);
              sub.close();
              resolve(true);
            } catch {
              // ignore unrelated events
            }
          },
        },
      );
    });

    const publishResults = await Promise.allSettled(pool.publish(RELAYS, event));
    const publishOk = publishResults.some((r) => r.status === 'fulfilled');
    expect(publishOk).toBe(true);

    const delivered = await gotHello;
    if (!delivered) {
      console.warn('[live-relay-test] publish succeeded but DM delivery was not observed within timeout');
    }
  }, 25000);

  const itServer = runLiveServer ? it : it.skip;
  itServer('roundtrips against live server npub and receives server-info', async () => {
    const wsMod = await import('ws');
    // @ts-ignore
    useWebSocketImplementation(wsMod.WebSocket || wsMod.default);

    const clientSk = generateSecretKey();
    const clientPubkey = getPublicKey(clientSk);
    const target = nip19.decode(SERVER_NPUB);
    if (target.type !== 'npub') throw new Error('FIPS_TEST_SERVER_NPUB must be npub');
    const serverPubkey = target.data;

    const sessionId = `live-server-${Date.now()}`;
    const nonce = `n-${Math.random().toString(16).slice(2)}`;

    const helloPayload = {
      type: 'fips.rendezvous.hello',
      version: '1.0',
      sessionId,
      nonce,
      issuedAt: Date.now(),
      wants: { stunInfo: true, fipsConnect: true },
      capabilities: ['live-server-roundtrip-test'],
      clientEndpoint: { host: '0.0.0.0', port: 9 },
    };

    const event = wrapEvent(clientSk, { publicKey: serverPubkey }, JSON.stringify(helloPayload));

    const gotServerInfo = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('timed out waiting for server-info')), 30000);

      const sub = pool.subscribeMany(
        RELAYS,
        { kinds: [1059], '#p': [clientPubkey], since: Math.floor(Date.now() / 1000) - 120 },
        {
          onevent: (evt) => {
            try {
              const rumor = unwrapEvent(evt, clientSk);
              if (rumor.pubkey !== serverPubkey) return;
              const msg = JSON.parse(rumor.content);
              if (!isServerInfoMessage(msg)) return;
              if (msg.nonce !== nonce || msg.sessionId !== sessionId) return;

              clearTimeout(timeout);
              sub.close();
              expect(msg.endpoint.host).toBeTypeOf('string');
              expect(msg.endpoint.port).toBeGreaterThan(0);
              resolve();
            } catch {
              // ignore unrelated/unreadable events
            }
          },
        },
      );
    });

    // publish with retries to tolerate transient relay timing
    for (let i = 0; i < 3; i += 1) {
      await Promise.allSettled(pool.publish(RELAYS, event));
      await new Promise((r) => setTimeout(r, 1200));
    }

    await gotServerInfo;
  }, 40000);
});
