import { describe, expect, it } from 'vitest';

import { signMessage } from './identity.js';
import { endpoint, runLocalHandshakeScenario } from './test_harness.js';
import type { BootstrapAck, BootstrapAnnounce, ConnectConfirm } from './types.js';

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
