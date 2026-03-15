#!/usr/bin/env node
import process from 'node:process';
import { createFipsNostrRendezvousNode } from '../packages/fips-nostr-rendezvous/src/index.js';

function arg(name, fallback = '') {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

const targetNpub = arg('--npub', '');
if (!targetNpub) {
  console.error('Usage: node apps/fips-pty-client.mjs --npub <SERVER_NPUB> [--wait 60000]');
  process.exit(1);
}

const waitMs = Number(arg('--wait', '60000'));
const relays = (process.env.NOSTR_RELAYS || 'wss://nos.lol').split(',').map((s) => s.trim()).filter(Boolean);

const node = createFipsNostrRendezvousNode({ udpPort: 0, relays, publicHost: process.env.FIPS_UDP_PUBLIC_HOST });
const started = await node.start();

console.error('[local npub]', started.npub);
console.error('[connecting]', targetNpub);
const conn = await node.connect(targetNpub, { waitMs });
console.error('[connected]', conn.remote);

const session = conn.session;
session.on('channel:pty_out', (payload) => {
  try {
    const data = Buffer.from(String(payload?.data || ''), 'base64');
    process.stdout.write(data);
  } catch {
    // ignore malformed frame
  }
});

session.on('channel:pty_status', (payload) => {
  console.error('\n[remote status]', payload);
});

if (process.stdin.isTTY) {
  process.stdin.setRawMode(true);
}
process.stdin.resume();
process.stdin.on('data', (buf) => {
  // Ctrl-] exits client locally
  if (buf.length === 1 && buf[0] === 0x1d) {
    process.stderr.write('\n[exit]\n');
    session.close();
    node.close();
    process.exit(0);
  }
  session.send('pty_in', { data: Buffer.from(buf).toString('base64') }, 'stream');
});

process.on('SIGINT', () => {
  session.close();
  node.close();
  process.exit(0);
});
