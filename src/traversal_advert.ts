export const TRAVERSAL_ADVERT_APP = 'fips.nat.traversal.v1';
export const TRAVERSAL_ADVERT_EVENT_KIND = 30078;
export const TRAVERSAL_ADVERT_PROTOCOL = 'fips.nat.traversal.v1';

export interface TraversalAdvert {
  app: string;
  eventKind: number;
  protocol: string;
  publisherNpub: string;
  publishedAt: number;
  expiresAt: number;
  sequence: number;
  relays: string[];
  stunServers: string[];
  transports: string[];
}

export interface TraversalAdvertValidation {
  ok: boolean;
  reason?: string;
}

export interface TraversalAdvertSelection {
  publisherNpub: string;
  protocol: string;
  now: number;
}

export function isTraversalAdvert(value: unknown): value is TraversalAdvert {
  const advert = value as Partial<TraversalAdvert> | undefined;
  return (
    typeof advert?.app === 'string' &&
    typeof advert?.eventKind === 'number' &&
    typeof advert?.protocol === 'string' &&
    typeof advert?.publisherNpub === 'string' &&
    typeof advert?.publishedAt === 'number' &&
    typeof advert?.expiresAt === 'number' &&
    typeof advert?.sequence === 'number' &&
    Array.isArray(advert?.relays) &&
    advert.relays.every((url) => typeof url === 'string') &&
    Array.isArray(advert?.stunServers) &&
    advert.stunServers.every((url) => typeof url === 'string') &&
    Array.isArray(advert?.transports) &&
    advert.transports.every((transport) => typeof transport === 'string')
  );
}

export function validateTraversalAdvert(advert: TraversalAdvert, now: number): TraversalAdvertValidation {
  if (advert.app !== TRAVERSAL_ADVERT_APP) return { ok: false, reason: 'unsupported-app' };
  if (advert.eventKind !== TRAVERSAL_ADVERT_EVENT_KIND) return { ok: false, reason: 'unsupported-event-kind' };
  if (advert.protocol !== TRAVERSAL_ADVERT_PROTOCOL) return { ok: false, reason: 'unsupported-protocol' };
  if (!advert.publisherNpub) return { ok: false, reason: 'missing-publisher-npub' };
  if (!Number.isFinite(advert.publishedAt) || !Number.isFinite(advert.expiresAt) || advert.expiresAt <= advert.publishedAt) {
    return { ok: false, reason: 'invalid-time-window' };
  }
  if (advert.expiresAt <= now) return { ok: false, reason: 'expired-advert' };
  if (advert.relays.length === 0) return { ok: false, reason: 'missing-relays' };
  if (advert.transports.length === 0) return { ok: false, reason: 'missing-transports' };
  return { ok: true };
}

export function selectTraversalAdvert(
  adverts: TraversalAdvert[],
  criteria: TraversalAdvertSelection,
): TraversalAdvert | undefined {
  return adverts
    .filter(
      (advert) =>
        advert.publisherNpub === criteria.publisherNpub &&
        advert.protocol === criteria.protocol &&
        validateTraversalAdvert(advert, criteria.now).ok,
    )
    .sort((left, right) => {
      if (right.publishedAt !== left.publishedAt) return right.publishedAt - left.publishedAt;
      return right.sequence - left.sequence;
    })[0];
}
