export type JoinRole = 'initiator' | 'receiver';

export interface BootstrapPolicyInput {
  role: JoinRole;
  delaySinceAcceptMs: number;
  freshnessWindowMs: number;
  hasPendingOffer: boolean;
}

export interface BootstrapPolicyDecision {
  needsFreshnessHandshake: boolean;
  preferredOfferer: JoinRole;
  shouldAnswerPendingOfferFirst: boolean;
}

/**
 * Lightweight policy model for pre-media bootstrap timing/role behavior.
 * This is transport-agnostic and intentionally deterministic for testing.
 */
export function decideBootstrapPolicy(input: BootstrapPolicyInput): BootstrapPolicyDecision {
  const needsFreshnessHandshake = input.delaySinceAcceptMs > input.freshnessWindowMs;

  // If both sides are fresh, receiver answering an existing pending offer is preferred.
  const shouldAnswerPendingOfferFirst = input.hasPendingOffer && !needsFreshnessHandshake;

  // After stale delay, prefer initiator to re-offer to re-synchronize quickly.
  const preferredOfferer: JoinRole = needsFreshnessHandshake ? 'initiator' : input.role;

  return {
    needsFreshnessHandshake,
    preferredOfferer,
    shouldAnswerPendingOfferFirst,
  };
}

export interface RetryOutcome {
  stage: 'none' | 'ice-restart' | 'full-reconnect' | 'failed';
  attempts: number;
}

/**
 * Deterministic retry evaluator:
 * - stage0: initial attempt
 * - stage1: one-shot ice restart
 * - stage2+: bounded full reconnects
 */
export function evaluateRetryPath(successByStage: boolean[], maxFullReconnects = 3): RetryOutcome {
  // 0 = initial, 1 = ice-restart, 2.. = full reconnect attempts
  if (successByStage[0]) return { stage: 'none', attempts: 0 };
  if (successByStage[1]) return { stage: 'ice-restart', attempts: 1 };

  for (let i = 0; i < maxFullReconnects; i++) {
    if (successByStage[2 + i]) {
      return { stage: 'full-reconnect', attempts: i + 1 };
    }
  }

  return { stage: 'failed', attempts: maxFullReconnects };
}
