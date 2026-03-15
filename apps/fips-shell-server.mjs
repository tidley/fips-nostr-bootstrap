#!/usr/bin/env node
import { exec } from 'node:child_process';
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

const sessions = new Map();

function runCommand(cmd) {
  return new Promise((resolve) => {
    exec(cmd, { timeout: 30_000, maxBuffer: 2 * 1024 * 1024 }, (error, stdout, stderr) => {
      resolve({
        ok: !error,
        code: error?.code ?? 0,
        stdout: stdout ?? '',
        stderr: stderr ?? '',
        error: error ? String(error.message || error) : null,
      });
    });
  });
}

node.on('reject', (r) => console.error('[reject]', r));
node.on('session', ({ sessionId, remote, session }) => {
  sessions.set(sessionId, session);
  console.log('[session]', sessionId, remote);

  session.on('channel:shell', async (payload, frame) => {
    const command = String(payload?.cmd || '').trim();
    if (!command) {
      session.send('shell_result', { id: payload?.id, ok: false, error: 'empty command' }, 'response');
      return;
    }

    const result = await runCommand(command);
    session.send('shell_result', {
      id: payload?.id,
      command,
      ...result,
      ts: Date.now(),
    }, 'response');
  });
});

const started = await node.start();
console.log(JSON.stringify({
  app: 'fips-shell-server',
  npub: started.npub,
  udpPort: started.udpPort,
  relays,
  trustedCount: trusted.length,
}, null, 2));

process.on('SIGINT', () => {
  node.close();
  process.exit(0);
});
