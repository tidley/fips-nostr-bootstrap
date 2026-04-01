declare module '../packages/fips-nostr-rendezvous/src/index.js' {
  import { EventEmitter } from 'node:events';

  export class FipsNostrRendezvousNode extends EventEmitter {
    pubkey: string;
    npub: string;
    start(): Promise<{ npub: string; udpPort: number }>;
    getNpub(): string;
    listAdvertisedPeers(opts?: Record<string, unknown>): Promise<Record<string, unknown>[]>;
    findAdvertisedPeer(targetNpub: string, opts?: Record<string, unknown>): Promise<Record<string, unknown>>;
    connect(targetNpub: string, opts?: Record<string, unknown>): Promise<Record<string, unknown>>;
    connectFromAdvert(advert: Record<string, unknown>, opts?: Record<string, unknown>): Promise<Record<string, unknown>>;
    connectToAdvertisedPeer(targetNpub: string, opts?: Record<string, unknown>): Promise<Record<string, unknown>>;
    connectToDiscoveredPeer(opts?: Record<string, unknown>): Promise<Record<string, unknown>>;
    close(): void;
  }

  export function createFipsNostrRendezvousNode(options: Record<string, unknown>): FipsNostrRendezvousNode;
}
