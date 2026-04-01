import { describe, expect, it } from 'vitest';

import {
  isTraversalAdvert,
  selectTraversalAdvert,
  validateTraversalAdvert,
  type TraversalAdvert,
} from './traversal_advert.js';

function advert(overrides: Partial<TraversalAdvert> = {}): TraversalAdvert {
  return {
    app: 'fips.nat.traversal.v1',
    eventKind: 30078,
    protocol: 'fips.nat.traversal.v1',
    publisherNpub: 'npub1server',
    publishedAt: 1_700_000_000_000,
    expiresAt: 1_700_000_060_000,
    sequence: 1,
    relays: ['wss://relay.example'],
    stunServers: ['stun:stun.example:3478'],
    transports: ['udp'],
    ...overrides,
  };
}

describe('traversal advertisement', () => {
  it('accepts a valid traversal advert', () => {
    const msg = advert();

    expect(isTraversalAdvert(msg)).toBe(true);
    expect(validateTraversalAdvert(msg, msg.publishedAt + 5_000)).toEqual({ ok: true });
  });

  it('rejects stale adverts', () => {
    const msg = advert({ expiresAt: 1_700_000_001_000 });

    expect(validateTraversalAdvert(msg, 1_700_000_002_000)).toEqual({
      ok: false,
      reason: 'expired-advert',
    });
  });

  it('rejects adverts with unsupported protocol', () => {
    const msg = advert({ protocol: 'fips.nat.traversal.v0' as TraversalAdvert['protocol'] });

    expect(validateTraversalAdvert(msg, msg.publishedAt + 1)).toEqual({
      ok: false,
      reason: 'unsupported-protocol',
    });
  });

  it('selects the freshest compatible advert for a peer', () => {
    const selected = selectTraversalAdvert(
      [
        advert({ publisherNpub: 'npub1other', publishedAt: 1_700_000_001_000, sequence: 9 }),
        advert({ publishedAt: 1_700_000_001_000, sequence: 1 }),
        advert({ publishedAt: 1_700_000_002_000, sequence: 2 }),
        advert({ publishedAt: 1_700_000_003_000, expiresAt: 1_700_000_003_001 }),
        advert({
          publishedAt: 1_700_000_004_000,
          sequence: 3,
          protocol: 'fips.nat.traversal.v0' as TraversalAdvert['protocol'],
        }),
      ],
      {
        publisherNpub: 'npub1server',
        protocol: 'fips.nat.traversal.v1',
        now: 1_700_000_003_500,
      },
    );

    expect(selected).toBeDefined();
    expect(selected?.publisherNpub).toBe('npub1server');
    expect(selected?.protocol).toBe('fips.nat.traversal.v1');
    expect(selected?.publishedAt).toBe(1_700_000_002_000);
    expect(selected?.sequence).toBe(2);
  });
});
