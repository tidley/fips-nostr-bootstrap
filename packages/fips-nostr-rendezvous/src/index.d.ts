import { EventEmitter } from 'node:events';

export const DEFAULT_ADVERT_RELAYS: string[];
export const DEFAULT_DM_RELAYS: string[];
export const DEFAULT_RELAYS: string[];
export const DEFAULT_STUN_SERVERS: string[];

export class FipsNostrRendezvousNode extends EventEmitter {
  [key: string]: any;
  pubkey: string;
  npub: string;
  advertRelays: string[];
  dmRelays: string[];
  relays: string[];
  stunServers: string[];
  udpPort: number;
  pool: any;
  socket: any;
  sub: any;
  advertSub: any;
  advertCache: Map<string, Record<string, unknown>>;
  sessions: Map<string, any>;
  start(): Promise<{ npub: string; udpPort: number }>;
  getNpub(): string;
  listAdvertisedPeers(opts?: Record<string, unknown>): Promise<any[]>;
  findAdvertisedPeer(targetNpub: string, opts?: Record<string, unknown>): Promise<any>;
  connect(targetNpub: string, opts?: Record<string, unknown>): Promise<any>;
  connectFromAdvert(advert: Record<string, unknown>, opts?: Record<string, unknown>): Promise<any>;
  connectToAdvertisedPeer(targetNpub: string, opts?: Record<string, unknown>): Promise<any>;
  connectToDiscoveredPeer(opts?: Record<string, unknown>): Promise<any>;
  close(): void;
}

export function createFipsNostrRendezvousNode(options: Record<string, unknown>): FipsNostrRendezvousNode;
