export const DEFAULT_DM_RELAYS = [
  'wss://nip17.com',
  'wss://offchain.pub',
] as const;

export const DEFAULT_DM_RELAYS_CSV = DEFAULT_DM_RELAYS.join(',');

export function parseDmRelayList(raw = DEFAULT_DM_RELAYS_CSV): string[] {
  return [...new Set(raw.split(',').map((relay) => relay.trim()).filter(Boolean))];
}
