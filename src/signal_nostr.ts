import type { SignalMessage } from './types.js';

export interface NostrSignalAdapter {
  publish(message: SignalMessage): void;
  pull(recipientIdentity: string): SignalMessage[];
}

export class InMemoryNostrSignalAdapter implements NostrSignalAdapter {
  private queue: SignalMessage[] = [];

  publish(message: SignalMessage): void {
    this.queue.push(message);
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
