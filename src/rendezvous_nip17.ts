import { generateSecretKey, getPublicKey, nip19 } from 'nostr-tools';
import { wrapEvent, unwrapEvent } from 'nostr-tools/nip17';

export interface HelloMessage {
  type: 'fips.udp.test.hello';
  nonce: string;
  want: 'udp-endpoint';
}

export interface ServerInfoMessage {
  type: 'fips.udp.test.server-info';
  nonce: string;
  endpoint: { host: string; port: number };
  issuedAt: number;
}

export type RendezvousMessage = HelloMessage | ServerInfoMessage;

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

export function isHelloMessage(msg: unknown): msg is HelloMessage {
  const m = msg as Partial<HelloMessage>;
  return m?.type === 'fips.udp.test.hello' && typeof m.nonce === 'string' && m.want === 'udp-endpoint';
}

export function isServerInfoMessage(msg: unknown): msg is ServerInfoMessage {
  const m = msg as Partial<ServerInfoMessage>;
  return (
    m?.type === 'fips.udp.test.server-info' &&
    typeof m.nonce === 'string' &&
    typeof m.endpoint?.host === 'string' &&
    typeof m.endpoint?.port === 'number' &&
    typeof m.issuedAt === 'number'
  );
}
