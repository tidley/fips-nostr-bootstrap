import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import net from 'node:net';
import { TextDecoder } from 'node:util';
import { getPublicKey, nip19 } from 'nostr-tools';
import { startEmbeddedRelay, type EmbeddedRelayServer } from './embedded_relay';

const SERVER_NSEC = 'nsec14hwdknxqm508ymsvlvtlydc6yy0t8rvken29pgzr3gd28xxgvx6qdqfawz';
const CLIENT_NSEC = 'nsec1hpn8094pu26277hzmcp5z7tjj7h89pkjks2j54vezz2du49wfwcqp5tqze';

function nsecToNpub(nsec: string) {
  const decoded = nip19.decode(nsec);
  if (decoded.type !== 'nsec') throw new Error('expected nsec');
  return nip19.npubEncode(getPublicKey(decoded.data));
}

function reservePort() {
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

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor<T>(fn: () => Promise<T>, predicate: (value: T) => boolean, timeoutMs = 15000, intervalMs = 250) {
  const started = Date.now();
  let lastValue: T | undefined;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    lastValue = await fn();
    if (predicate(lastValue)) return lastValue;
    if (Date.now() - started > timeoutMs) {
      throw new Error(`timed out waiting for condition after ${timeoutMs}ms; last value: ${JSON.stringify(lastValue)}`);
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

function spawnApp(args: string[], env: NodeJS.ProcessEnv): AppProcess {
  const child = spawn(process.execPath, args, {
    cwd: process.cwd(),
    env: {
      ...process.env,
      ...env,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const stdout: string[] = [];
  const stderr: string[] = [];
  child.stdout.on('data', (chunk) => {
    stdout.push(String(chunk));
  });
  child.stderr.on('data', (chunk) => {
    stderr.push(String(chunk));
  });
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

async function openSse(url: string) {
  const response = await fetch(url, {
    headers: { accept: 'text/event-stream' },
  });
  if (!response.ok || !response.body) {
    throw new Error(`failed to open SSE: ${response.status}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  return {
    async nextEvent(timeoutMs = 15000): Promise<{ event: string; data: unknown }> {
      const started = Date.now();
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const boundary = buffer.indexOf('\n\n');
        if (boundary >= 0) {
          const rawEvent = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          const lines = rawEvent.split('\n');
          let event = 'message';
          const dataLines: string[] = [];
          for (const line of lines) {
            if (line.startsWith(':')) continue;
            if (line.startsWith('event: ')) event = line.slice(7);
            if (line.startsWith('data: ')) dataLines.push(line.slice(6));
          }
          return { event, data: JSON.parse(dataLines.join('\n') || 'null') };
        }

        if (Date.now() - started > timeoutMs) {
          throw new Error(`timed out waiting for SSE event from ${url}`);
        }

        const { done, value } = await reader.read();
        if (done) throw new Error(`SSE stream closed unexpectedly for ${url}`);
        buffer += decoder.decode(value, { stream: true });
      }
    },
    async close() {
      try {
        await reader.cancel();
      } catch {
        // ignore
      }
    },
  };
}

describe('web console runtime app integration', () => {
  let relay: EmbeddedRelayServer;
  let serverApp: AppProcess;
  let clientApp: AppProcess;
  let httpPort: number;
  const serverNpub = nsecToNpub(SERVER_NSEC);

  beforeAll(async () => {
    relay = await startEmbeddedRelay({ port: 0 });
    httpPort = await reservePort();

    serverApp = spawnApp(
      ['apps/fips-shell-server.mjs', '--udp-port', '0', '--relays', relay.url],
      {
        NOSTR_NSEC: SERVER_NSEC,
        FIPS_UDP_PUBLIC_HOST: '127.0.0.1',
      },
    );

    clientApp = spawnApp(
      ['apps/fips-web-console.mjs', '--http-port', String(httpPort), '--udp-port', '0', '--relays', relay.url],
      {
        NOSTR_NSEC: CLIENT_NSEC,
        FIPS_UDP_PUBLIC_HOST: '127.0.0.1',
      },
    );

    await waitFor(
      async () => {
        const response = await fetch(`http://127.0.0.1:${httpPort}/`).catch(() => null);
        return response?.ok ?? false;
      },
      Boolean,
      15000,
      250,
    );
  }, 30000);

  afterAll(async () => {
    await clientApp?.close();
    await serverApp?.close();
    await relay?.close();
  });

  it('discovers the advertised shell server and connects through the web console HTTP API', async () => {
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
      body: JSON.stringify({ npub: '' }),
    });
    const connected = await connectResponse.json() as {
      ok: boolean;
      sessionId?: string;
      discoveredAdvert?: { publisherNpub: string } | null;
      error?: string;
    };

    expect(connected.ok, `connect failed: ${connected.error || 'unknown'}\nweb stdout:\n${clientApp.stdout.join('')}\nweb stderr:\n${clientApp.stderr.join('')}\nserver stdout:\n${serverApp.stdout.join('')}\nserver stderr:\n${serverApp.stderr.join('')}`).toBe(true);
    expect(connected.discoveredAdvert?.publisherNpub).toBe(serverNpub);

    const sse = await openSse(`http://127.0.0.1:${httpPort}/api/events`);
    try {
      const status = await sse.nextEvent();
      expect(status.event).toBe('status');
      expect((status.data as { connected: boolean }).connected).toBe(true);

      const cmdResponse = await fetch(`http://127.0.0.1:${httpPort}/api/cmd`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ cmd: 'pwd' }),
      });
      const cmdBody = await cmdResponse.json() as { ok: boolean; id?: string; error?: string };
      expect(cmdBody.ok, `cmd failed: ${cmdBody.error || 'unknown'}`).toBe(true);

      const result = await waitFor(
        async () => sse.nextEvent(),
        (evt) => evt.event === 'result' && (evt.data as { id?: string }).id === cmdBody.id,
        15000,
        10,
      );

      const payload = result.data as { stdout?: string; cwd?: string; ok?: boolean };
      expect(payload.ok).toBe(true);
      expect(payload.cwd).toBe(process.cwd());
      expect(payload.stdout?.trim()).toBe(process.cwd());
    } finally {
      await sse.close();
    }

    expect(clientApp.stdout.join('')).toContain('[web-console] connect request');
    expect(serverApp.stdout.join('')).toContain('[session]');
  }, 45000);
});
