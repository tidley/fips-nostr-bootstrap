import { describe, expect, it } from 'vitest';

import { signMessage } from './identity.js';
import { runDemo } from './demoEngine.js';
import type { BootstrapAck, BootstrapAnnounce, ConnectConfirm, ConnectProbe } from './types.js';

const base = {
  protocolVersion: '1.0' as const,
  senderIdentity: 'peer-remote',
  recipientIdentity: 'local-demo',
  sessionId: 's1',
  expiry: 1000,
};

function mkHappy() {
  const a: BootstrapAnnounce = signMessage({ ...base, messageType: 'bootstrap_announce', monotonicTimestamp: 1, nonce: 'a', capabilities: ['udp_direct'], candidateEndpoints: [{ host: '10.0.0.1', port: 1001, transport: 'udp', priority: 1 }], ephemeralHandshakeMaterial: 'aepk' }, 'k');
  const b: BootstrapAck = signMessage({ ...base, messageType: 'bootstrap_ack', monotonicTimestamp: 2, nonce: 'b', selectedTransportMode: 'udp_direct', candidateEndpoints: [{ host: '10.0.0.2', port: 1002, transport: 'udp', priority: 1 }], ephemeralHandshakeMaterial: 'bepk', punchWindowMs: 300 }, 'k');
  const p: ConnectProbe = signMessage({ ...base, messageType: 'connect_probe', monotonicTimestamp: 3, nonce: 'c', endpoint: { host: '10.0.0.2', port: 1002, transport: 'udp', priority: 1 }, probeIndex: 1 }, 'k');
  const c: ConnectConfirm = signMessage({ ...base, messageType: 'connect_confirm', monotonicTimestamp: 4, nonce: 'd', selectedEndpoint: { host: '10.0.0.2', port: 1002, transport: 'udp', priority: 1 }, negotiatedParameters: { mode: 'direct' } }, 'k');
  return [a, b, p, c];
}

describe('runDemo', () => {
  it('returns success on happy path', () => {
    const out = runDemo(mkHappy(), 10);
    expect(out.success).toBe(true);
    expect(out.finalState).toBe('direct_established');
  });

  it('fails when starting out of order', () => {
    const [_, ack] = mkHappy();
    const out = runDemo([ack], 10);
    expect(out.success).toBe(false);
  });
});
