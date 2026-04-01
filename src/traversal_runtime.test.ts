import { describe, expect, it } from 'vitest';

import { InMemoryNostrSignalAdapter } from './signal_nostr.js';
import {
  createAnswerForOffer,
  createOfferForPeer,
  discoverTraversalPeer,
  planPunchSession,
} from './traversal_runtime.js';
import type { StunBindingObservation } from './traversal_stun.js';

function observation(overrides: Partial<StunBindingObservation> = {}): StunBindingObservation {
  return {
    server: 'stun:fips.tomdwyer.uk:3478',
    localPort: 49152,
    reflexiveAddress: { ip: '203.0.113.10', port: 62000 },
    localInterfaceAddresses: ['192.168.1.10'],
    ...overrides,
  };
}

describe('traversal runtime orchestration', () => {
  it('discovers the freshest traversal advert for a peer', () => {
    const adapter = new InMemoryNostrSignalAdapter();
    adapter.publishAdvert({
      app: 'fips.nat.traversal.v1',
      eventKind: 30078,
      protocol: 'fips.nat.traversal.v1',
      publisherNpub: 'npub1server',
      publishedAt: 1_700_000_000_000,
      expiresAt: 1_700_000_060_000,
      sequence: 1,
      relays: ['wss://nip17.com'],
      stunServers: ['stun:fips.tomdwyer.uk:3478'],
      transports: ['udp'],
    });
    adapter.publishAdvert({
      app: 'fips.nat.traversal.v1',
      eventKind: 30078,
      protocol: 'fips.nat.traversal.v1',
      publisherNpub: 'npub1server',
      publishedAt: 1_700_000_010_000,
      expiresAt: 1_700_000_070_000,
      sequence: 2,
      relays: ['wss://nip17.tomdwyer.uk'],
      stunServers: ['stun:fips.tomdwyer.uk:3478'],
      transports: ['udp'],
    });

    const advert = discoverTraversalPeer(adapter, {
      publisherNpub: 'npub1server',
      now: 1_700_000_020_000,
    });

    expect(advert?.sequence).toBe(2);
    expect(advert?.relays).toEqual(['wss://nip17.tomdwyer.uk']);
  });

  it('builds an offer and answer from STUN observations then plans punch attempts', () => {
    const offer = createOfferForPeer({
      senderNpub: 'npub1initiator',
      recipientNpub: 'npub1responder',
      sessionId: 'sess-1',
      nonce: 'offer-nonce-1',
      issuedAt: 1_700_000_000_000,
      ttlMs: 60_000,
      observation: observation(),
    });

    const answer = createAnswerForOffer({
      offer,
      senderNpub: 'npub1responder',
      nonce: 'answer-nonce-1',
      issuedAt: 1_700_000_000_500,
      ttlMs: 60_000,
      observation: observation({
        reflexiveAddress: { ip: '198.51.100.20', port: 63000 },
        localInterfaceAddresses: ['192.168.1.20'],
      }),
    });

    const plan = planPunchSession({
      offer,
      answer,
      nowMs: 1_700_000_000_600,
      localLeadMs: 2_000,
      remoteLeadMs: 3_000,
      localIntervalMs: 250,
      remoteIntervalMs: 300,
      localDurationMs: 20_000,
      remoteDurationMs: 30_000,
      maxAttempts: 4,
    });

    expect(answer.accepted).toBe(true);
    expect(plan.targets[0].strategy).toBe('lan');
    expect(plan.window.startAtMs).toBe(1_700_000_003_600);
    expect(plan.schedule).toHaveLength(4);
  });

  it('creates a rejection answer when no usable traversal addresses are available', () => {
    const offer = createOfferForPeer({
      senderNpub: 'npub1initiator',
      recipientNpub: 'npub1responder',
      sessionId: 'sess-1',
      nonce: 'offer-nonce-1',
      issuedAt: 1_700_000_000_000,
      ttlMs: 60_000,
      observation: observation(),
    });

    const answer = createAnswerForOffer({
      offer,
      senderNpub: 'npub1responder',
      nonce: 'answer-nonce-1',
      issuedAt: 1_700_000_000_500,
      ttlMs: 60_000,
      observation: observation({
        reflexiveAddress: undefined,
        localInterfaceAddresses: [],
      }),
    });

    expect(answer.accepted).toBe(false);
    expect(answer.reason).toBe('no-usable-addresses');
  });
});
