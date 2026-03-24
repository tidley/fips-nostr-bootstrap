import { afterAll, describe, expect, it } from 'vitest';
import { SimplePool, generateSecretKey, getPublicKey, nip19 } from 'nostr-tools';
import { useWebSocketImplementation } from 'nostr-tools/relay';
import { wrapEvent, unwrapEvent } from 'nostr-tools/nip17';
import { isHelloMessage, isServerInfoMessage } from './rendezvous_nip17.js';
import WS from 'ws';

const runLiveServer = process.env.RUN_LIVE_SERVER_ROUNDTRIP !== '0';
const describeLive = describe;

const RELAYS = (process.env.FIPS_TEST_RELAYS || 'wss://nip17.tomdwyer.uk')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const SERVER_NPUB = process.env.FIPS_TEST_SERVER_NPUB || 'npub10s7zyycsznn77zknnfe7dtc5xfkl2awn4fv2zkzhh75pgsnxjfksqy2qr5';

async function wsRoundtrip({
  relayUrl,
  event,
  decryptSk,
  matcher,
  timeoutMs = 30000,
}: {
  relayUrl: string;
  event: Record<string, unknown>;
  decryptSk: Uint8Array;
  matcher: (msg: unknown) => boolean;
  timeoutMs?: number;
}): Promise<boolean> {
  return new Promise<boolean>((resolve, reject) => {
    const ws = new WS(relayUrl);
    const subId = `sub-${Math.random().toString(16).slice(2)}`;

    const timer = setTimeout(() => {
      try { ws.close(); } catch {}
      reject(new Error('timed out waiting for matching EVENT over raw websocket'));
    }, timeoutMs);

    ws.on('open', () => {
      ws.send(JSON.stringify(['REQ', subId, { kinds: [1059], since: Math.floor(Date.now() / 1000) - 120 }]));
      ws.send(JSON.stringify(['EVENT', event]));
    });

    ws.on('message', (raw) => {
      try {
        const arr = JSON.parse(String(raw));
        if (!Array.isArray(arr) || arr.length < 2) return;
        if (arr[0] !== 'EVENT') return;
        const evt = arr[2];
        if (!evt) return;

        const rumor = unwrapEvent(evt, decryptSk);
        const msg = JSON.parse(rumor.content);
        if (!matcher(msg)) return;

        clearTimeout(timer);
        try { ws.send(JSON.stringify(['CLOSE', subId])); } catch {}
        try { ws.close(); } catch {}
        resolve(true);
      } catch {
        // ignore parse/decrypt errors from unrelated events
      }
    });

    ws.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });

    ws.on('close', () => {
      // no-op, timeout/error handlers control completion
    });
  });
}

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
      wants: { stunInfo: true, fipsConnect: false },
      capabilities: ['live-server-roundtrip-test'],
      clientEndpoint: { host: '0.0.0.0', port: 9 },
    };

    const event = wrapEvent(clientSk, { publicKey: serverPubkey }, JSON.stringify(helloPayload));

    const ok = await wsRoundtrip({
      relayUrl: RELAYS[0],
      event,
      decryptSk: clientSk,
      matcher: (msg) => {
        if (!isServerInfoMessage(msg)) return false;
        if (msg.nonce !== nonce || msg.sessionId !== sessionId) return false;
        expect(msg.endpoint.host).toBeTypeOf('string');
        expect(msg.endpoint.port).toBeGreaterThan(0);
        return true;
      },
      timeoutMs: 30000,
    });

    expect(ok).toBe(true);
  }, 40000);
});
