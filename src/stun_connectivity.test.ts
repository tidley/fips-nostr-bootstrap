import { createSocket } from 'node:dgram';
import { randomBytes } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { describe, expect, test } from 'vitest';

function parseStunUrl(input: string): { host: string; port: number } {
  const raw = input.replace(/^stun:/, '');
  const idx = raw.lastIndexOf(':');
  if (idx <= 0) throw new Error(`invalid STUN url: ${input}`);
  const host = raw.slice(0, idx);
  const port = Number(raw.slice(idx + 1));
  if (!host || !Number.isFinite(port)) throw new Error(`invalid STUN url: ${input}`);
  return { host, port };
}

function makeBindingRequest(txnId: Buffer): Buffer {
  const msg = Buffer.alloc(20);
  msg.writeUInt16BE(0x0001, 0); // Binding Request
  msg.writeUInt16BE(0x0000, 2); // no attrs
  msg.writeUInt32BE(0x2112a442, 4); // magic cookie
  txnId.copy(msg, 8);
  return msg;
}

async function probeStun(stunUrl: string, timeoutMs = 3000): Promise<Buffer> {
  const { host, port } = parseStunUrl(stunUrl);
  const resolved = await lookup(host, { all: true });
  const addr = resolved.find((r) => r.family === 4) ?? resolved[0];
  if (!addr) throw new Error(`unable to resolve ${host}`);

  const socket = createSocket(addr.family === 6 ? 'udp6' : 'udp4');
  const txnId = randomBytes(12);
  const req = makeBindingRequest(txnId);

  return await new Promise<Buffer>((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.close();
      reject(new Error(`stun timeout to ${host}:${port}`));
    }, timeoutMs);

    socket.once('message', (msg) => {
      clearTimeout(timer);
      socket.close();
      resolve(msg);
    });

    socket.once('error', (err) => {
      clearTimeout(timer);
      socket.close();
      reject(err);
    });

    socket.send(req, port, addr.address);
  });
}

describe('STUN connectivity', () => {
  const stunUrl = process.env.FIPS_STUN_URL || 'stun:45.77.228.152:3478';

  test('STUN URL is parseable', () => {
    const parsed = parseStunUrl(stunUrl);
    expect(parsed.host.length).toBeGreaterThan(0);
    expect(parsed.port).toBeGreaterThan(0);
  });

  test('can reach configured STUN server and receive Binding Success', async () => {
    const response = await probeStun(stunUrl, 4000);

    expect(response.length).toBeGreaterThanOrEqual(20);
    const msgType = response.readUInt16BE(0);
    const cookie = response.readUInt32BE(4);

    // RFC5389 Binding Success Response
    expect(msgType).toBe(0x0101);
    expect(cookie).toBe(0x2112a442);
  }, 10000);
});
