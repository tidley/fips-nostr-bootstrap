import { describe, expect, it } from 'vitest';
import { attemptDirectProbe } from './nat_probe.js';

describe('stun/fips probe policy sanity', () => {
  it('allows non-symmetric NAT pair', () => {
    const result = attemptDirectProbe(
      [{ host: '1.1.1.1', port: 5000, transport: 'udp', priority: 1 }],
      [{ host: '2.2.2.2', port: 6000, transport: 'udp', priority: 1 }],
      'full_cone',
      'restricted_cone',
      Date.now(),
      { intervalMs: 300, maxAttempts: 1 },
    );
    expect(result.success).toBe(true);
  });

  it('rejects symmetric NAT pair for direct path', () => {
    const result = attemptDirectProbe(
      [{ host: '1.1.1.1', port: 5000, transport: 'udp', priority: 1 }],
      [{ host: '2.2.2.2', port: 6000, transport: 'udp', priority: 1 }],
      'symmetric',
      'full_cone',
      Date.now(),
      { intervalMs: 300, maxAttempts: 2 },
    );
    expect(result.success).toBe(false);
  });
});
