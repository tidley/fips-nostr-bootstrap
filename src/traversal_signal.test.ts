import { describe, expect, it } from 'vitest';

import {
  createTraversalAnswer,
  createTraversalOffer,
  isTraversalAnswer,
  isTraversalOffer,
  parseTraversalSignal,
  validateTraversalAnswerForOffer,
  validateTraversalSignal,
  type TraversalAnswer,
  type TraversalOffer,
} from './traversal_signal.js';

function candidate(overrides: Partial<TraversalOffer['reflexiveAddress']> = {}) {
  return {
    protocol: 'udp' as const,
    ip: '192.168.1.10',
    port: 49152,
    ...overrides,
  };
}

function offer(overrides: Partial<TraversalOffer> = {}): TraversalOffer {
  return {
    app: 'fips.nat.traversal.v1',
    eventKind: 21059,
    type: 'offer',
    sessionId: 'sess-1',
    issuedAt: 1_700_000_000_000,
    expiresAt: 1_700_000_060_000,
    nonce: 'offer-nonce-1',
    senderNpub: 'npub1initiator',
    recipientNpub: 'npub1responder',
    reflexiveAddress: candidate({ ip: '203.0.113.10', port: 49152 }),
    localAddresses: [candidate()],
    ...overrides,
  };
}

function answer(overrides: Partial<TraversalAnswer> = {}): TraversalAnswer {
  return {
    app: 'fips.nat.traversal.v1',
    eventKind: 21059,
    type: 'answer',
    sessionId: 'sess-1',
    issuedAt: 1_700_000_000_500,
    expiresAt: 1_700_000_060_500,
    nonce: 'answer-nonce-1',
    senderNpub: 'npub1responder',
    recipientNpub: 'npub1initiator',
    inReplyTo: 'offer-nonce-1',
    accepted: true,
    reflexiveAddress: candidate({ ip: '203.0.113.9', port: 49000 }),
    localAddresses: [candidate({ ip: '192.168.1.20', port: 49000 })],
    punch: { startAtMs: 1_700_000_001_500, intervalMs: 300, durationMs: 30_000 },
    ...overrides,
  };
}

describe('traversal offer/answer contract', () => {
  it('creates an issue-aligned offer from normalized addresses', () => {
    const created = createTraversalOffer({
      sessionId: 'sess-1',
      issuedAt: 1_700_000_000_000,
      ttlMs: 60_000,
      nonce: 'offer-nonce-1',
      senderNpub: 'npub1initiator',
      recipientNpub: 'npub1responder',
      reflexiveAddress: candidate({ ip: '203.0.113.10', port: 49152 }),
      localAddresses: [candidate({ ip: '192.168.1.10', port: 49152 })],
    });

    expect(created.app).toBe('fips.nat.traversal.v1');
    expect(created.eventKind).toBe(21059);
    expect(created.type).toBe('offer');
    expect(created.localAddresses?.length).toBe(1);
    expect(created.reflexiveAddress?.ip).toBe('203.0.113.10');
  });

  it('creates a rejection answer when traversal cannot proceed', () => {
    const created = createTraversalAnswer({
      sessionId: 'sess-1',
      issuedAt: 1_700_000_000_500,
      ttlMs: 60_000,
      nonce: 'answer-nonce-1',
      senderNpub: 'npub1responder',
      recipientNpub: 'npub1initiator',
      inReplyTo: 'offer-nonce-1',
      accepted: false,
      reason: 'stun-unavailable',
    });

    expect(created.accepted).toBe(false);
    expect(created.reason).toBe('stun-unavailable');
    expect(validateTraversalSignal(created, 1_700_000_001_000)).toEqual({ ok: true });
  });

  it('parses and validates an offer roundtrip', () => {
    const raw = JSON.stringify(offer());
    const parsed = parseTraversalSignal(raw);

    expect(isTraversalOffer(parsed)).toBe(true);
    expect(validateTraversalSignal(parsed, 1_700_000_001_000)).toEqual({ ok: true });
  });

  it('parses and validates an answer roundtrip', () => {
    const raw = JSON.stringify(answer());
    const parsed = parseTraversalSignal(raw);

    expect(isTraversalAnswer(parsed)).toBe(true);
    expect(validateTraversalSignal(parsed, 1_700_000_001_000)).toEqual({ ok: true });
  });

  it('rejects expired offers', () => {
    const parsed = parseTraversalSignal(JSON.stringify(offer({ expiresAt: 1_700_000_000_100 })));

    expect(validateTraversalSignal(parsed, 1_700_000_000_200)).toEqual({
      ok: false,
      reason: 'expired-signal',
    });
  });

  it('rejects signals without candidates when accepted', () => {
    const parsed = parseTraversalSignal(JSON.stringify(answer({ reflexiveAddress: undefined, localAddresses: [] })));

    expect(validateTraversalSignal(parsed, 1_700_000_001_000)).toEqual({
      ok: false,
      reason: 'missing-addresses',
    });
  });

  it('accepts a matching answer for an offer', () => {
    expect(
      validateTraversalAnswerForOffer({
        offer: offer(),
        answer: answer(),
        now: 1_700_000_001_000,
      }),
    ).toEqual({ ok: true });
  });

  it('rejects answers that do not bind to the offer session and nonce', () => {
    expect(
      validateTraversalAnswerForOffer({
        offer: offer(),
        answer: answer({ sessionId: 'sess-2', inReplyTo: 'other-nonce' }),
        now: 1_700_000_001_000,
      }),
    ).toEqual({
      ok: false,
      reason: 'session-mismatch',
    });
  });

  it('rejects answers whose sender and recipient do not mirror the offer', () => {
    expect(
      validateTraversalAnswerForOffer({
        offer: offer(),
        answer: answer({ senderNpub: 'npub1third-party' }),
        now: 1_700_000_001_000,
      }),
    ).toEqual({
      ok: false,
      reason: 'identity-mismatch',
    });
  });
});
