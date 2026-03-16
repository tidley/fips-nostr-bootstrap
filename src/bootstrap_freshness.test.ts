import { describe, expect, it } from 'vitest';
import { decideBootstrapPolicy, evaluateRetryPath } from './bootstrap_freshness';

describe('bootstrap freshness policy', () => {
  it('does not require freshness handshake inside freshness window', () => {
    const d = decideBootstrapPolicy({
      role: 'receiver',
      delaySinceAcceptMs: 4_000,
      freshnessWindowMs: 12_000,
      hasPendingOffer: true,
    });

    expect(d.needsFreshnessHandshake).toBe(false);
    expect(d.shouldAnswerPendingOfferFirst).toBe(true);
  });

  it('requires freshness handshake after stale delay', () => {
    const d = decideBootstrapPolicy({
      role: 'receiver',
      delaySinceAcceptMs: 25_000,
      freshnessWindowMs: 12_000,
      hasPendingOffer: true,
    });

    expect(d.needsFreshnessHandshake).toBe(true);
    expect(d.preferredOfferer).toBe('initiator');
    expect(d.shouldAnswerPendingOfferFirst).toBe(false);
  });

  it('keeps role local when fresh and no pending offer', () => {
    const d = decideBootstrapPolicy({
      role: 'initiator',
      delaySinceAcceptMs: 2_000,
      freshnessWindowMs: 12_000,
      hasPendingOffer: false,
    });

    expect(d.needsFreshnessHandshake).toBe(false);
    expect(d.preferredOfferer).toBe('initiator');
  });
});

describe('retry path evaluator', () => {
  it('reports initial success as none', () => {
    expect(evaluateRetryPath([true])).toEqual({ stage: 'none', attempts: 0 });
  });

  it('reports ice-restart success', () => {
    expect(evaluateRetryPath([false, true])).toEqual({ stage: 'ice-restart', attempts: 1 });
  });

  it('reports full-reconnect success at second full attempt', () => {
    expect(evaluateRetryPath([false, false, false, true], 3)).toEqual({ stage: 'full-reconnect', attempts: 2 });
  });

  it('reports failed when all stages fail', () => {
    expect(evaluateRetryPath([false, false, false, false, false], 3)).toEqual({ stage: 'failed', attempts: 3 });
  });
});
