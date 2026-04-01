import { describe, expect, it } from 'vitest';

import { signMessage } from './identity.js';
import { InMemoryNostrSignalAdapter } from './signal_nostr.js';
import type { BootstrapAnnounce } from './types.js';
import type { TraversalAdvert } from './traversal_advert.js';

function privateMessage(overrides: Partial<BootstrapAnnounce> = {}): BootstrapAnnounce {
  return signMessage<BootstrapAnnounce>(
    {
      protocolVersion: '1.0',
      messageType: 'bootstrap_announce',
      senderIdentity: 'peer-a',
      recipientIdentity: 'peer-b',
      sessionId: 'sid-1',
      monotonicTimestamp: 10,
      expiry: 100,
      nonce: 'n-1',
      capabilities: ['udp_direct'],
      candidateEndpoints: [{ host: '10.0.0.1', port: 9991, transport: 'udp', priority: 1 }],
      ephemeralHandshakeMaterial: 'epk',
      ...overrides,
    },
    'k-test',
  );
}

function advert(overrides: Partial<TraversalAdvert> = {}): TraversalAdvert {
  return {
    app: 'fips.nat.traversal.v1',
    eventKind: 30078,
    protocol: 'fips.nat.traversal.v1',
    publisherNpub: 'npub1server',
    publishedAt: 1_700_000_000_000,
    expiresAt: 1_700_000_060_000,
    sequence: 1,
    relays: ['wss://nip17.com', 'wss://nip17.tomdwyer.uk'],
    stunServers: ['stun:stun.example:3478'],
    transports: ['udp'],
    ...overrides,
  };
}

describe('InMemoryNostrSignalAdapter', () => {
  it('preserves ordered delivery for private messages', () => {
    const adapter = new InMemoryNostrSignalAdapter();
    const newer = privateMessage({ monotonicTimestamp: 20, nonce: 'n-2' });
    const older = privateMessage({ monotonicTimestamp: 10, nonce: 'n-1' });

    adapter.publish(newer);
    adapter.publish(older);

    expect(adapter.pull('peer-b').map((msg) => msg.nonce)).toEqual(['n-1', 'n-2']);
    expect(adapter.pull('peer-b')).toEqual([]);
  });

  it('stores and queries public traversal adverts separately from private messages', () => {
    const adapter = new InMemoryNostrSignalAdapter();
    const msg = privateMessage();
    const publishedAdvert = advert();

    adapter.publish(msg);
    adapter.publishAdvert(publishedAdvert);

    expect(
      adapter.queryAdverts({
        publisherNpub: 'npub1server',
        protocol: 'fips.nat.traversal.v1',
        now: 1_700_000_001_000,
      }),
    ).toEqual([publishedAdvert]);
    expect(adapter.pull('peer-b')).toEqual([msg]);
  });

  it('replaces older adverts while leaving unrelated publishers intact', () => {
    const adapter = new InMemoryNostrSignalAdapter();
    const older = advert({ sequence: 1, publishedAt: 1_700_000_000_000 });
    const newer = advert({ sequence: 2, publishedAt: 1_700_000_010_000, expiresAt: 1_700_000_070_000 });
    const other = advert({ publisherNpub: 'npub1other', sequence: 1 });

    adapter.publishAdvert(older);
    adapter.publishAdvert(newer);
    adapter.publishAdvert(other);

    expect(
      adapter.queryAdverts({
        protocol: 'fips.nat.traversal.v1',
        now: 1_700_000_020_000,
      }),
    ).toEqual([newer, other]);
  });
});
