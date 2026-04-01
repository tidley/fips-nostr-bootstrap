import { buildPunchAttemptSchedule, negotiatePunchWindow, planPunchTargets, type BuildPunchAttemptScheduleInput, type NegotiatePunchWindowInput, type PlannedPunchTarget, type PunchWindow } from './punch_planner.js';
import type { NostrSignalAdapter } from './signal_nostr.js';
import { createTraversalAnswer, createTraversalOffer, type TraversalAnswer, type TraversalOffer } from './traversal_signal.js';
import { deriveTraversalAddresses, type StunBindingObservation } from './traversal_stun.js';
import { selectTraversalAdvert, TRAVERSAL_ADVERT_PROTOCOL, type TraversalAdvert } from './traversal_advert.js';

export interface DiscoverTraversalPeerInput {
  publisherNpub: string;
  now: number;
  protocol?: string;
}

export interface CreateOfferForPeerInput {
  senderNpub: string;
  recipientNpub: string;
  sessionId: string;
  nonce: string;
  issuedAt: number;
  ttlMs: number;
  observation: StunBindingObservation;
}

export interface CreateAnswerForOfferInput {
  offer: TraversalOffer;
  senderNpub: string;
  nonce: string;
  issuedAt: number;
  ttlMs: number;
  observation: StunBindingObservation;
}

export interface PlanPunchSessionInput extends NegotiatePunchWindowInput, Pick<BuildPunchAttemptScheduleInput, 'maxAttempts'> {
  offer: TraversalOffer;
  answer: TraversalAnswer;
}

export interface TraversalSessionPlan {
  targets: PlannedPunchTarget[];
  window: PunchWindow;
  schedule: number[];
}

export function discoverTraversalPeer(adapter: NostrSignalAdapter, input: DiscoverTraversalPeerInput): TraversalAdvert | undefined {
  const adverts = adapter.queryAdverts({
    publisherNpub: input.publisherNpub,
    protocol: input.protocol || TRAVERSAL_ADVERT_PROTOCOL,
    now: input.now,
  });
  return selectTraversalAdvert(adverts, {
    publisherNpub: input.publisherNpub,
    protocol: input.protocol || TRAVERSAL_ADVERT_PROTOCOL,
    now: input.now,
  });
}

export function createOfferForPeer(input: CreateOfferForPeerInput): TraversalOffer {
  const derived = deriveTraversalAddresses(input.observation);
  return createTraversalOffer({
    sessionId: input.sessionId,
    issuedAt: input.issuedAt,
    ttlMs: input.ttlMs,
    nonce: input.nonce,
    senderNpub: input.senderNpub,
    recipientNpub: input.recipientNpub,
    reflexiveAddress: derived.reflexiveAddress,
    localAddresses: derived.localAddresses,
  });
}

export function createAnswerForOffer(input: CreateAnswerForOfferInput): TraversalAnswer {
  const derived = deriveTraversalAddresses(input.observation);
  const hasAddresses = Boolean(derived.reflexiveAddress) || derived.localAddresses.length > 0;
  return createTraversalAnswer({
    sessionId: input.offer.sessionId,
    issuedAt: input.issuedAt,
    ttlMs: input.ttlMs,
    nonce: input.nonce,
    senderNpub: input.senderNpub,
    recipientNpub: input.offer.senderNpub,
    inReplyTo: input.offer.nonce,
    accepted: hasAddresses,
    reflexiveAddress: derived.reflexiveAddress,
    localAddresses: derived.localAddresses,
    reason: hasAddresses ? undefined : 'no-usable-addresses',
  });
}

export function planPunchSession(input: PlanPunchSessionInput): TraversalSessionPlan {
  const targets = planPunchTargets({
    localAddresses: input.offer.localAddresses ?? [],
    localReflexiveAddress: input.offer.reflexiveAddress,
    remoteAddresses: input.answer.localAddresses ?? [],
    remoteReflexiveAddress: input.answer.reflexiveAddress,
  });
  const window = negotiatePunchWindow(input);
  const schedule = buildPunchAttemptSchedule({
    ...window,
    maxAttempts: input.maxAttempts,
  });
  return { targets, window, schedule };
}
