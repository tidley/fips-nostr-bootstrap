// @ts-nocheck
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSocket } from 'node:dgram';
import { startEmbeddedRelay, type EmbeddedRelayServer } from './embedded_relay.js';
import { createFipsNostrRendezvousNode } from '../packages/fips-nostr-rendezvous/src/index.js';

function xorMappedAddress(ip: string, port: number): Buffer {
  const attr = Buffer.alloc(12);
  attr.writeUInt16BE(0x0020, 0);
  attr.writeUInt16BE(8, 2);
  attr[5] = 0x01;
  attr.writeUInt16BE(port ^ 0x2112, 6);
  const cookie = Buffer.from([0x21, 0x12, 0xa4, 0x42]);
  ip.split('.').map((part) => Number(part)).forEach((part, index) => {
    attr[8 + index] = part ^ cookie[index];
  });
  return attr;
}

describe('runtime STUN integration', () => {
  let relay: EmbeddedRelayServer;
  let stunServer: ReturnType<typeof createSocket>;
  let stunUrl: string;

  beforeAll(async () => {
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
  });

  afterAll(async () => {
    await relay.close();
    await new Promise<void>((resolve) => stunServer.close(() => resolve()));
  });

  it('observes a reflexive address from STUN and uses it in traversal candidates', async () => {
    const node = createFipsNostrRendezvousNode({
      relays: [relay.url],
      advertise: false,
      publishInboxRelays: false,
      udpPort: 0,
      stunServers: [stunUrl],
    });

    try {
      await node.start();
      const traversal = node._resolveTraversalCandidates();
      expect(traversal.reflexiveAddress).toEqual({
        protocol: 'udp',
        ip: '198.51.100.77',
        port: node.socket.address().port,
      });
      expect(traversal.localAddresses.length).toBeGreaterThan(0);
    } finally {
      node.close();
    }
  }, 15000);
});
