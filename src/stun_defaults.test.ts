import { describe, expect, it } from 'vitest';

import { DEFAULT_STUN_SERVER, DEFAULT_STUN_SERVERS, parseStunServerList, parseStunUrl } from './stun_defaults.js';

describe('STUN defaults', () => {
  it('includes fips.tomdwyer.uk as the primary STUN server', () => {
    expect(DEFAULT_STUN_SERVER).toBe('stun:fips.tomdwyer.uk:3478');
    expect(DEFAULT_STUN_SERVERS).toContain('stun:fips.tomdwyer.uk:3478');
  });

  it('parses and deduplicates configured STUN server lists', () => {
    expect(parseStunServerList(`${DEFAULT_STUN_SERVERS.join(',')},stun:fips.tomdwyer.uk:3478`)).toEqual([...DEFAULT_STUN_SERVERS]);
  });

  it('parses hostname-based STUN URLs', () => {
    expect(parseStunUrl('stun:fips.tomdwyer.uk:3478')).toEqual({
      host: 'fips.tomdwyer.uk',
      port: 3478,
    });
  });
});
