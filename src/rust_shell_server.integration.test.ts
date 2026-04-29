// @ts-nocheck
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { getPublicKey, nip19 } from 'nostr-tools';
import { startEmbeddedRelay, type EmbeddedRelayServer } from './embedded_relay.js';
import { createFipsNostrRendezvousNode } from '../packages/fips-nostr-rendezvous/src/index.js';

const SERVER_NSEC = 'nsec14hwdknxqm508ymsvlvtlydc6yy0t8rvken29pgzr3gd28xxgvx6qdqfawz';
const CLIENT_NSEC = 'nsec1hpn8094pu26277hzmcp5z7tjj7h89pkjks2j54vezz2du49wfwcqp5tqze';

function nsecToNpub(nsec: string) {
  const decoded = nip19.decode(nsec);
  if (decoded.type !== 'nsec') throw new Error('expected nsec');
  return nip19.npubEncode(getPublicKey(decoded.data));
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor<T>(fn: () => Promise<T>, predicate: (value: T) => boolean, timeoutMs = 15000, intervalMs = 250) {
  const started = Date.now();
  let lastValue: T | undefined;
  while (true) {
    lastValue = await fn();
    if (predicate(lastValue)) return lastValue;
    if (Date.now() - started > timeoutMs) {
      throw new Error(`timed out after ${timeoutMs}ms; last value: ${JSON.stringify(lastValue)}`);
    }
    await delay(intervalMs);
  }
}

async function waitForProcessOutput(
  process: AppProcess,
  predicate: (output: string) => boolean,
  timeoutMs = 30000,
  intervalMs = 250,
) {
  const started = Date.now();
  while (true) {
    const output = `${process.stdout.join('')}\n${process.stderr.join('')}`;
    if (predicate(output)) return output;
    if (process.child.exitCode !== null || process.child.signalCode !== null) {
      throw new Error(
        `rust shell server exited before startup; code=${process.child.exitCode} signal=${process.child.signalCode}\n${output}`,
      );
    }
    if (Date.now() - started > timeoutMs) {
      throw new Error(`timed out waiting for rust shell server startup after ${timeoutMs}ms\n${output}`);
    }
    await delay(intervalMs);
  }
}

type AppProcess = {
  child: ReturnType<typeof spawn>;
  stdout: string[];
  stderr: string[];
  close: () => Promise<void>;
};

function spawnRustServer(relayUrl: string): AppProcess {
  const child = spawn(
    'cargo',
    [
      'run',
      '--quiet',
      '--bin',
      'fips-shell-server',
      '--',
      '--nsec',
      SERVER_NSEC,
      '--udp-port',
      '0',
      '--advert-relays',
      relayUrl,
      '--dm-relays',
      relayUrl,
      '--stun-servers',
      '',
      '--public-host',
      '127.0.0.1',
    ],
    {
      cwd: `${process.cwd()}/rust/fips-nostr-rendezvous`,
      env: { ...process.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  const stdout: string[] = [];
  const stderr: string[] = [];
  child.stdout.on('data', (chunk) => stdout.push(String(chunk)));
  child.stderr.on('data', (chunk) => stderr.push(String(chunk)));
  return {
    child,
    stdout,
    stderr,
    close: async () => {
      if (child.exitCode !== null || child.signalCode !== null) return;
      child.kill('SIGINT');
      await new Promise<void>((resolve) => {
        child.once('exit', () => resolve());
        setTimeout(() => {
          if (child.exitCode === null && child.signalCode === null) {
            child.kill('SIGKILL');
          }
        }, 3000);
      });
    },
  };
}

describe('rust shell server interop', () => {
  let relay: EmbeddedRelayServer;
  let server: AppProcess;
  let clientNode: ReturnType<typeof createFipsNostrRendezvousNode>;
  const serverNpub = nsecToNpub(SERVER_NSEC);

  beforeAll(async () => {
    relay = await startEmbeddedRelay({ port: 0 });
    server = spawnRustServer(relay.url);
    await waitForProcessOutput(
      server,
      (output) => output.includes('"advertRelays"') || output.includes('"kind":"advert"'),
      60000,
    );

    clientNode = createFipsNostrRendezvousNode({
      advertRelays: [relay.url],
      dmRelays: [relay.url],
      udpPort: 0,
      nsec: CLIENT_NSEC,
      publicHost: '127.0.0.1',
      advertise: false,
      stunServers: [],
    });
    await clientNode.start();
  }, 70000);

  afterAll(async () => {
    clientNode?.close();
    await server?.close();
    await relay?.close();
  });

  it('publishes an advert and serves shell commands to the JS client runtime', async () => {
    const adverts = await waitFor(
      async () => clientNode.listAdvertisedPeers({ waitMs: 3000, settleMs: 100 }),
      (peers) => peers.some((peer) => peer.publisherNpub === serverNpub),
      20000,
      500,
    );
    expect(adverts.some((peer) => peer.publisherNpub === serverNpub)).toBe(true);

    const conn = await clientNode.connectToAdvertisedPeer(serverNpub, {
      discoveryWaitMs: 5000,
      waitMs: 15000,
      retryMs: 1000,
      punchWaitMs: 15000,
    });
    expect(conn.session).toBeTruthy();

    const result = await new Promise<any>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timed out waiting for shell_result')), 15000);
      conn.session.on('channel:shell_result', (payload) => {
        clearTimeout(timer);
        resolve(payload);
      });
      conn.session.send('shell', { id: 'pwd-1', cmd: 'pwd' });
    });

    expect(result.ok).toBe(true);
    const expectedCwd = `${process.cwd()}/rust/fips-nostr-rendezvous`;
    expect(result.cwd).toBe(expectedCwd);
    expect(result.stdout.trim()).toBe(expectedCwd);
    expect(server.stdout.join('')).toContain('[session]');
  }, 45000);
});
