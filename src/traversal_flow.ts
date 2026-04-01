import { chooseFallback } from './fallback.js';
import { attemptDirectProbe, type NatType } from './nat_probe.js';
import { discoverTraversalPeer, createAnswerForOffer, createOfferForPeer, planPunchSession } from './traversal_runtime.js';
import type { NostrSignalAdapter } from './signal_nostr.js';
import type { PlannedPunchTarget } from './punch_planner.js';
import type { StunBindingObservation } from './traversal_stun.js';
import type { TraversalAnswer } from './traversal_signal.js';
import type { EndpointHint } from './types.js';

export interface RunTraversalBootstrapScenarioInput {
  adapter: NostrSignalAdapter;
  nowMs: number;
  localNpub: string;
  remoteNpub: string;
  localNat: NatType;
  remoteNat: NatType;
  sessionId: string;
  offerNonce: string;
  answerNonce: string;
  ttlMs: number;
  localObservation: StunBindingObservation;
  remoteObservation: StunBindingObservation;
  localLeadMs: number;
  remoteLeadMs: number;
  localIntervalMs: number;
  remoteIntervalMs: number;
  localDurationMs: number;
  remoteDurationMs: number;
  maxAttempts: number;
}

export interface TraversalBootstrapScenarioResult {
  advertFound: boolean;
  answerAccepted: boolean;
  answerReason?: string;
  directEstablished: boolean;
  usedFallback: boolean;
  targets: PlannedPunchTarget[];
  schedule: number[];
}

function toEndpointHint(address: PlannedPunchTarget['local'], priority: number): EndpointHint {
  return {
    host: address.ip,
    port: address.port,
    transport: 'udp',
    priority,
  };
}

function targetsToProbeHints(targets: PlannedPunchTarget[]): { local: EndpointHint[]; remote: EndpointHint[] } {
  return {
    local: targets.map((target, index) => toEndpointHint(target.local, index + 1)),
    remote: targets.map((target, index) => toEndpointHint(target.remote, index + 1)),
  };
}

export function runTraversalBootstrapScenario(input: RunTraversalBootstrapScenarioInput): TraversalBootstrapScenarioResult {
  const advert = discoverTraversalPeer(input.adapter, {
    publisherNpub: input.remoteNpub,
    now: input.nowMs,
  });

  const offer = createOfferForPeer({
    senderNpub: input.localNpub,
    recipientNpub: input.remoteNpub,
    sessionId: input.sessionId,
    nonce: input.offerNonce,
    issuedAt: input.nowMs,
    ttlMs: input.ttlMs,
    observation: input.localObservation,
  });

  const answer: TraversalAnswer = createAnswerForOffer({
    offer,
    senderNpub: input.remoteNpub,
    nonce: input.answerNonce,
    issuedAt: input.nowMs + 500,
    ttlMs: input.ttlMs,
    observation: input.remoteObservation,
  });

  if (!advert || !answer.accepted) {
    const fallback = chooseFallback(true, answer.reason || 'advert-missing');
    return {
      advertFound: Boolean(advert),
      answerAccepted: false,
      answerReason: answer.reason,
      directEstablished: false,
      usedFallback: fallback.mode === 'relay_assisted',
      targets: [],
      schedule: [],
    };
  }

  const plan = planPunchSession({
    offer,
    answer,
    nowMs: input.nowMs + 600,
    localLeadMs: input.localLeadMs,
    remoteLeadMs: input.remoteLeadMs,
    localIntervalMs: input.localIntervalMs,
    remoteIntervalMs: input.remoteIntervalMs,
    localDurationMs: input.localDurationMs,
    remoteDurationMs: input.remoteDurationMs,
    maxAttempts: input.maxAttempts,
  });

  const hints = targetsToProbeHints(plan.targets);
  const probe = attemptDirectProbe(
    hints.local,
    hints.remote,
    input.localNat,
    input.remoteNat,
    input.nowMs + 601,
    { intervalMs: plan.window.intervalMs, maxAttempts: plan.schedule.length },
  );

  return {
    advertFound: true,
    answerAccepted: true,
    directEstablished: probe.success,
    usedFallback: !probe.success && chooseFallback(true, 'direct-failed').mode === 'relay_assisted',
    targets: plan.targets,
    schedule: plan.schedule,
  };
}
