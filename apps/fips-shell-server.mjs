#!/usr/bin/env node
import 'dotenv/config';
import { exec } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import {
  createFipsNostrRendezvousNode,
  DEFAULT_ADVERT_RELAYS,
  DEFAULT_DM_RELAYS,
} from '../packages/fips-nostr-rendezvous/src/index.js';

function arg(name, fallback = '') {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

const udpPort = Number(arg('--udp-port', '9999'));
const trusted = (arg('--trusted-npubs', '') || '').split(',').map((s) => s.trim()).filter(Boolean);
const relays = (arg('--relays', '') || '').split(',').map((s) => s.trim()).filter(Boolean);
const advertRelays = (arg('--advert-relays', '') || '').split(',').map((s) => s.trim()).filter(Boolean);
const dmRelays = (arg('--dm-relays', '') || '').split(',').map((s) => s.trim()).filter(Boolean);
const effectiveAdvertRelays = relays.length ? [...relays] : (advertRelays.length ? advertRelays : [...DEFAULT_ADVERT_RELAYS]);
const effectiveDmRelays = relays.length ? [...relays] : (dmRelays.length ? dmRelays : [...DEFAULT_DM_RELAYS]);

const node = createFipsNostrRendezvousNode({
  udpPort,
  advertRelays: effectiveAdvertRelays,
  dmRelays: effectiveDmRelays,
  trustedNpubs: trusted,
  nsec: process.env.NOSTR_NSEC,
  publicHost: process.env.FIPS_UDP_PUBLIC_HOST,
});

const sessions = new Map();
const sessionState = new Map(); // sessionId -> { cwd }

function runCommand(cmd, cwd) {
  let childRef = null;
  const promise = new Promise((resolve) => {
    const child = exec(cmd, { timeout: 30_000, maxBuffer: 2 * 1024 * 1024, cwd }, (error, stdout, stderr) => {
      resolve({
        ok: !error,
        code: error?.code ?? 0,
        stdout: stdout ?? '',
        stderr: stderr ?? '',
        error: error ? String(error.message || error) : null,
      });
    });
    childRef = child;
  });
  return { child: childRef, promise };
}

node.on('reject', (r) => console.error('[reject]', r));
node.on('session', ({ sessionId, remote, session }) => {
  if (sessions.has(sessionId)) return;
  sessions.set(sessionId, session);
  sessionState.set(sessionId, { cwd: process.cwd(), running: null });
  console.log('[session]', sessionId, remote);

  session.on('channel:shell_interrupt', () => {
    const state = sessionState.get(sessionId);
    if (state?.running && typeof state.running.kill === 'function') {
      state.running.kill('SIGINT');
      session.send('shell_result', {
        id: `interrupt-${Date.now()}`,
        command: '^C',
        ok: false,
        code: 130,
        stdout: '',
        stderr: 'Interrupted (SIGINT)',
        cwd: state.cwd,
        ts: Date.now(),
      }, 'response');
    }
  });

  session.on('channel:shell', async (payload) => {
    const command = String(payload?.cmd || '').trim();
    const state = sessionState.get(sessionId) || { cwd: process.cwd(), running: null };

    if (!command) {
      session.send('shell_result', { id: payload?.id, ok: true, command, stdout: '', stderr: '', cwd: state.cwd }, 'response');
      return;
    }

    if (command === 'cd' || command.startsWith('cd ')) {
      const target = command === 'cd' ? process.env.HOME || state.cwd : command.slice(3).trim();
      try {
        const resolved = path.resolve(state.cwd, target);
        if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
          throw new Error(`cd: no such directory: ${target}`);
        }
        state.cwd = resolved;
        sessionState.set(sessionId, state);
        session.send('shell_result', {
          id: payload?.id,
          command,
          ok: true,
          code: 0,
          stdout: '',
          stderr: '',
          cwd: state.cwd,
          ts: Date.now(),
        }, 'response');
      } catch (e) {
        session.send('shell_result', {
          id: payload?.id,
          command,
          ok: false,
          code: 1,
          stdout: '',
          stderr: String(e.message || e),
          cwd: state.cwd,
          ts: Date.now(),
        }, 'response');
      }
      return;
    }

    if (state.running) {
      session.send('shell_result', {
        id: payload?.id,
        command,
        ok: false,
        code: 1,
        stdout: '',
        stderr: 'another command is still running; press Ctrl-C first',
        cwd: state.cwd,
        ts: Date.now(),
      }, 'response');
      return;
    }

    const run = runCommand(command, state.cwd);
    state.running = run.child;
    sessionState.set(sessionId, state);

    const result = await run.promise;
    state.running = null;
    sessionState.set(sessionId, state);

    session.send('shell_result', {
      id: payload?.id,
      command,
      ...result,
      cwd: state.cwd,
      ts: Date.now(),
    }, 'response');
  });
});

const started = await node.start();
console.log(JSON.stringify({
  app: 'fips-shell-server',
  npub: started.npub,
  udpPort: started.udpPort,
  advertRelays: effectiveAdvertRelays,
  dmRelays: effectiveDmRelays,
  relaySource: relays.length ? 'cli-shared' : ((advertRelays.length || dmRelays.length) ? 'cli-split' : 'embedded-defaults'),
  trustedCount: trusted.length,
}, null, 2));

process.on('SIGINT', () => {
  node.close();
  process.exit(0);
});
