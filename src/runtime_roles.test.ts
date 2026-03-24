import { describe, expect, it } from 'vitest';
import { parseRuntimeRole, startupPlanForRole, validateConfigForRole } from './runtime_roles.js';

describe('runtime role parsing/validation', () => {
  it('defaults to all when role missing', () => {
    expect(parseRuntimeRole(undefined)).toBe('all');
  });

  it('rejects unknown role', () => {
    expect(() => parseRuntimeRole('weird')).toThrow(/invalid-role/);
  });

  it('validates fips-only role with fips config', () => {
    const result = validateConfigForRole({ role: 'fips', fipsUdpPort: 9999 });
    expect(result.ok).toBe(true);
    expect(result.enabledRoles).toEqual(['fips']);
  });

  it('fails relay role when relay urls missing', () => {
    const result = validateConfigForRole({ role: 'relay' });
    expect(result.ok).toBe(false);
    expect(result.errors).toContain('missing-or-invalid:relayUrls');
  });

  it('builds startup plan for all role', () => {
    const plan = startupPlanForRole({
      role: 'all',
      fipsUdpPort: 9999,
      relayUrls: ['wss://nos.lol'],
      stunPort: 3478,
    });

    expect(plan).toEqual({ fips: true, relay: true, stun: true });
  });
});
