// @ts-nocheck
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import net from 'node:net';
import { getPublicKey, nip19 } from 'nostr-tools';
import { startEmbeddedRelay, type EmbeddedRelayServer } from './embedded_relay.js';

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

async function reservePort() {
  return new Promise<number>((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('failed to reserve port'));
        return;
      }
      const { port } = address;
      server.close((err) => (err ? reject(err) : resolve(port)));
    });
  });
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

type AppProcess = {
  child: ReturnType<typeof spawn>;
  stdout: string[];
  stderr: string[];
  close: () => Promise<void>;
};

function spawnCargo(args: string[], env: NodeJS.ProcessEnv): AppProcess {
  const child = spawn('cargo', args, {
    cwd: `${process.cwd()}/rust/fips-nostr-rendezvous`,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
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
          if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
        }, 3000);
      });
    },
  };
}

describe('rust offer/answer integration', () => {
  let relay: EmbeddedRelayServer;
  let server: AppProcess;
  let daemon: AppProcess;
  let httpPort: number;
  const serverNpub = nsecToNpub(SERVER_NSEC);

  beforeAll(async () => {
    relay = await startEmbeddedRelay({ port: 0 });
    httpPort = await reservePort();

    server = spawnCargo(
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
        relay.url,
        '--dm-relays',
        relay.url,
        '--stun-servers',
        '',
        '--public-host',
        '127.0.0.1',
      ],
      {},
    );

    daemon = spawnCargo(
      [
        'run',
        '--quiet',
        '--bin',
        'fips-web-daemon',
        '--',
        '--nsec',
        CLIENT_NSEC,
        '--http-port',
        String(httpPort),
        '--udp-port',
        '0',
        '--advert-relays',
        relay.url,
        '--dm-relays',
        relay.url,
        '--stun-servers',
        '',
        '--public-host',
        '127.0.0.1',
      ],
      {},
    );

    await waitFor(
      async () => {
        const response = await fetch(`http://127.0.0.1:${httpPort}/api/meta`).catch(() => null);
        return response?.ok ?? false;
      },
      Boolean,
      20000,
      250,
    );
  }, 45000);

  afterAll(async () => {
    await daemon?.close();
    await server?.close();
    await relay?.close();
  });

  it('connects over the Rust offer/answer path and executes a shell command', async () => {
    const discovered = await waitFor(
      async () => {
        const response = await fetch(`http://127.0.0.1:${httpPort}/api/discover`);
        return response.json() as Promise<{ ok: boolean; peers: Array<{ publisherNpub: string }> }>;
      },
      (body) => body.ok && body.peers.some((peer) => peer.publisherNpub === serverNpub),
      15000,
      500,
    );
    expect(discovered.peers.some((peer) => peer.publisherNpub === serverNpub)).toBe(true);

    const connectResponse = await fetch(`http://127.0.0.1:${httpPort}/api/connect`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ npub: serverNpub }),
    });
    const connected = await connectResponse.json() as { ok: boolean; sessionId?: string; error?: string };
    expect(
      connected.ok,
      `connect failed: ${connected.error || 'unknown'}\ndaemon stdout:\n${daemon.stdout.join('')}\ndaemon stderr:\n${daemon.stderr.join('')}\nserver stdout:\n${server.stdout.join('')}\nserver stderr:\n${server.stderr.join('')}`,
    ).toBe(true);

    const cmdResponse = await fetch(`http://127.0.0.1:${httpPort}/api/cmd`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ cmd: 'pwd' }),
    });
    const cmdBody = await cmdResponse.json() as { ok: boolean; id?: string };
    expect(cmdBody.ok).toBe(true);

    await waitFor(
      async () => daemon.stdout.join(''),
      (stdout) => stdout.includes('"type":"offer"') || stdout.includes('[rendezvous] offer prepared'),
      10000,
      200,
    );
    await waitFor(
      async () => server.stdout.join(''),
      (stdout) => stdout.includes('[rendezvous] offer received') && stdout.includes('[rendezvous] answer published'),
      10000,
      200,
    );

    expect(server.stdout.join('')).not.toContain('[rendezvous] hello received');
  }, 45000);
});
