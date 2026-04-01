import type { TraversalAddress } from './traversal_signal.js';

export interface PunchPlanInput {
  localAddresses: TraversalAddress[];
  localReflexiveAddress?: TraversalAddress;
  remoteAddresses: TraversalAddress[];
  remoteReflexiveAddress?: TraversalAddress;
}

export interface PlannedPunchTarget {
  strategy: 'lan' | 'reflexive' | 'mixed' | 'local';
  localSource: 'local' | 'reflexive';
  remoteSource: 'local' | 'reflexive';
  local: TraversalAddress;
  remote: TraversalAddress;
}

export interface NegotiatePunchWindowInput {
  nowMs: number;
  localLeadMs: number;
  remoteLeadMs: number;
  localIntervalMs: number;
  remoteIntervalMs: number;
  localDurationMs: number;
  remoteDurationMs: number;
}

export interface PunchWindow {
  startAtMs: number;
  intervalMs: number;
  durationMs: number;
}

export interface BuildPunchAttemptScheduleInput extends PunchWindow {
  maxAttempts: number;
}

function sameSubnet24(left: TraversalAddress, right: TraversalAddress): boolean {
  const leftParts = left.ip.split('.');
  const rightParts = right.ip.split('.');
  return leftParts.length === 4 && rightParts.length === 4 && leftParts.slice(0, 3).join('.') === rightParts.slice(0, 3).join('.');
}

function targetKey(target: PlannedPunchTarget): string {
  return [
    target.strategy,
    target.localSource,
    target.remoteSource,
    target.local.ip,
    target.local.port,
    target.remote.ip,
    target.remote.port,
  ].join(':');
}

function pushUnique(targets: PlannedPunchTarget[], seen: Set<string>, target: PlannedPunchTarget): void {
  const key = targetKey(target);
  if (seen.has(key)) return;
  seen.add(key);
  targets.push(target);
}

export function planPunchTargets(input: PunchPlanInput): PlannedPunchTarget[] {
  const planned: PlannedPunchTarget[] = [];
  const seen = new Set<string>();

  for (const local of input.localAddresses) {
    for (const remote of input.remoteAddresses) {
      if (sameSubnet24(local, remote)) {
        pushUnique(planned, seen, {
          strategy: 'lan',
          localSource: 'local',
          remoteSource: 'local',
          local,
          remote,
        });
      }
    }
  }

  if (input.localReflexiveAddress && input.remoteReflexiveAddress) {
    pushUnique(planned, seen, {
      strategy: 'reflexive',
      localSource: 'reflexive',
      remoteSource: 'reflexive',
      local: input.localReflexiveAddress,
      remote: input.remoteReflexiveAddress,
    });
  }

  if (input.remoteReflexiveAddress) {
    for (const local of input.localAddresses) {
      pushUnique(planned, seen, {
        strategy: 'mixed',
        localSource: 'local',
        remoteSource: 'reflexive',
        local,
        remote: input.remoteReflexiveAddress,
      });
    }
  }

  if (input.localReflexiveAddress) {
    for (const remote of input.remoteAddresses) {
      pushUnique(planned, seen, {
        strategy: 'mixed',
        localSource: 'reflexive',
        remoteSource: 'local',
        local: input.localReflexiveAddress,
        remote,
      });
    }
  }

  for (const local of input.localAddresses) {
    for (const remote of input.remoteAddresses) {
      pushUnique(planned, seen, {
        strategy: 'local',
        localSource: 'local',
        remoteSource: 'local',
        local,
        remote,
      });
    }
  }

  return planned;
}

export function negotiatePunchWindow(input: NegotiatePunchWindowInput): PunchWindow {
  return {
    startAtMs: input.nowMs + Math.max(0, input.localLeadMs, input.remoteLeadMs),
    intervalMs: Math.max(20, input.localIntervalMs, input.remoteIntervalMs),
    durationMs: Math.max(input.localDurationMs, input.remoteDurationMs),
  };
}

export function buildPunchAttemptSchedule(input: BuildPunchAttemptScheduleInput): number[] {
  const attempts: number[] = [];
  const maxAttempts = Math.max(1, input.maxAttempts);
  const intervalMs = Math.max(1, input.intervalMs);
  const cutoff = input.startAtMs + Math.max(1, input.durationMs);

  let at = input.startAtMs;
  while (attempts.length < maxAttempts && (attempts.length === 0 || at < cutoff)) {
    attempts.push(at);
    at += intervalMs;
  }

  return attempts;
}
