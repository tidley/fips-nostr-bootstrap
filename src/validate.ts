import type { BootstrapEvent } from './types.js';

export interface ValidationResult {
  ok: boolean;
  reason?: string;
}

export function validateBootstrapEvent(event: BootstrapEvent, now = Math.floor(Date.now() / 1000)): ValidationResult {
  if (!event.sessionId) return { ok: false, reason: 'missing-session-id' };
  if (!event.fromNostrPubkey) return { ok: false, reason: 'missing-from-pubkey' };
  if (!event.fromFippsIdentity) return { ok: false, reason: 'missing-fipps-identity' };
  if (!event.sig) return { ok: false, reason: 'missing-signature' };
  if (event.expiresAt < now) return { ok: false, reason: 'expired-event' };

  if (event.kind === 'fipps.bootstrap.init' || event.kind === 'fipps.bootstrap.ack') {
    if (!event.ephemeralPubkey) return { ok: false, reason: 'missing-ephemeral-key' };
  }

  return { ok: true };
}
