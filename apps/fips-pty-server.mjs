#!/usr/bin/env node
import 'dotenv/config';
import { spawn } from 'node:child_process';
import { createFipsNostrRendezvousNode } from '../packages/fips-nostr-rendezvous/src/index.js';

function arg(name, fallback = '') {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

const udpPort = Number(arg('--udp-port', '9999'));
const trusted = (arg('--trusted-npubs', '') || '').split(',').map((s) => s.trim()).filter(Boolean);
const relays = (process.env.NOSTR_RELAYS || 'wss://nos.lol').split(',').map((s) => s.trim()).filter(Boolean);

const node = createFipsNostrRendezvousNode({
  udpPort,
  relays,
  trustedNpubs: trusted,
  publicHost: process.env.FIPS_UDP_PUBLIC_HOST,
});

const ptys = new Map();

function spawnPty(sessionId, session) {
  // Use `script` to force PTY allocation so TUIs like htop render correctly.
  const child = spawn('script', ['-qfec', 'bash --noprofile --norc', '/dev/null'], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, TERM: process.env.TERM || 'xterm-256color' },
  });

  const sendOut = (buf) => {
    session.send('pty_out', { data: Buffer.from(buf).toString('base64') }, 'stream');
  };

  child.stdout.on('data', sendOut);
  child.stderr.on('data', sendOut);

  session.on('channel:pty_in', (payload) => {
    try {
      const data = Buffer.from(String(payload?.data || ''), 'base64');
      child.stdin.write(data);
    } catch {
      // ignore malformed
    }
  });

  child.on('exit', (code) => {
    session.send('pty_status', { exited: true, code }, 'status');
    ptys.delete(sessionId);
  });

  ptys.set(sessionId, child);
}

node.on('reject', (r) => console.error('[reject]', r));
node.on('session', ({ sessionId, remote, session }) => {
  if (ptys.has(sessionId)) return;
  console.log('[session]', sessionId, remote);
  spawnPty(sessionId, session);
});

const started = await node.start();
console.log(JSON.stringify({
  app: 'fips-pty-server',
  npub: started.npub,
  udpPort: started.udpPort,
  relays,
  trustedCount: trusted.length,
}, null, 2));

process.on('SIGINT', () => {
  for (const ch of ptys.values()) ch.kill('SIGTERM');
  node.close();
  process.exit(0);
});
