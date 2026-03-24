import { generateSecretKey, getPublicKey, nip19 } from 'nostr-tools';
import { wrapEvent, unwrapEvent } from 'nostr-tools/nip17';

export type RendezvousMessageType = 'fips.rendezvous.hello' | 'fips.rendezvous.server-info' | 'fips.rendezvous.error';

export interface WireMeta {
  version: '1.0';
  sessionId: string;
  nonce: string;
  issuedAt: number;
}

export interface HelloMessage extends WireMeta {
  type: 'fips.rendezvous.hello';
  clientEndpoint?: { host: string; port: number };
  wants: {
    stunInfo: boolean;
    fipsConnect: boolean;
  };
  capabilities?: string[];
}

export interface ServerInfoMessage extends WireMeta {
  type: 'fips.rendezvous.server-info';
  endpoint: { host: string; port: number };
  punch?: {
    startAtMs: number;
    intervalMs: number;
    durationMs: number;
  };
  stun?: {
    uri: string;
    metadataTag?: string;
  };
}

export interface ErrorMessage extends WireMeta {
  type: 'fips.rendezvous.error';
  code: 'bad-request' | 'untrusted-peer' | 'unsupported-version' | 'internal-error';
  message: string;
}

export type RendezvousMessage = HelloMessage | ServerInfoMessage | ErrorMessage;

export function generateEphemeralIdentity() {
  const sk = generateSecretKey();
  const pubkey = getPublicKey(sk);
  return { sk, pubkey, npub: nip19.npubEncode(pubkey) };
}

export function wrapRendezvousMessage(senderSk: Uint8Array, recipientPubkey: string, msg: RendezvousMessage) {
  return wrapEvent(senderSk, { publicKey: recipientPubkey }, JSON.stringify(msg));
}

export function unwrapRendezvousMessage(recipientSk: Uint8Array, event: Parameters<typeof unwrapEvent>[0]) {
  const rumor = unwrapEvent(event, recipientSk);
  const parsed = JSON.parse(rumor.content) as RendezvousMessage;
  return {
    senderPubkey: rumor.pubkey,
    message: parsed,
  };
}

function hasWireMeta(msg: unknown): msg is WireMeta {
  const m = msg as Partial<WireMeta>;
  return (
    m?.version === '1.0' &&
    typeof m.sessionId === 'string' &&
    m.sessionId.length > 0 &&
    typeof m.nonce === 'string' &&
    m.nonce.length > 0 &&
    typeof m.issuedAt === 'number'
  );
}

export function isHelloMessage(msg: unknown): msg is HelloMessage {
  const m = msg as Partial<HelloMessage> & Record<string, unknown>;
  return (
    m?.type === 'fips.rendezvous.hello' &&
    hasWireMeta(m) &&
    typeof m.wants === 'object' &&
    typeof m.wants?.stunInfo === 'boolean' &&
    typeof m.wants?.fipsConnect === 'boolean'
  );
}

export function isServerInfoMessage(msg: unknown): msg is ServerInfoMessage {
  const m = msg as Partial<ServerInfoMessage> & Record<string, unknown>;
  return (
    m?.type === 'fips.rendezvous.server-info' &&
    hasWireMeta(m) &&
    typeof m.endpoint?.host === 'string' &&
    typeof m.endpoint?.port === 'number'
  );
}

export function isErrorMessage(msg: unknown): msg is ErrorMessage {
  const m = msg as Partial<ErrorMessage> & Record<string, unknown>;
  return (
    m?.type === 'fips.rendezvous.error' &&
    hasWireMeta(m) &&
    typeof m.code === 'string' &&
    typeof m.message === 'string'
  );
}
