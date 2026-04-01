import { describe, expect, it } from 'vitest';

import { DEFAULT_DM_RELAYS, DEFAULT_DM_RELAYS_CSV, parseDmRelayList } from './dm_relays.js';

describe('DM relay defaults', () => {
  it('includes the preferred NIP-17 relays', () => {
    expect(DEFAULT_DM_RELAYS).toContain('wss://nip17.com');
    expect(DEFAULT_DM_RELAYS).toContain('wss://nip17.tomdwyer.uk');
  });

  it('includes additional public relays so startup is not pinned to one host', () => {
    expect(DEFAULT_DM_RELAYS).toContain('wss://relay.snort.social');
    expect(DEFAULT_DM_RELAYS).toContain('wss://relay.nostr.band');
    expect(DEFAULT_DM_RELAYS).toContain('wss://offchain.pub');
    expect(DEFAULT_DM_RELAYS).toContain('wss://relay.nos.social');
  });

  it('parses and de-duplicates relay lists', () => {
    expect(parseDmRelayList(` ${DEFAULT_DM_RELAYS_CSV},wss://nip17.com `)).toEqual([...DEFAULT_DM_RELAYS]);
  });

  it('uses secure websocket relay URLs', () => {
    expect(DEFAULT_DM_RELAYS.every((relay) => relay.startsWith('wss://'))).toBe(true);
  });
});
