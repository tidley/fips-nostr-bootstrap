import { describe, expect, it } from 'vitest';

import { validateBootstrapEvent } from './validate.js';
import type { BootstrapEvent } from './types.js';

function mk(overrides: Partial<BootstrapEvent> = {}): BootstrapEvent {
  return {
    kind: 'fipps.bootstrap.init',
    sessionId: 'sid-1',
    fromNostrPubkey: 'npub_x',
    toNostrPubkey: 'npub_y',
    fromFippsIdentity: 'fipps_x',
    ephemeralPubkey: 'epk',
    expiresAt: 9999999999,
    createdAt: 1,
    payload: {},
    sig: 'sig',
    ...overrides,
  };
}

describe('validateBootstrapEvent', () => {
  it('accepts valid init', () => {
    expect(validateBootstrapEvent(mk()).ok).toBe(true);
  });

  it('rejects missing required fields', () => {
    expect(validateBootstrapEvent(mk({ sessionId: '' })).reason).toBe('missing-session-id');
    expect(validateBootstrapEvent(mk({ fromNostrPubkey: '' })).reason).toBe('missing-from-pubkey');
    expect(validateBootstrapEvent(mk({ fromFippsIdentity: '' })).reason).toBe('missing-fipps-identity');
    expect(validateBootstrapEvent(mk({ sig: '' })).reason).toBe('missing-signature');
  });

  it('rejects expired event', () => {
    const r = validateBootstrapEvent(mk({ expiresAt: 1 }), 10);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('expired-event');
  });

  it('rejects missing ephemeral key for init/ack', () => {
    const r1 = validateBootstrapEvent(mk({ ephemeralPubkey: '' }));
    expect(r1.ok).toBe(false);

    const r2 = validateBootstrapEvent(mk({ kind: 'fipps.bootstrap.ack', ephemeralPubkey: '' }));
    expect(r2.ok).toBe(false);
  });

  it('allows confirm without ephemeral key', () => {
    const r = validateBootstrapEvent(mk({ kind: 'fipps.bootstrap.confirm', ephemeralPubkey: undefined }));
    expect(r.ok).toBe(true);
  });
});
