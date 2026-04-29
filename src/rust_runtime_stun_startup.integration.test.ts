// @ts-nocheck
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { createSocket } from 'node:dgram';
import net from 'node:net';
import path from 'node:path';
import { startEmbeddedRelay, type EmbeddedRelayServer } from './embedded_relay.js';

const TEST_NSEC = 'nsec14hwdknxqm508ymsvlvtlydc6yy0t8rvken29pgzr3gd28xxgvx6qdqfawz';

function xorMappedAddress(ip: string, port: number): Buffer {
  const attr = Buffer.alloc(12);
  attr.writeUInt16BE(0x0020, 0);
  attr.writeUInt16BE(8, 2);
  attr[5] = 0x01;
  attr.writeUInt16BE(port ^ 0x2112, 6);
  const cookie = Buffer.from([0x21, 0x12, 0xa4, 0x42]);
  ip.split('.').map(Number).forEach((part, index) => {
    attr[8 + index] = part ^ cookie[index];
  });
  return attr;
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

async function waitFor(predicate: () => boolean, timeoutMs = 15000, intervalMs = 100) {
  const started = Date.now();
  while (true) {
    if (predicate()) return;
    if (Date.now() - started > timeoutMs) {
      throw new Error(`timed out after ${timeoutMs}ms`);
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

const rustPackageDir = path.join(process.cwd(), 'rust/fips-nostr-rendezvous');

function rustBinaryPath(name: string) {
  return path.join(rustPackageDir, 'target/debug', process.platform === 'win32' ? `${name}.exe` : name);
}

function buildRustBinaries() {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(
      'cargo',
      ['build', '--quiet', '--locked', '--bin', 'fips-shell-server', '--bin', 'fips-web-daemon'],
      {
        cwd: rustPackageDir,
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    const stdout: string[] = [];
    const stderr: string[] = [];
    child.stdout.on('data', (chunk) => stdout.push(String(chunk)));
    child.stderr.on('data', (chunk) => stderr.push(String(chunk)));
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(
        new Error(
          `cargo build failed with ${signal || code}\nstdout:\n${stdout.join('')}\nstderr:\n${stderr.join('')}`,
        ),
      );
    });
  });
}

function spawnRustProcess(bin: string, args: string[], env: NodeJS.ProcessEnv): AppProcess {
  const child = spawn(rustBinaryPath(bin), args, {
    cwd: rustPackageDir,
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

describe('rust runtime startup STUN integration', () => {
  let relay: EmbeddedRelayServer;
  let stunServer: ReturnType<typeof createSocket>;
  let stunUrl: string;

  beforeAll(async () => {
    await buildRustBinaries();
    relay = await startEmbeddedRelay({ port: 0 });
    stunServer = createSocket('udp4');
    await new Promise<void>((resolve, reject) => {
      stunServer.once('error', reject);
      stunServer.bind(0, '127.0.0.1', () => resolve());
    });
    const address = stunServer.address();
    if (!address || typeof address === 'string') {
      throw new Error('failed to bind fake STUN server');
    }
    stunUrl = `stun:127.0.0.1:${address.port}`;
    stunServer.on('message', (msg, rinfo) => {
      const response = Buffer.alloc(20);
      response.writeUInt16BE(0x0101, 0);
      response.writeUInt16BE(12, 2);
      response.writeUInt32BE(0x2112a442, 4);
      msg.subarray(8, 20).copy(response, 8);
      const packet = Buffer.concat([response, xorMappedAddress('198.51.100.77', rinfo.port)]);
      stunServer.send(packet, rinfo.port, rinfo.address);
    });
  }, 120000);

  afterAll(async () => {
    await relay?.close();
    if (stunServer) {
      await new Promise<void>((resolve) => stunServer.close(() => resolve()));
    }
  });

  it('shell server observes reflexive STUN address during startup', async () => {
    const app = spawnRustProcess(
      'fips-shell-server',
      [
        '--nsec',
        TEST_NSEC,
        '--udp-port',
        '0',
        '--advert-relays',
        relay.url,
        '--dm-relays',
        relay.url,
      ],
      { FIPS_STUN_SERVERS: stunUrl },
    );

    try {
      await waitFor(() => app.stdout.join('').includes('"reflexiveAddress":{"host":"198.51.100.77"'), 15000);
    } finally {
      await app.close();
    }
  }, 30000);

  it('web daemon observes reflexive STUN address during startup', async () => {
    const httpPort = await reservePort();
    const app = spawnRustProcess(
      'fips-web-daemon',
      [
        '--nsec',
        TEST_NSEC,
        '--http-port',
        String(httpPort),
        '--udp-port',
        '0',
        '--advert-relays',
        relay.url,
        '--dm-relays',
        relay.url,
        '--no-discover',
      ],
      { FIPS_STUN_SERVERS: stunUrl },
    );

    try {
      await waitFor(() => app.stdout.join('').includes('"reflexiveAddress":{"host":"198.51.100.77"'), 15000);
    } finally {
      await app.close();
    }
  }, 30000);
});
