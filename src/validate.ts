import { verifyMessageSignature } from './identity.js';
import type { SignalMessage } from './types.js';

export interface ValidationResult {
  ok: boolean;
  reason?: string;
}

export function validateSignalMessage(msg: SignalMessage, now: number, signerKey: string): ValidationResult {
  if (msg.protocolVersion !== '1.0') return { ok: false, reason: 'unsupported-version' };
  if (!msg.senderIdentity) return { ok: false, reason: 'missing-sender-identity' };
  if (!msg.recipientIdentity) return { ok: false, reason: 'missing-recipient-identity' };
  if (!msg.sessionId) return { ok: false, reason: 'missing-session-id' };
  if (!msg.nonce) return { ok: false, reason: 'missing-nonce' };
  if (msg.expiry < now) return { ok: false, reason: 'expired-message' };
  if (!verifyMessageSignature(msg, signerKey)) return { ok: false, reason: 'invalid-signature' };

  if (msg.messageType === 'bootstrap_announce' || msg.messageType === 'bootstrap_ack') {
    if (!msg.ephemeralHandshakeMaterial) return { ok: false, reason: 'missing-ephemeral-handshake-material' };
    if (msg.candidateEndpoints.length === 0) return { ok: false, reason: 'missing-candidate-endpoints' };
  }

  return { ok: true };
}
