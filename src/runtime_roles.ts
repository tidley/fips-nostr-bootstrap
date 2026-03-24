export type RuntimeRole = 'fips' | 'relay' | 'stun' | 'all';

export interface RuntimeRoleConfig {
  role: RuntimeRole;
  fipsUdpPort?: number;
  relayUrls?: string[];
  stunPort?: number;
}

export interface RuntimeValidationResult {
  ok: boolean;
  errors: string[];
  enabledRoles: Array<Exclude<RuntimeRole, 'all'>>;
}

const VALID_ROLES: RuntimeRole[] = ['fips', 'relay', 'stun', 'all'];

export function parseRuntimeRole(value: string | undefined): RuntimeRole {
  const role = (value ?? 'all').trim().toLowerCase();
  if (VALID_ROLES.includes(role as RuntimeRole)) return role as RuntimeRole;
  throw new Error(`invalid-role:${value}`);
}

export function enabledRolesFor(role: RuntimeRole): Array<Exclude<RuntimeRole, 'all'>> {
  if (role === 'all') return ['fips', 'relay', 'stun'];
  return [role];
}

function isValidPort(port: number | undefined): boolean {
  return Number.isInteger(port) && (port as number) > 0 && (port as number) <= 65535;
}

function hasRelayUrls(urls: string[] | undefined): boolean {
  return Array.isArray(urls) && urls.length > 0 && urls.every((u) => typeof u === 'string' && u.length > 0);
}

export function validateConfigForRole(config: RuntimeRoleConfig): RuntimeValidationResult {
  const enabled = enabledRolesFor(config.role);
  const errors: string[] = [];

  if (enabled.includes('fips') && !isValidPort(config.fipsUdpPort)) {
    errors.push('missing-or-invalid:fipsUdpPort');
  }

  if (enabled.includes('relay') && !hasRelayUrls(config.relayUrls)) {
    errors.push('missing-or-invalid:relayUrls');
  }

  if (enabled.includes('stun') && !isValidPort(config.stunPort)) {
    errors.push('missing-or-invalid:stunPort');
  }

  return {
    ok: errors.length === 0,
    errors,
    enabledRoles: enabled,
  };
}

export interface RuntimeStartupPlan {
  fips: boolean;
  relay: boolean;
  stun: boolean;
}

export function startupPlanForRole(config: RuntimeRoleConfig): RuntimeStartupPlan {
  const validation = validateConfigForRole(config);
  if (!validation.ok) {
    throw new Error(`runtime-config-invalid:${validation.errors.join(',')}`);
  }

  const enabled = new Set(validation.enabledRoles);
  return {
    fips: enabled.has('fips'),
    relay: enabled.has('relay'),
    stun: enabled.has('stun'),
  };
}
