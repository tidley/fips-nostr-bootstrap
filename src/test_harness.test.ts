import { describe, expect, it } from 'vitest';

import { signMessage } from './identity.js';
import { InMemoryNostrSignalAdapter } from './signal_nostr.js';
import { endpoint, runAdvertisedTraversalScenario, runLocalHandshakeScenario } from './test_harness.js';
import type { BootstrapAck, BootstrapAnnounce, ConnectConfirm } from './types.js';
import type { StunBindingObservation } from './traversal_stun.js';

function messages() {
  const base = {
    protocolVersion: '1.0' as const,
    senderIdentity: 'peer-remote',
    recipientIdentity: 'peer-local',
    sessionId: 'sid-1',
    expiry: 10000,
  };

  const announce: BootstrapAnnounce = signMessage({
    ...base,
    messageType: 'bootstrap_announce',
    monotonicTimestamp: 1,
    nonce: 'n1',
    capabilities: ['udp_direct'],
    candidateEndpoints: [endpoint('10.0.0.1', 5001, 1)],
    ephemeralHandshakeMaterial: 'aepk',
  }, 'k');

  const ack: BootstrapAck = signMessage({
    ...base,
    messageType: 'bootstrap_ack',
    monotonicTimestamp: 2,
    nonce: 'n2',
    selectedTransportMode: 'udp_direct',
    candidateEndpoints: [endpoint('10.0.0.2', 5002, 1)],
    ephemeralHandshakeMaterial: 'bepk',
    punchWindowMs: 300,
  }, 'k');

  const confirm: ConnectConfirm = signMessage({
    ...base,
    messageType: 'connect_confirm',
    monotonicTimestamp: 3,
    nonce: 'n3',
    selectedEndpoint: endpoint('10.0.0.2', 5002, 1),
    negotiatedParameters: { mode: 'direct' },
  }, 'k');

  return { announce, ack, confirm };
}

function observation(overrides: Partial<StunBindingObservation> = {}): StunBindingObservation {
  return {
    server: 'stun:fips.tomdwyer.uk:3478',
    localPort: 49152,
    reflexiveAddress: { ip: '203.0.113.10', port: 62000 },
    localInterfaceAddresses: ['192.168.1.10'],
    ...overrides,
  };
}

describe('runLocalHandshakeScenario', () => {
  it('succeeds direct on permissive NAT', () => {
    const { announce, ack, confirm } = messages();
    const r = runLocalHandshakeScenario({
      now: 10,
      localId: 'peer-local',
      remoteId: 'peer-remote',
      localNat: 'full_cone',
      remoteNat: 'restricted_cone',
      announce,
      ack,
      confirm,
    });
    expect(r.finalState).toBe('direct_established');
    expect(r.usedFallback).toBe(false);
  });

  it('falls back when symmetric NAT blocks traversal', () => {
    const { announce, ack, confirm } = messages();
    const r = runLocalHandshakeScenario({
      now: 10,
      localId: 'peer-local',
      remoteId: 'peer-remote',
      localNat: 'symmetric',
      remoteNat: 'port_restricted',
      announce,
      ack,
      confirm,
    });
    expect(r.finalState).toBe('fallback_established');
    expect(r.usedFallback).toBe(true);
  });
});

describe('runAdvertisedTraversalScenario', () => {
  it('establishes direct traversal when advert, addresses, and NAT pair are usable', () => {
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

    const result = runAdvertisedTraversalScenario({
      adapter,
      now: 1_700_000_000_000,
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
    });

    expect(result.finalState).toBe('direct_established');
    expect(result.usedFallback).toBe(false);
    expect(result.advertFound).toBe(true);
    expect(result.answerAccepted).toBe(true);
  });

  it('falls back when no advert is available', () => {
    const adapter = new InMemoryNostrSignalAdapter();

    const result = runAdvertisedTraversalScenario({
      adapter,
      now: 1_700_000_000_000,
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
    });

    expect(result.finalState).toBe('fallback_established');
    expect(result.usedFallback).toBe(true);
    expect(result.advertFound).toBe(false);
  });
});
