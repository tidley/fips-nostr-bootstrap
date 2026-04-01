import { describe, expect, it } from 'vitest';

import type { TraversalAdvert } from './traversal_advert.js';
import { InMemoryTraversalAdvertDirectory } from './traversal_directory.js';

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

describe('InMemoryTraversalAdvertDirectory', () => {
  it('stores and queries valid adverts by publisher', () => {
    const directory = new InMemoryTraversalAdvertDirectory();
    const stored = advert();

    directory.publish(stored);

    expect(
      directory.query({
        publisherNpub: 'npub1server',
        protocol: 'fips.nat.traversal.v1',
        now: 1_700_000_001_000,
      }),
    ).toEqual([stored]);
  });

  it('replaces an older advert from the same publisher and protocol', () => {
    const directory = new InMemoryTraversalAdvertDirectory();
    const older = advert({ sequence: 1, publishedAt: 1_700_000_000_000 });
    const newer = advert({ sequence: 2, publishedAt: 1_700_000_010_000, expiresAt: 1_700_000_070_000 });

    directory.publish(older);
    directory.publish(newer);

    expect(
      directory.query({
        publisherNpub: 'npub1server',
        protocol: 'fips.nat.traversal.v1',
        now: 1_700_000_011_000,
      }),
    ).toEqual([newer]);
  });

  it('does not replace a newer advert with an older one', () => {
    const directory = new InMemoryTraversalAdvertDirectory();
    const newer = advert({ sequence: 3, publishedAt: 1_700_000_020_000, expiresAt: 1_700_000_080_000 });
    const older = advert({ sequence: 2, publishedAt: 1_700_000_010_000, expiresAt: 1_700_000_070_000 });

    directory.publish(newer);
    directory.publish(older);

    expect(
      directory.query({
        publisherNpub: 'npub1server',
        protocol: 'fips.nat.traversal.v1',
        now: 1_700_000_021_000,
      }),
    ).toEqual([newer]);
  });

  it('filters expired adverts and protocol mismatches during query', () => {
    const directory = new InMemoryTraversalAdvertDirectory();
    const valid = advert({ publisherNpub: 'npub1server', protocol: 'fips.nat.traversal.v1' });
    const expired = advert({
      publisherNpub: 'npub1expired',
      sequence: 2,
      publishedAt: 1_700_000_050_000,
      expiresAt: 1_700_000_050_100,
    });
    const wrongProtocol = advert({
      publisherNpub: 'npub1server',
      protocol: 'fips.nat.traversal.v2',
      sequence: 1,
    });

    directory.publish(valid);
    directory.publish(expired);
    directory.publish(wrongProtocol);

    expect(
      directory.query({
        publisherNpub: 'npub1server',
        protocol: 'fips.nat.traversal.v1',
        now: 1_700_000_051_000,
      }),
    ).toEqual([valid]);
  });
});
