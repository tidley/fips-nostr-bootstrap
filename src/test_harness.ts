import { chooseFallback } from './fallback.js';
import { HandshakeMachine } from './handshake.js';
import { MetricsStore } from './metrics.js';
import { attemptDirectProbe, type NatType } from './nat_probe.js';
import { SessionStore } from './session.js';
import type { BootstrapAck, BootstrapAnnounce, ConnectConfirm, EndpointHint, HandshakeState } from './types.js';

export interface HarnessRun {
  finalState: HandshakeState;
  usedFallback: boolean;
  probes: number;
}

export function runLocalHandshakeScenario(params: {
  now: number;
  localId: string;
  remoteId: string;
  localNat: NatType;
  remoteNat: NatType;
  announce: BootstrapAnnounce;
  ack: BootstrapAck;
  confirm: ConnectConfirm;
}): HarnessRun {
  const metrics = new MetricsStore();
  const session = new SessionStore();
  const machine = new HandshakeMachine({
    identity: params.localId,
    ackTimeoutMs: 1500,
    probeTimeoutMs: 1500,
    maxMonotonicSkewMs: 5,
  });

  metrics.inc('handshakes');
  machine.apply(params.announce, params.now);
  machine.apply(params.ack, params.now + 1);

  // enter probing
  machine.apply({
    ...params.confirm,
    messageType: 'connect_probe',
    monotonicTimestamp: params.confirm.monotonicTimestamp - 1,
    nonce: `${params.confirm.nonce}-probe`,
    endpoint: params.confirm.selectedEndpoint,
    probeIndex: 1,
  }, params.now + 2);

  const probe = attemptDirectProbe(
    params.announce.candidateEndpoints,
    params.ack.candidateEndpoints,
    params.localNat,
    params.remoteNat,
    params.now + 3,
    { intervalMs: 60, maxAttempts: 5 },
  );

  if (probe.success) {
    machine.apply(params.confirm, params.now + 4);
    if (machine.getSessionBinding()) session.establish(machine.getSessionBinding()!);
    metrics.inc('directSuccess');
    metrics.pushProbesPerSuccess(probe.attempts);
  } else {
    machine.onTimeout(params.now + 4000);
    const fallback = chooseFallback(true, 'direct-failed');
    if (fallback.mode === 'relay_assisted') {
      machine.apply({
        ...params.ack,
        nonce: `${params.ack.nonce}-fallback`,
        monotonicTimestamp: params.ack.monotonicTimestamp + 100,
      }, params.now + 5000);
      metrics.inc('fallbackSuccess');
    } else {
      metrics.inc('failed');
    }
  }

  return {
    finalState: machine.getState(),
    usedFallback: machine.getState() === 'fallback_established',
    probes: probe.attempts,
  };
}

export function endpoint(host: string, port: number, priority: number): EndpointHint {
  return { host, port, transport: 'udp', priority };
}
