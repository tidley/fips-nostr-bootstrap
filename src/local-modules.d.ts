declare module '../packages/fips-nostr-rendezvous/src/index.js' {
  import { EventEmitter } from 'node:events';

  export class FipsNostrRendezvousNode extends EventEmitter {
    pubkey: string;
    npub: string;
    start(): Promise<{ npub: string; udpPort: number }>;
    close(): void;
  }

  export function createFipsNostrRendezvousNode(options: Record<string, unknown>): FipsNostrRendezvousNode;
}
