import { createHmac, randomUUID } from 'node:crypto';
import type { SignalMessage } from './types.js';

function canonical(value: unknown): string {
  return JSON.stringify(value, Object.keys(value as Record<string, unknown>).sort());
}

export function newSessionId(): string {
  return randomUUID();
}

export function newNonce(): string {
  return randomUUID().replace(/-/g, '');
}

export function signMessage<T extends SignalMessage>(msg: Omit<T, 'signature'>, signingKey: string): T {
  const signature = createHmac('sha256', signingKey).update(canonical(msg)).digest('hex');
  return { ...msg, signature } as T;
}

export function verifyMessageSignature(msg: SignalMessage, signingKey: string): boolean {
  const { signature, ...unsigned } = msg;
  const expected = createHmac('sha256', signingKey).update(canonical(unsigned)).digest('hex');
  return signature === expected;
}
