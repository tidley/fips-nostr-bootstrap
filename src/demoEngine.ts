import { HandshakeMachine } from './handshake.js';
import type { HandshakeState, SignalMessage } from './types.js';

export interface DemoStepResult {
  index: number;
  type: SignalMessage['messageType'];
  accepted: boolean;
  state: HandshakeState;
  reason?: string;
}

export interface DemoRunResult {
  finalState: HandshakeState;
  success: boolean;
  steps: DemoStepResult[];
}

export function runDemo(messages: SignalMessage[], now: number): DemoRunResult {
  const machine = new HandshakeMachine({
    identity: 'local-demo',
    ackTimeoutMs: 1000,
    probeTimeoutMs: 1000,
    maxMonotonicSkewMs: 5,
  });
  const steps: DemoStepResult[] = [];

  messages.forEach((m, i) => {
    const r = machine.apply(m, now + i);
    steps.push({ index: i, type: m.messageType, accepted: r.accepted, state: r.state, reason: r.reason });
  });

  const finalState = machine.getState();
  return { finalState, success: finalState === 'direct_established' || finalState === 'fallback_established', steps };
}
