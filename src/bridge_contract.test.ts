import { describe, expect, it } from 'vitest';
import { isHelloMessage, isServerInfoMessage } from './rendezvous_nip17.js';

describe('bridge signaling contract', () => {
  it('accepts hello message shape', () => {
    const msg = { type: 'fips.udp.test.hello', nonce: 'abc', want: 'udp-endpoint' };
    expect(isHelloMessage(msg)).toBe(true);
  });

  it('accepts server info message shape', () => {
    const msg = {
      type: 'fips.udp.test.server-info',
      nonce: 'xyz',
      endpoint: { host: '127.0.0.1', port: 9999 },
      issuedAt: Date.now(),
    };
    expect(isServerInfoMessage(msg)).toBe(true);
  });

  it('rejects malformed server info', () => {
    const msg = {
      type: 'fips.udp.test.server-info',
      nonce: 'xyz',
      endpoint: { host: '127.0.0.1', port: 'bad' },
      issuedAt: Date.now(),
    };
    expect(isServerInfoMessage(msg)).toBe(false);
  });
});
