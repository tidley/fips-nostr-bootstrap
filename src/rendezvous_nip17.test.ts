import { describe, expect, it } from 'vitest';

import {
  generateEphemeralIdentity,
  isErrorMessage,
  isHelloMessage,
  isServerInfoMessage,
  unwrapRendezvousMessage,
  wrapRendezvousMessage,
} from './rendezvous_nip17.js';

describe('NIP-17 rendezvous wire contract', () => {
  it('sends hello DM and receives server-info DM with matching nonce/session', () => {
    const server = generateEphemeralIdentity();
    const client = generateEphemeralIdentity();

    const helloEvent = wrapRendezvousMessage(client.sk, server.pubkey, {
      type: 'fips.rendezvous.hello',
      version: '1.0',
      sessionId: 'sess-1',
      nonce: 'roundtrip-1',
      issuedAt: 1700000000000,
      wants: { stunInfo: true, fipsConnect: true },
      capabilities: ['udp-hole-punch-v1'],
    });

    const serverInbox = unwrapRendezvousMessage(server.sk, helloEvent);
    expect(serverInbox.senderPubkey).toBe(client.pubkey);
    expect(isHelloMessage(serverInbox.message)).toBe(true);

    const replyEvent = wrapRendezvousMessage(server.sk, client.pubkey, {
      type: 'fips.rendezvous.server-info',
      version: '1.0',
      sessionId: 'sess-1',
      nonce: 'roundtrip-1',
      issuedAt: 1700000000100,
      endpoint: { host: '45.77.228.152', port: 9999 },
      punch: { startAtMs: 1700000000200, intervalMs: 300, durationMs: 30000 },
      stun: { uri: 'stun:45.77.228.152:3478', metadataTag: 'stun' },
    });

    const clientInbox = unwrapRendezvousMessage(client.sk, replyEvent);
    expect(clientInbox.senderPubkey).toBe(server.pubkey);
    expect(isServerInfoMessage(clientInbox.message)).toBe(true);
    if (isServerInfoMessage(clientInbox.message)) {
      expect(clientInbox.message.nonce).toBe('roundtrip-1');
      expect(clientInbox.message.sessionId).toBe('sess-1');
      expect(clientInbox.message.endpoint.host).toBe('45.77.228.152');
      expect(clientInbox.message.endpoint.port).toBe(9999);
      expect(clientInbox.message.stun?.uri).toBe('stun:45.77.228.152:3478');
    }
  });

  it('wraps and unwraps error message correctly', () => {
    const server = generateEphemeralIdentity();
    const client = generateEphemeralIdentity();

    const event = wrapRendezvousMessage(server.sk, client.pubkey, {
      type: 'fips.rendezvous.error',
      version: '1.0',
      sessionId: 'sess-2',
      nonce: 'n-err',
      issuedAt: 1700000000500,
      code: 'untrusted-peer',
      message: 'sender not allowlisted',
    });

    const out = unwrapRendezvousMessage(client.sk, event);
    expect(out.senderPubkey).toBe(server.pubkey);
    expect(isErrorMessage(out.message)).toBe(true);
    if (isErrorMessage(out.message)) {
      expect(out.message.code).toBe('untrusted-peer');
    }
  });

  it('cannot be unwrapped by wrong recipient key', () => {
    const a = generateEphemeralIdentity();
    const b = generateEphemeralIdentity();
    const c = generateEphemeralIdentity();

    const event = wrapRendezvousMessage(a.sk, b.pubkey, {
      type: 'fips.rendezvous.hello',
      version: '1.0',
      sessionId: 'sess-3',
      nonce: 'n-2',
      issuedAt: 1700000000600,
      wants: { stunInfo: true, fipsConnect: false },
    });

    expect(() => unwrapRendezvousMessage(c.sk, event)).toThrow();
  });
});
