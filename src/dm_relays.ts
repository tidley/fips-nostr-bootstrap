export const DEFAULT_DM_RELAYS = [
  'wss://nos.lol',
  'wss://relay.damus.io',
  'wss://relay.primal.net',
  'wss://nip17.com',
  'wss://nip17.tomdwyer.uk',
] as const;

export const DEFAULT_DM_RELAYS_CSV = DEFAULT_DM_RELAYS.join(',');

export function parseDmRelayList(raw = DEFAULT_DM_RELAYS_CSV): string[] {
  return [...new Set(raw.split(',').map((relay) => relay.trim()).filter(Boolean))];
}
