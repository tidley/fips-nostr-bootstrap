import { describe, expect, it } from 'vitest';

import { DEFAULT_DM_RELAYS, DEFAULT_DM_RELAYS_CSV, parseDmRelayList } from './dm_relays.js';

describe('DM relay defaults', () => {
  it('includes the preferred DM relays for the working demo profile', () => {
    expect(DEFAULT_DM_RELAYS).toContain('wss://nip17.com');
    expect(DEFAULT_DM_RELAYS).toContain('wss://offchain.pub');
  });

  it('keeps the default DM relay set intentionally small', () => {
    expect(DEFAULT_DM_RELAYS).toEqual(['wss://nip17.com', 'wss://offchain.pub']);
  });

  it('parses and de-duplicates relay lists', () => {
    expect(parseDmRelayList(` ${DEFAULT_DM_RELAYS_CSV},wss://nip17.com `)).toEqual([...DEFAULT_DM_RELAYS]);
  });

  it('uses secure websocket relay URLs', () => {
    expect(DEFAULT_DM_RELAYS.every((relay) => relay.startsWith('wss://'))).toBe(true);
  });
});
