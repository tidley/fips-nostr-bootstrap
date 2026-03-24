import { describe, expect, it } from 'vitest';
import { startupPlanForRole, type RuntimeRole } from './runtime_roles.js';

describe('integration: role startup matrix', () => {
  const baseConfig = {
    fipsUdpPort: 9999,
    relayUrls: ['wss://nos.lol'],
    stunPort: 3478,
  };

  const cases: Array<{ role: RuntimeRole; expected: { fips: boolean; relay: boolean; stun: boolean } }> = [
    { role: 'fips', expected: { fips: true, relay: false, stun: false } },
    { role: 'relay', expected: { fips: false, relay: true, stun: false } },
    { role: 'stun', expected: { fips: false, relay: false, stun: true } },
    { role: 'all', expected: { fips: true, relay: true, stun: true } },
  ];

  for (const testCase of cases) {
    it(`starts expected services for role=${testCase.role}`, () => {
      const plan = startupPlanForRole({ role: testCase.role, ...baseConfig });
      expect(plan).toEqual(testCase.expected);
    });
  }

  it('fails fast for all role when required role config is missing', () => {
    expect(() =>
      startupPlanForRole({
        role: 'all',
        fipsUdpPort: 9999,
        relayUrls: ['wss://nos.lol'],
        // stunPort intentionally missing
      }),
    ).toThrow(/runtime-config-invalid:missing-or-invalid:stunPort/);
  });

  it('allows relay role even when other role-specific fields are absent', () => {
    const plan = startupPlanForRole({ role: 'relay', relayUrls: ['wss://nos.lol'] });
    expect(plan).toEqual({ fips: false, relay: true, stun: false });
  });
});
