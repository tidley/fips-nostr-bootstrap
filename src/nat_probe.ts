import type { EndpointHint } from './types.js';

export type NatType = 'open' | 'full_cone' | 'restricted_cone' | 'port_restricted' | 'symmetric';

export interface ProbeAttempt {
  from: EndpointHint;
  to: EndpointHint;
  at: number;
}

export interface ProbeResult {
  success: boolean;
  matched?: { local: EndpointHint; remote: EndpointHint };
  attempts: number;
}

export interface ProbePlan {
  intervalMs: number;
  maxAttempts: number;
}

export function attemptDirectProbe(
  localCandidates: EndpointHint[],
  remoteCandidates: EndpointHint[],
  localNat: NatType,
  remoteNat: NatType,
  now: number,
  plan: ProbePlan,
): ProbeResult {
  const maxAttempts = Math.max(1, plan.maxAttempts);
  let attempts = 0;

  for (let i = 0; i < maxAttempts; i++) {
    for (const local of localCandidates) {
      for (const remote of remoteCandidates) {
        attempts += 1;
        if (isPairReachable(local, remote, localNat, remoteNat)) {
          return { success: true, matched: { local, remote }, attempts };
        }
      }
    }
  }

  return { success: false, attempts };
}

function isPairReachable(
  local: EndpointHint,
  remote: EndpointHint,
  localNat: NatType,
  remoteNat: NatType,
): boolean {
  if (local.transport !== 'udp' || remote.transport !== 'udp') return false;
  if (localNat === 'symmetric' || remoteNat === 'symmetric') return false;
  if (localNat === 'port_restricted' && remoteNat === 'port_restricted') return false;
  return true;
}
