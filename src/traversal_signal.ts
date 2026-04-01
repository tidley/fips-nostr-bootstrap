export const TRAVERSAL_SIGNAL_APP = 'fips.nat.traversal.v1';
export const TRAVERSAL_SIGNAL_EVENT_KIND = 21059;

export interface TraversalAddress {
  protocol: 'udp';
  ip: string;
  port: number;
}

export interface TraversalPunchHint {
  startAtMs: number;
  intervalMs: number;
  durationMs: number;
}

export interface TraversalSignalBase {
  app: string;
  eventKind: number;
  type: 'offer' | 'answer';
  sessionId: string;
  issuedAt: number;
  expiresAt: number;
  nonce: string;
  senderNpub: string;
  recipientNpub: string;
  reflexiveAddress?: TraversalAddress;
  localAddresses?: TraversalAddress[];
}

export interface TraversalOffer extends TraversalSignalBase {
  type: 'offer';
}

export interface TraversalAnswer extends TraversalSignalBase {
  type: 'answer';
  inReplyTo: string;
  accepted: boolean;
  punch?: TraversalPunchHint;
  reason?: string;
}

export type TraversalSignal = TraversalOffer | TraversalAnswer;

export interface TraversalValidation {
  ok: boolean;
  reason?: string;
}

export interface CreateTraversalOfferInput {
  sessionId: string;
  issuedAt: number;
  ttlMs: number;
  nonce: string;
  senderNpub: string;
  recipientNpub: string;
  reflexiveAddress?: TraversalAddress;
  localAddresses?: TraversalAddress[];
}

export interface CreateTraversalAnswerInput extends CreateTraversalOfferInput {
  inReplyTo: string;
  accepted: boolean;
  punch?: TraversalPunchHint;
  reason?: string;
}

export function parseTraversalSignal(raw: string): unknown {
  return JSON.parse(raw);
}

export function createTraversalOffer(input: CreateTraversalOfferInput): TraversalOffer {
  return {
    app: TRAVERSAL_SIGNAL_APP,
    eventKind: TRAVERSAL_SIGNAL_EVENT_KIND,
    type: 'offer',
    sessionId: input.sessionId,
    issuedAt: input.issuedAt,
    expiresAt: input.issuedAt + input.ttlMs,
    nonce: input.nonce,
    senderNpub: input.senderNpub,
    recipientNpub: input.recipientNpub,
    reflexiveAddress: input.reflexiveAddress,
    localAddresses: input.localAddresses ?? [],
  };
}

export function createTraversalAnswer(input: CreateTraversalAnswerInput): TraversalAnswer {
  return {
    app: TRAVERSAL_SIGNAL_APP,
    eventKind: TRAVERSAL_SIGNAL_EVENT_KIND,
    type: 'answer',
    sessionId: input.sessionId,
    issuedAt: input.issuedAt,
    expiresAt: input.issuedAt + input.ttlMs,
    nonce: input.nonce,
    senderNpub: input.senderNpub,
    recipientNpub: input.recipientNpub,
    inReplyTo: input.inReplyTo,
    accepted: input.accepted,
    reflexiveAddress: input.reflexiveAddress,
    localAddresses: input.localAddresses ?? [],
    punch: input.punch,
    reason: input.reason,
  };
}

function isAddress(value: unknown): value is TraversalAddress {
  const candidate = value as Partial<TraversalAddress> | undefined;
  return (
    candidate?.protocol === 'udp' &&
    typeof candidate?.ip === 'string' &&
    typeof candidate?.port === 'number' &&
    candidate.port > 0 &&
    candidate.port <= 65535
  );
}

function hasSignalBase(value: unknown): value is TraversalSignalBase {
  const signal = value as Partial<TraversalSignalBase> | undefined;
  return (
    typeof signal?.app === 'string' &&
    (signal?.type === 'offer' || signal?.type === 'answer') &&
    typeof signal?.sessionId === 'string' &&
    typeof signal?.issuedAt === 'number' &&
    typeof signal?.expiresAt === 'number' &&
    typeof signal?.nonce === 'string' &&
    typeof signal?.senderNpub === 'string' &&
    typeof signal?.recipientNpub === 'string' &&
    (signal?.reflexiveAddress === undefined || isAddress(signal.reflexiveAddress)) &&
    (signal?.localAddresses === undefined ||
      (Array.isArray(signal.localAddresses) && signal.localAddresses.every(isAddress)))
  );
}

export function isTraversalOffer(value: unknown): value is TraversalOffer {
  const signal = value as Partial<TraversalOffer> | undefined;
  return hasSignalBase(signal) && signal.type === 'offer';
}

export function isTraversalAnswer(value: unknown): value is TraversalAnswer {
  const signal = value as Partial<TraversalAnswer> | undefined;
  const punch = signal?.punch as Partial<TraversalPunchHint> | undefined;
  return (
    hasSignalBase(signal) &&
    signal.type === 'answer' &&
    typeof signal.inReplyTo === 'string' &&
    typeof signal.accepted === 'boolean' &&
    (signal.reason === undefined || typeof signal.reason === 'string') &&
    (signal.punch === undefined ||
      (typeof punch?.startAtMs === 'number' &&
        typeof punch?.intervalMs === 'number' &&
        typeof punch?.durationMs === 'number'))
  );
}

export function validateTraversalSignal(signal: unknown, now: number): TraversalValidation {
  if (!isTraversalOffer(signal) && !isTraversalAnswer(signal)) return { ok: false, reason: 'invalid-signal' };
  if (signal.app !== TRAVERSAL_SIGNAL_APP) return { ok: false, reason: 'unsupported-app' };
  if (signal.eventKind !== TRAVERSAL_SIGNAL_EVENT_KIND) return { ok: false, reason: 'unsupported-event-kind' };
  if (!signal.sessionId) return { ok: false, reason: 'missing-session-id' };
  if (!signal.nonce) return { ok: false, reason: 'missing-nonce' };
  if (!signal.senderNpub || !signal.recipientNpub) return { ok: false, reason: 'missing-peer-identity' };
  if (!Number.isFinite(signal.issuedAt) || !Number.isFinite(signal.expiresAt) || signal.expiresAt <= signal.issuedAt) {
    return { ok: false, reason: 'invalid-time-window' };
  }
  if (signal.expiresAt <= now) return { ok: false, reason: 'expired-signal' };
  if (!signal.reflexiveAddress && (!isTraversalAnswer(signal) || signal.accepted)) {
    return { ok: false, reason: 'missing-addresses' };
  }
  if (isTraversalAnswer(signal) && !signal.accepted && signal.reason === undefined) {
    return { ok: false, reason: 'missing-rejection-reason' };
  }
  return { ok: true };
}

export function validateTraversalAnswerForOffer({
  offer,
  answer,
  now,
}: {
  offer: TraversalOffer;
  answer: TraversalAnswer;
  now: number;
}): TraversalValidation {
  const offerValidation = validateTraversalSignal(offer, now);
  if (!offerValidation.ok) return offerValidation;
  const answerValidation = validateTraversalSignal(answer, now);
  if (!answerValidation.ok) return answerValidation;
  if (offer.sessionId !== answer.sessionId || answer.inReplyTo !== offer.nonce) {
    return { ok: false, reason: 'session-mismatch' };
  }
  if (offer.senderNpub !== answer.recipientNpub || offer.recipientNpub !== answer.senderNpub) {
    return { ok: false, reason: 'identity-mismatch' };
  }
  if (answer.issuedAt < offer.issuedAt) return { ok: false, reason: 'answer-precedes-offer' };
  return { ok: true };
}
