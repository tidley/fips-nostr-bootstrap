import { validateTraversalAdvert, type TraversalAdvert } from './traversal_advert.js';

export interface TraversalAdvertQuery {
  publisherNpub?: string;
  protocol?: string;
  now: number;
}

function advertKey(advert: TraversalAdvert): string {
  return `${advert.publisherNpub}::${advert.protocol}`;
}

function isNewer(candidate: TraversalAdvert, current: TraversalAdvert): boolean {
  if (candidate.publishedAt !== current.publishedAt) return candidate.publishedAt > current.publishedAt;
  return candidate.sequence >= current.sequence;
}

export class InMemoryTraversalAdvertDirectory {
  private adverts = new Map<string, TraversalAdvert>();

  publish(advert: TraversalAdvert): void {
    const key = advertKey(advert);
    const existing = this.adverts.get(key);
    if (!existing || isNewer(advert, existing)) {
      this.adverts.set(key, advert);
    }
  }

  query(criteria: TraversalAdvertQuery): TraversalAdvert[] {
    return [...this.adverts.values()]
      .filter((advert) => !criteria.publisherNpub || advert.publisherNpub === criteria.publisherNpub)
      .filter((advert) => !criteria.protocol || advert.protocol === criteria.protocol)
      .filter((advert) => validateTraversalAdvert(advert, criteria.now).ok)
      .sort((left, right) => {
        if (right.publishedAt !== left.publishedAt) return right.publishedAt - left.publishedAt;
        return right.sequence - left.sequence;
      });
  }
}
