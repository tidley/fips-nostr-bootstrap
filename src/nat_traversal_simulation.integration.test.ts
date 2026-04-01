import { describe, expect, it } from 'vitest';
import { InMemoryNostrSignalAdapter } from './signal_nostr.js';
import { runTraversalBootstrapScenario } from './traversal_flow.js';
import type { StunBindingObservation } from './traversal_stun.js';

function publishAdvert(adapter: InMemoryNostrSignalAdapter, publisherNpub: string) {
  adapter.publishAdvert({
    app: 'fips.nat.traversal.v1',
    eventKind: 30078,
    protocol: 'fips.nat.traversal.v1',
    publisherNpub,
    publishedAt: 1_700_000_000_000,
    expiresAt: 1_700_000_060_000,
    sequence: 1,
    relays: ['wss://nip17.com'],
    stunServers: ['stun:fips.tomdwyer.uk:3478'],
    transports: ['udp'],
  });
}

function observation(ip: string, localIp: string): StunBindingObservation {
  return {
    server: 'stun:fips.tomdwyer.uk:3478',
    localPort: 49152,
    reflexiveAddress: { ip, port: 62000 },
    localInterfaceAddresses: [localIp],
  };
}

describe('nat traversal simulation integration', () => {
  it('prefers LAN candidates when both peers share a subnet', () => {
    const adapter = new InMemoryNostrSignalAdapter();
    publishAdvert(adapter, 'npub1server');

    const result = runTraversalBootstrapScenario({
      adapter,
      nowMs: 1_700_000_000_000,
      localNpub: 'npub1client',
      remoteNpub: 'npub1server',
      localNat: 'restricted_cone',
      remoteNat: 'restricted_cone',
      sessionId: 'sess-lan',
      offerNonce: 'offer-lan',
      answerNonce: 'answer-lan',
      ttlMs: 60_000,
      localObservation: observation('203.0.113.10', '192.168.1.10'),
      remoteObservation: observation('198.51.100.20', '192.168.1.20'),
      localLeadMs: 1_000,
      remoteLeadMs: 1_000,
      localIntervalMs: 200,
      remoteIntervalMs: 200,
      localDurationMs: 10_000,
      remoteDurationMs: 10_000,
      maxAttempts: 4,
    });

    expect(result.directEstablished).toBe(true);
    expect(result.targets[0]?.strategy).toBe('lan');
  });

  it('fails cleanly when both sides are symmetric NAT and falls back', () => {
    const adapter = new InMemoryNostrSignalAdapter();
    publishAdvert(adapter, 'npub1server');

    const result = runTraversalBootstrapScenario({
      adapter,
      nowMs: 1_700_000_000_000,
      localNpub: 'npub1client',
      remoteNpub: 'npub1server',
      localNat: 'symmetric',
      remoteNat: 'symmetric',
      sessionId: 'sess-symmetric',
      offerNonce: 'offer-symmetric',
      answerNonce: 'answer-symmetric',
      ttlMs: 60_000,
      localObservation: observation('203.0.113.10', '192.168.1.10'),
      remoteObservation: observation('198.51.100.20', '192.168.1.20'),
      localLeadMs: 1_000,
      remoteLeadMs: 1_000,
      localIntervalMs: 200,
      remoteIntervalMs: 200,
      localDurationMs: 10_000,
      remoteDurationMs: 10_000,
      maxAttempts: 4,
    });

    expect(result.answerAccepted).toBe(true);
    expect(result.directEstablished).toBe(false);
    expect(result.usedFallback).toBe(true);
  });
});
