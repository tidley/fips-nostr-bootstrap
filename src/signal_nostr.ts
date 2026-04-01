import type { SignalMessage } from './types.js';
import { InMemoryTraversalAdvertDirectory, type TraversalAdvertQuery } from './traversal_directory.js';
import type { TraversalAdvert } from './traversal_advert.js';

export interface NostrSignalAdapter {
  publish(message: SignalMessage): void;
  pull(recipientIdentity: string): SignalMessage[];
  publishAdvert(advert: TraversalAdvert): void;
  queryAdverts(criteria: TraversalAdvertQuery): TraversalAdvert[];
}

export class InMemoryNostrSignalAdapter implements NostrSignalAdapter {
  private queue: SignalMessage[] = [];
  private readonly adverts = new InMemoryTraversalAdvertDirectory();

  publish(message: SignalMessage): void {
    this.queue.push(message);
  }

  publishAdvert(advert: TraversalAdvert): void {
    this.adverts.publish(advert);
  }

  queryAdverts(criteria: TraversalAdvertQuery): TraversalAdvert[] {
    return this.adverts.query(criteria);
  }

  pull(recipientIdentity: string): SignalMessage[] {
    const out: SignalMessage[] = [];
    const keep: SignalMessage[] = [];
    for (const msg of this.queue) {
      if (msg.recipientIdentity === recipientIdentity) out.push(msg);
      else keep.push(msg);
    }
    this.queue = keep;
    return out.sort((a, b) => a.monotonicTimestamp - b.monotonicTimestamp);
  }
}
