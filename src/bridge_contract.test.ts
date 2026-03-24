import { describe, expect, it } from 'vitest';
import { isErrorMessage, isHelloMessage, isServerInfoMessage } from './rendezvous_nip17.js';

describe('bridge signaling contract', () => {
  it('accepts hello message shape', () => {
    const msg = {
      type: 'fips.rendezvous.hello',
      version: '1.0',
      sessionId: 'sess-1',
      nonce: 'abc',
      issuedAt: Date.now(),
      wants: { stunInfo: true, fipsConnect: true },
    };
    expect(isHelloMessage(msg)).toBe(true);
  });

  it('accepts server info message shape', () => {
    const msg = {
      type: 'fips.rendezvous.server-info',
      version: '1.0',
      sessionId: 'sess-1',
      nonce: 'xyz',
      endpoint: { host: '45.77.228.152', port: 9999 },
      issuedAt: Date.now(),
      stun: { uri: 'stun:45.77.228.152:3478' },
    };
    expect(isServerInfoMessage(msg)).toBe(true);
  });

  it('accepts error message shape', () => {
    const msg = {
      type: 'fips.rendezvous.error',
      version: '1.0',
      sessionId: 'sess-1',
      nonce: 'xyz',
      issuedAt: Date.now(),
      code: 'bad-request',
      message: 'missing wants field',
    };
    expect(isErrorMessage(msg)).toBe(true);
  });

  it('rejects malformed server info', () => {
    const msg = {
      type: 'fips.rendezvous.server-info',
      version: '1.0',
      sessionId: 'sess-1',
      nonce: 'xyz',
      endpoint: { host: '45.77.228.152', port: 'bad' },
      issuedAt: Date.now(),
    };
    expect(isServerInfoMessage(msg)).toBe(false);
  });
});
