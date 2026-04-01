import { describe, expect, it } from 'vitest';

import { InMemoryNostrSignalAdapter } from './signal_nostr.js';
import { runTraversalBootstrapScenario } from './traversal_flow.js';
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

describe('runTraversalBootstrapScenario', () => {
  it('discovers advert, exchanges addresses, plans punch, and succeeds on permissive NATs', () => {
    const adapter = new InMemoryNostrSignalAdapter();
    adapter.publishAdvert({
      app: 'fips.nat.traversal.v1',
      eventKind: 30078,
      protocol: 'fips.nat.traversal.v1',
      publisherNpub: 'npub1server',
      publishedAt: 1_700_000_000_000,
      expiresAt: 1_700_000_060_000,
      sequence: 1,
      relays: ['wss://nip17.tomdwyer.uk'],
      stunServers: ['stun:fips.tomdwyer.uk:3478'],
      transports: ['udp'],
    });

    const result = runTraversalBootstrapScenario({
      adapter,
      nowMs: 1_700_000_000_000,
      localNpub: 'npub1client',
      remoteNpub: 'npub1server',
      localNat: 'full_cone',
      remoteNat: 'restricted_cone',
      sessionId: 'sess-1',
      offerNonce: 'offer-nonce-1',
      answerNonce: 'answer-nonce-1',
      ttlMs: 60_000,
      localObservation: observation(),
      remoteObservation: observation({
        reflexiveAddress: { ip: '198.51.100.20', port: 63000 },
        localInterfaceAddresses: ['192.168.1.20'],
      }),
      localLeadMs: 2_000,
      remoteLeadMs: 3_000,
      localIntervalMs: 250,
      remoteIntervalMs: 300,
      localDurationMs: 20_000,
      remoteDurationMs: 30_000,
      maxAttempts: 5,
    });

    expect(result.advertFound).toBe(true);
    expect(result.answerAccepted).toBe(true);
    expect(result.directEstablished).toBe(true);
    expect(result.usedFallback).toBe(false);
    expect(result.targets[0]?.strategy).toBe('lan');
    expect(result.schedule.length).toBe(5);
  });

  it('falls back when NAT pair prevents direct traversal', () => {
    const adapter = new InMemoryNostrSignalAdapter();
    adapter.publishAdvert({
      app: 'fips.nat.traversal.v1',
      eventKind: 30078,
      protocol: 'fips.nat.traversal.v1',
      publisherNpub: 'npub1server',
      publishedAt: 1_700_000_000_000,
      expiresAt: 1_700_000_060_000,
      sequence: 1,
      relays: ['wss://nip17.tomdwyer.uk'],
      stunServers: ['stun:fips.tomdwyer.uk:3478'],
      transports: ['udp'],
    });

    const result = runTraversalBootstrapScenario({
      adapter,
      nowMs: 1_700_000_000_000,
      localNpub: 'npub1client',
      remoteNpub: 'npub1server',
      localNat: 'symmetric',
      remoteNat: 'restricted_cone',
      sessionId: 'sess-1',
      offerNonce: 'offer-nonce-1',
      answerNonce: 'answer-nonce-1',
      ttlMs: 60_000,
      localObservation: observation(),
      remoteObservation: observation({
        reflexiveAddress: { ip: '198.51.100.20', port: 63000 },
        localInterfaceAddresses: ['192.168.1.20'],
      }),
      localLeadMs: 2_000,
      remoteLeadMs: 3_000,
      localIntervalMs: 250,
      remoteIntervalMs: 300,
      localDurationMs: 20_000,
      remoteDurationMs: 30_000,
      maxAttempts: 5,
    });

    expect(result.answerAccepted).toBe(true);
    expect(result.directEstablished).toBe(false);
    expect(result.usedFallback).toBe(true);
  });

  it('falls back early when the responder has no usable addresses', () => {
    const adapter = new InMemoryNostrSignalAdapter();
    adapter.publishAdvert({
      app: 'fips.nat.traversal.v1',
      eventKind: 30078,
      protocol: 'fips.nat.traversal.v1',
      publisherNpub: 'npub1server',
      publishedAt: 1_700_000_000_000,
      expiresAt: 1_700_000_060_000,
      sequence: 1,
      relays: ['wss://nip17.tomdwyer.uk'],
      stunServers: ['stun:fips.tomdwyer.uk:3478'],
      transports: ['udp'],
    });

    const result = runTraversalBootstrapScenario({
      adapter,
      nowMs: 1_700_000_000_000,
      localNpub: 'npub1client',
      remoteNpub: 'npub1server',
      localNat: 'full_cone',
      remoteNat: 'restricted_cone',
      sessionId: 'sess-1',
      offerNonce: 'offer-nonce-1',
      answerNonce: 'answer-nonce-1',
      ttlMs: 60_000,
      localObservation: observation(),
      remoteObservation: observation({
        reflexiveAddress: undefined,
        localInterfaceAddresses: [],
      }),
      localLeadMs: 2_000,
      remoteLeadMs: 3_000,
      localIntervalMs: 250,
      remoteIntervalMs: 300,
      localDurationMs: 20_000,
      remoteDurationMs: 30_000,
      maxAttempts: 5,
    });

    expect(result.answerAccepted).toBe(false);
    expect(result.directEstablished).toBe(false);
    expect(result.usedFallback).toBe(true);
    expect(result.answerReason).toBe('no-usable-addresses');
  });
});
