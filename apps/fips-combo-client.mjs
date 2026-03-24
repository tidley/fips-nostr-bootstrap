#!/usr/bin/env node
import 'dotenv/config';
import { SimplePool, generateSecretKey, getPublicKey, nip19 } from 'nostr-tools';
import { useWebSocketImplementation } from 'nostr-tools/relay';
import { wrapEvent, unwrapEvent } from 'nostr-tools/nip17';

function arg(name, fallback = '') {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

function hasFlag(name) {
  return process.argv.includes(name);
}

function usage() {
  console.log(`
FIPS combo client (Nostr transport -> STUN/FIPS bootstrap data)

Usage:
  node apps/fips-combo-client.mjs --relay wss://fips.tomdwyer.uk --server-npub <npub...>

Options:
  --relay <url>            Relay websocket URL (default: $FIPS_CLIENT_RELAY or wss://fips.tomdwyer.uk)
  --server-npub <npub>     Target server npub (required)
  --session-id <id>        Optional session id override
  --timeout-ms <ms>        Wait timeout (default: 30000)
  --nsec <nsec>            Optional client nsec (default: ephemeral)
  --want-fips <0|1>        Include fips connect request (default: 1)
  --want-stun <0|1>        Include stun info request (default: 1)
  --help                   Show this help

Env fallbacks:
  FIPS_CLIENT_RELAY
  FIPS_SERVER_NPUB
  FIPS_CLIENT_NSEC
`);
}

if (hasFlag('--help') || hasFlag('-h')) {
  usage();
  process.exit(0);
}

const relay = arg('--relay', process.env.FIPS_CLIENT_RELAY || 'wss://fips.tomdwyer.uk');
const serverNpub = arg('--server-npub', process.env.FIPS_SERVER_NPUB || '');
const timeoutMs = Number(arg('--timeout-ms', '30000'));
const wantFips = arg('--want-fips', '1') !== '0';
const wantStun = arg('--want-stun', '1') !== '0';

if (!serverNpub) {
  console.error('[combo-client] missing --server-npub (or FIPS_SERVER_NPUB)');
  usage();
  process.exit(1);
}

const target = nip19.decode(serverNpub);
if (target.type !== 'npub') {
  console.error('[combo-client] --server-npub must be npub');
  process.exit(1);
}
const serverPubkey = target.data;

const nsecInput = arg('--nsec', process.env.FIPS_CLIENT_NSEC || '');
let sk;
if (nsecInput) {
  const d = nip19.decode(nsecInput);
  if (d.type !== 'nsec') {
    console.error('[combo-client] provided nsec is invalid');
    process.exit(1);
  }
  sk = d.data;
} else {
  sk = generateSecretKey();
}

const pubkey = getPublicKey(sk);
const npub = nip19.npubEncode(pubkey);

const sessionId = arg('--session-id', `combo-${Date.now()}`);
const nonce = `n-${Math.random().toString(16).slice(2)}`;

const helloPayload = {
  type: 'fips.rendezvous.hello',
  version: '1.0',
  sessionId,
  nonce,
  issuedAt: Date.now(),
  wants: { stunInfo: wantStun, fipsConnect: wantFips },
  capabilities: ['combo-client-v1'],
  clientEndpoint: { host: '0.0.0.0', port: 9 },
};

const wsMod = await import('ws');
useWebSocketImplementation(wsMod.WebSocket || wsMod.default);

const pool = new SimplePool();

console.log(JSON.stringify({
  app: 'fips-combo-client',
  relay,
  client: { npub, ephemeral: !nsecInput },
  target: { npub: serverNpub },
  request: helloPayload,
}, null, 2));

const event = wrapEvent(sk, { publicKey: serverPubkey }, JSON.stringify(helloPayload));

const result = await new Promise((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error('timed out waiting for server-info')), timeoutMs);

  const sub = pool.subscribeMany(
    [relay],
    { kinds: [1059], since: Math.floor(Date.now() / 1000) - 120 },
    {
      onevent: (evt) => {
        try {
          const rumor = unwrapEvent(evt, sk);
          const msg = JSON.parse(rumor.content);
          if (msg?.type !== 'fips.rendezvous.server-info') return;
          if (msg?.nonce !== nonce || msg?.sessionId !== sessionId) return;

          clearTimeout(timeout);
          sub.close();
          resolve({ rumor, msg });
        } catch {
          // ignore unrelated/unreadable events
        }
      },
    },
  );

  Promise.allSettled(pool.publish([relay], event)).then((outcomes) => {
    const ok = outcomes.some((r) => r.status === 'fulfilled');
    if (!ok) {
      clearTimeout(timeout);
      sub.close();
      reject(new Error('failed to publish hello to relay'));
    }
  }).catch((err) => {
    clearTimeout(timeout);
    sub.close();
    reject(err);
  });
});

console.log(JSON.stringify({
  ok: true,
  response: result.msg,
}, null, 2));

pool.close([relay]);
