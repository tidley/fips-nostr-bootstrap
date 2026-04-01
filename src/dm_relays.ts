export const DEFAULT_DM_RELAYS = [
  'wss://nip17.com',
  'wss://nip17.tomdwyer.uk',
  'wss://relay.nostr.band',
  'wss://offchain.pub',
  'wss://www.nostr.ltd',
] as const;

export const DEFAULT_DM_RELAYS_CSV = DEFAULT_DM_RELAYS.join(',');

export function parseDmRelayList(raw = DEFAULT_DM_RELAYS_CSV): string[] {
  return [...new Set(raw.split(',').map((relay) => relay.trim()).filter(Boolean))];
}
