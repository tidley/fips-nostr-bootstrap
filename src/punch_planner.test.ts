import { describe, expect, it } from 'vitest';

import {
  buildPunchAttemptSchedule,
  negotiatePunchWindow,
  planPunchTargets,
  type PunchPlanInput,
} from './punch_planner.js';

function addr(ip: string, port: number) {
  return { protocol: 'udp' as const, ip, port };
}

function input(overrides: Partial<PunchPlanInput> = {}): PunchPlanInput {
  return {
    localAddresses: [addr('192.168.1.10', 50000)],
    localReflexiveAddress: addr('203.0.113.10', 62000),
    remoteAddresses: [addr('192.168.1.20', 50001)],
    remoteReflexiveAddress: addr('198.51.100.20', 63000),
    ...overrides,
  };
}

describe('planPunchTargets', () => {
  it('prefers same-subnet local targets before reflexive fallback', () => {
    const planned = planPunchTargets(input());

    expect(planned[0]).toMatchObject({
      strategy: 'lan',
      localSource: 'local',
      remoteSource: 'local',
      local: { ip: '192.168.1.10' },
      remote: { ip: '192.168.1.20' },
    });
    expect(planned[1]).toMatchObject({
      strategy: 'reflexive',
      localSource: 'reflexive',
      remoteSource: 'reflexive',
    });
  });

  it('prefers reflexive to reflexive when no LAN pair exists', () => {
    const planned = planPunchTargets(
      input({
        remoteAddresses: [addr('10.20.30.40', 50001)],
      }),
    );

    expect(planned[0]).toMatchObject({
      strategy: 'reflexive',
      localSource: 'reflexive',
      remoteSource: 'reflexive',
    });
  });

  it('falls back to mixed local/reflexive combinations when needed', () => {
    const planned = planPunchTargets(
      input({
        localReflexiveAddress: undefined,
      }),
    );

    expect(planned[0]).toMatchObject({
      strategy: 'lan',
      localSource: 'local',
      remoteSource: 'local',
    });
    expect(planned.some((target) => target.strategy === 'mixed')).toBe(true);
  });
});

describe('negotiatePunchWindow', () => {
  it('uses the larger lead time and conservative interval/duration', () => {
    expect(
      negotiatePunchWindow({
        nowMs: 1_700_000_000_000,
        localLeadMs: 2_000,
        remoteLeadMs: 3_500,
        localIntervalMs: 250,
        remoteIntervalMs: 300,
        localDurationMs: 20_000,
        remoteDurationMs: 30_000,
      }),
    ).toEqual({
      startAtMs: 1_700_000_003_500,
      intervalMs: 300,
      durationMs: 30_000,
    });
  });
});

describe('buildPunchAttemptSchedule', () => {
  it('builds a bounded retry cadence within the negotiated window', () => {
    expect(
      buildPunchAttemptSchedule({
        startAtMs: 1_700_000_003_500,
        intervalMs: 300,
        durationMs: 1_200,
        maxAttempts: 10,
      }),
    ).toEqual([1_700_000_003_500, 1_700_000_003_800, 1_700_000_004_100, 1_700_000_004_400]);
  });

  it('honors maxAttempts when the duration would allow more sends', () => {
    expect(
      buildPunchAttemptSchedule({
        startAtMs: 1_700_000_003_500,
        intervalMs: 300,
        durationMs: 5_000,
        maxAttempts: 3,
      }),
    ).toEqual([1_700_000_003_500, 1_700_000_003_800, 1_700_000_004_100]);
  });
});
