import { describe, expect, it } from 'vitest';

import { signMessage } from './identity.js';
import type { BootstrapAnnounce } from './types.js';
import { validateSignalMessage } from './validate.js';

const key = 'k-test';

function mk(overrides: Partial<BootstrapAnnounce> = {}): BootstrapAnnounce {
  return signMessage<BootstrapAnnounce>(
    {
      protocolVersion: '1.0',
      messageType: 'bootstrap_announce',
      senderIdentity: 'peer-a',
      recipientIdentity: 'peer-b',
      sessionId: 'sid-1',
      monotonicTimestamp: 10,
      expiry: 100,
      nonce: 'n-1',
      capabilities: ['udp_direct'],
      candidateEndpoints: [{ host: '10.0.0.1', port: 9991, transport: 'udp', priority: 1 }],
      ephemeralHandshakeMaterial: 'epk',
      ...overrides,
    },
    key,
  );
}

describe('validateSignalMessage', () => {
  it('accepts valid signed announce', () => {
    const msg = mk();
    expect(validateSignalMessage(msg, 50, key).ok).toBe(true);
  });

  it('rejects expired', () => {
    const msg = mk({ expiry: 1 });
    expect(validateSignalMessage(msg, 50, key).reason).toBe('expired-message');
  });

  it('rejects bad signature', () => {
    const msg = mk();
    expect(validateSignalMessage(msg, 50, 'wrong').reason).toBe('invalid-signature');
  });

  it('rejects missing endpoint/ephemeral for bootstrap messages', () => {
    const msg = mk({ candidateEndpoints: [], ephemeralHandshakeMaterial: '' });
    expect(validateSignalMessage(msg, 50, key).ok).toBe(false);
  });
});
