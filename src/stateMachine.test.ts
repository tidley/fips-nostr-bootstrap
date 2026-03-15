import { describe, expect, it } from 'vitest';

import { signMessage } from './identity.js';
import { HandshakeMachine } from './handshake.js';
import type { BootstrapAck, BootstrapAnnounce, ConnectConfirm, ConnectProbe, RetryHint } from './types.js';

const key = 'test';

const base = {
  protocolVersion: '1.0' as const,
  senderIdentity: 'peer-remote',
  recipientIdentity: 'peer-local',
  sessionId: 'sid-1',
  expiry: 999999,
};

function announce(ts: number, nonce: string): BootstrapAnnounce {
  return signMessage({ ...base, messageType: 'bootstrap_announce', monotonicTimestamp: ts, nonce, capabilities: ['udp_direct'], candidateEndpoints: [{ host: '1.1.1.1', port: 1111, transport: 'udp', priority: 1 }], ephemeralHandshakeMaterial: 'aepk' }, key);
}
function ack(ts: number, nonce: string): BootstrapAck {
  return signMessage({ ...base, messageType: 'bootstrap_ack', monotonicTimestamp: ts, nonce, selectedTransportMode: 'udp_direct', candidateEndpoints: [{ host: '2.2.2.2', port: 2222, transport: 'udp', priority: 1 }], ephemeralHandshakeMaterial: 'bepk', punchWindowMs: 600 }, key);
}
function probe(ts: number, nonce: string): ConnectProbe {
  return signMessage({ ...base, messageType: 'connect_probe', monotonicTimestamp: ts, nonce, endpoint: { host: '2.2.2.2', port: 2222, transport: 'udp', priority: 1 }, probeIndex: 1 }, key);
}
function confirm(ts: number, nonce: string): ConnectConfirm {
  return signMessage({ ...base, messageType: 'connect_confirm', monotonicTimestamp: ts, nonce, selectedEndpoint: { host: '2.2.2.2', port: 2222, transport: 'udp', priority: 1 }, negotiatedParameters: { cipher: 'x25519+chacha20' } }, key);
}
function retry(ts: number, nonce: string): RetryHint {
  return signMessage({ ...base, messageType: 'retry_hint', monotonicTimestamp: ts, nonce, retryAfterMs: 200, preferredCandidateOrder: ['udp_direct'] }, key);
}

describe('HandshakeMachine', () => {
  it('follows deterministic happy path to direct_established', () => {
    const m = new HandshakeMachine({ identity: 'peer-local', ackTimeoutMs: 1000, probeTimeoutMs: 1000, maxMonotonicSkewMs: 0 });
    expect(m.apply(announce(1, 'n1'), 1).state).toBe('awaiting_ack');
    expect(m.apply(ack(2, 'n2'), 2).state).toBe('acknowledged');
    expect(m.apply(probe(3, 'n3'), 3).state).toBe('probing');
    expect(m.apply(confirm(4, 'n4'), 4).state).toBe('direct_established');
  });

  it('rejects replay nonce', () => {
    const m = new HandshakeMachine({ identity: 'peer-local', ackTimeoutMs: 1000, probeTimeoutMs: 1000, maxMonotonicSkewMs: 0 });
    m.apply(announce(1, 'n1'), 1);
    const r = m.apply(announce(2, 'n1'), 2);
    expect(r.accepted).toBe(false);
    expect(r.reason).toBe('replay-nonce');
  });

  it('handles delayed ack via timeout -> fallback_pending', () => {
    const m = new HandshakeMachine({ identity: 'peer-local', ackTimeoutMs: 10, probeTimeoutMs: 1000, maxMonotonicSkewMs: 0 });
    m.apply(announce(1, 'n1'), 1);
    expect(m.onTimeout(50).state).toBe('fallback_pending');
    expect(m.apply(retry(60, 'n2'), 60).state).toBe('announced');
  });

  it('rejects out-of-order monotonic timestamps', () => {
    const m = new HandshakeMachine({ identity: 'peer-local', ackTimeoutMs: 1000, probeTimeoutMs: 1000, maxMonotonicSkewMs: 0 });
    m.apply(announce(5, 'n1'), 1);
    const r = m.apply(ack(4, 'n2'), 2);
    expect(r.accepted).toBe(false);
    expect(r.reason).toBe('non-monotonic-timestamp');
  });
});
