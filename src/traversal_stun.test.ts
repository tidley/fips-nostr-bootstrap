import { describe, expect, it } from 'vitest';

import { deriveTraversalAddresses, type StunBindingObservation } from './traversal_stun.js';

function observation(overrides: Partial<StunBindingObservation> = {}): StunBindingObservation {
  return {
    server: 'stun:fips.tomdwyer.uk:3478',
    localPort: 49152,
    reflexiveAddress: { ip: '203.0.113.10', port: 62000 },
    localInterfaceAddresses: ['192.168.1.10', '10.0.0.20'],
    ...overrides,
  };
}

describe('deriveTraversalAddresses', () => {
  it('derives reflexive and local addresses from a successful STUN observation', () => {
    const result = deriveTraversalAddresses(observation());

    expect(result.reflexiveAddress).toEqual({
      protocol: 'udp',
      ip: '203.0.113.10',
      port: 62000,
    });
    expect(result.localAddresses).toEqual([
      { protocol: 'udp', ip: '192.168.1.10', port: 49152 },
      { protocol: 'udp', ip: '10.0.0.20', port: 49152 },
    ]);
    expect(result.stunServer).toBe('stun:fips.tomdwyer.uk:3478');
    expect(result.hasUsableStun).toBe(true);
  });

  it('deduplicates local interface addresses and drops the reflexive duplicate', () => {
    const result = deriveTraversalAddresses(
      observation({
        reflexiveAddress: { ip: '192.168.1.10', port: 49152 },
        localInterfaceAddresses: ['192.168.1.10', '192.168.1.10', '10.0.0.20'],
      }),
    );

    expect(result.reflexiveAddress).toEqual({
      protocol: 'udp',
      ip: '192.168.1.10',
      port: 49152,
    });
    expect(result.localAddresses).toEqual([{ protocol: 'udp', ip: '10.0.0.20', port: 49152 }]);
  });

  it('keeps local addresses available when STUN is unavailable', () => {
    const result = deriveTraversalAddresses(
      observation({
        reflexiveAddress: undefined,
        localInterfaceAddresses: ['192.168.1.10'],
      }),
    );

    expect(result.reflexiveAddress).toBeUndefined();
    expect(result.localAddresses).toEqual([{ protocol: 'udp', ip: '192.168.1.10', port: 49152 }]);
    expect(result.hasUsableStun).toBe(false);
  });

  it('returns no local addresses when no interface addresses are available', () => {
    const result = deriveTraversalAddresses(
      observation({
        localInterfaceAddresses: [],
      }),
    );

    expect(result.localAddresses).toEqual([]);
  });
});
