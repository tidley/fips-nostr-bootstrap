import { describe, expect, it } from 'vitest';

import {
  generateEphemeralIdentity,
  isHelloMessage,
  isServerInfoMessage,
  unwrapRendezvousMessage,
  wrapRendezvousMessage,
} from './rendezvous_nip17.js';

describe('NIP-17 rendezvous (TDD guardrails)', () => {
  it('sends hello DM, receives server-info DM back, and reads it', () => {
    const server = generateEphemeralIdentity();
    const client = generateEphemeralIdentity();

    // client -> server
    const helloEvent = wrapRendezvousMessage(client.sk, server.pubkey, {
      type: 'fips.udp.test.hello',
      nonce: 'roundtrip-1',
      want: 'udp-endpoint',
    });

    const serverInbox = unwrapRendezvousMessage(server.sk, helloEvent);
    expect(serverInbox.senderPubkey).toBe(client.pubkey);
    expect(isHelloMessage(serverInbox.message)).toBe(true);

    // server -> client (reply)
    const replyEvent = wrapRendezvousMessage(server.sk, client.pubkey, {
      type: 'fips.udp.test.server-info',
      nonce: serverInbox.message.nonce,
      endpoint: { host: '198.51.100.44', port: 9999 },
      issuedAt: 1700000000000,
    });

    const clientInbox = unwrapRendezvousMessage(client.sk, replyEvent);
    expect(clientInbox.senderPubkey).toBe(server.pubkey);
    expect(isServerInfoMessage(clientInbox.message)).toBe(true);
    if (isServerInfoMessage(clientInbox.message)) {
      expect(clientInbox.message.nonce).toBe('roundtrip-1');
      expect(clientInbox.message.endpoint.host).toBe('198.51.100.44');
      expect(clientInbox.message.endpoint.port).toBe(9999);
    }
  });
  it('wraps and unwraps hello message correctly', () => {
    const a = generateEphemeralIdentity();
    const b = generateEphemeralIdentity();

    const event = wrapRendezvousMessage(a.sk, b.pubkey, {
      type: 'fips.udp.test.hello',
      nonce: 'n-1',
      want: 'udp-endpoint',
    });

    const out = unwrapRendezvousMessage(b.sk, event);
    expect(out.senderPubkey).toBe(a.pubkey);
    expect(isHelloMessage(out.message)).toBe(true);
    expect(out.message.nonce).toBe('n-1');
  });

  it('wraps and unwraps server-info message correctly', () => {
    const server = generateEphemeralIdentity();
    const client = generateEphemeralIdentity();

    const event = wrapRendezvousMessage(server.sk, client.pubkey, {
      type: 'fips.udp.test.server-info',
      nonce: 'abc',
      endpoint: { host: '203.0.113.10', port: 9999 },
      issuedAt: 1700000000000,
    });

    const out = unwrapRendezvousMessage(client.sk, event);
    expect(out.senderPubkey).toBe(server.pubkey);
    expect(isServerInfoMessage(out.message)).toBe(true);
    if (isServerInfoMessage(out.message)) {
      expect(out.message.endpoint.port).toBe(9999);
      expect(out.message.nonce).toBe('abc');
    }
  });

  it('cannot be unwrapped by wrong recipient key', () => {
    const a = generateEphemeralIdentity();
    const b = generateEphemeralIdentity();
    const c = generateEphemeralIdentity();

    const event = wrapRendezvousMessage(a.sk, b.pubkey, {
      type: 'fips.udp.test.hello',
      nonce: 'n-2',
      want: 'udp-endpoint',
    });

    expect(() => unwrapRendezvousMessage(c.sk, event)).toThrow();
  });
});
