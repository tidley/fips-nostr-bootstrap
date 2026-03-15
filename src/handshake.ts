import type { HandshakeState, SessionBinding, SignalMessage, TransitionLog, TransitionResult } from './types.js';

export interface HandshakeOptions {
  identity: string;
  ackTimeoutMs: number;
  probeTimeoutMs: number;
  maxMonotonicSkewMs: number;
}

export class HandshakeMachine {
  private state: HandshakeState = 'idle';
  private readonly seenNonces = new Set<string>();
  private readonly lastTsBySender = new Map<string, number>();
  private readonly logs: TransitionLog[] = [];
  private sessionBinding?: SessionBinding;
  private announcedAt?: number;
  private probeStartedAt?: number;

  constructor(private readonly opts: HandshakeOptions) {}

  getState(): HandshakeState {
    return this.state;
  }

  getLogs(): TransitionLog[] {
    return [...this.logs];
  }

  getSessionBinding(): SessionBinding | undefined {
    return this.sessionBinding;
  }

  onTimeout(now: number): TransitionResult {
    if (this.state === 'awaiting_ack' && this.announcedAt !== undefined && now - this.announcedAt > this.opts.ackTimeoutMs) {
      return this.transition('fallback_pending', now, 'timeout', 'ack-timeout');
    }

    if (this.state === 'probing' && this.probeStartedAt !== undefined && now - this.probeStartedAt > this.opts.probeTimeoutMs) {
      return this.transition('fallback_pending', now, 'timeout', 'probe-timeout');
    }

    return { state: this.state, accepted: false, reason: 'no-timeout-transition' };
  }

  apply(message: SignalMessage, now: number): TransitionResult {
    const preflight = this.validateCommon(message, now);
    if (preflight) return preflight;

    switch (this.state) {
      case 'idle':
        if (message.messageType === 'bootstrap_announce') {
          this.announcedAt = now;
          return this.transition('awaiting_ack', now, message.messageType);
        }
        return this.reject('invalid-transition', now, message.messageType);

      case 'awaiting_ack':
        if (message.messageType === 'bootstrap_ack') {
          return this.transition('acknowledged', now, message.messageType);
        }
        if (message.messageType === 'retry_hint') {
          return this.transition('announced', now, message.messageType, 'retry-hint-accepted');
        }
        return this.reject('invalid-transition', now, message.messageType);

      case 'announced':
        if (message.messageType === 'bootstrap_announce') {
          this.announcedAt = now;
          return this.transition('awaiting_ack', now, message.messageType);
        }
        return this.reject('invalid-transition', now, message.messageType);

      case 'acknowledged':
        if (message.messageType === 'connect_probe') {
          this.probeStartedAt = now;
          return this.transition('probing', now, message.messageType);
        }
        if (message.messageType === 'abort') {
          return this.transition('failed', now, message.messageType, 'abort-received');
        }
        return this.reject('invalid-transition', now, message.messageType);

      case 'probing':
        if (message.messageType === 'connect_probe') {
          this.logs.push({ at: now, from: this.state, to: this.state, event: 'probe_tick' });
          return { state: this.state, accepted: true };
        }
        if (message.messageType === 'connect_confirm') {
          this.sessionBinding = {
            remoteIdentity: message.senderIdentity,
            negotiatedParameters: message.negotiatedParameters,
            selectedEndpointPair: { local: message.selectedEndpoint, remote: message.selectedEndpoint },
            sessionKeys: `k:${message.sessionId}:${message.nonce}`,
          };
          return this.transition('direct_established', now, message.messageType);
        }
        return this.reject('invalid-transition', now, message.messageType);

      case 'direct_established':
        if (message.messageType === 'rekey') {
          if (this.sessionBinding) this.sessionBinding.sessionKeys = `k:${message.sessionId}:${message.nonce}`;
          this.logs.push({ at: now, from: this.state, to: this.state, event: message.messageType });
          return { state: this.state, accepted: true };
        }
        if (message.messageType === 'abort') {
          return this.transition('closed', now, message.messageType, 'closed-by-peer');
        }
        return this.reject('invalid-transition', now, message.messageType);

      case 'fallback_pending':
        if (message.messageType === 'retry_hint') {
          return this.transition('announced', now, message.messageType, 'retry-hint');
        }
        if (message.messageType === 'bootstrap_ack') {
          return this.transition('fallback_established', now, message.messageType, 'relay-assisted-ack');
        }
        return this.reject('invalid-transition', now, message.messageType);

      case 'fallback_established':
        if (message.messageType === 'abort') return this.transition('closed', now, message.messageType, 'fallback-closed');
        return this.reject('invalid-transition', now, message.messageType);

      case 'failed':
      case 'closed':
        return this.reject('terminal-state', now, message.messageType);
    }
  }

  private validateCommon(message: SignalMessage, now: number): TransitionResult | undefined {
    if (message.expiry < now) return this.reject('expired', now, message.messageType);
    if (message.senderIdentity === this.opts.identity) return this.reject('loopback-sender', now, message.messageType);

    const nonceKey = `${message.sessionId}:${message.senderIdentity}:${message.nonce}`;
    if (this.seenNonces.has(nonceKey)) return this.reject('replay-nonce', now, message.messageType);
    this.seenNonces.add(nonceKey);

    const lastTs = this.lastTsBySender.get(message.senderIdentity);
    if (lastTs !== undefined && message.monotonicTimestamp + this.opts.maxMonotonicSkewMs < lastTs) {
      return this.reject('non-monotonic-timestamp', now, message.messageType);
    }
    this.lastTsBySender.set(message.senderIdentity, message.monotonicTimestamp);
    return undefined;
  }

  private transition(to: HandshakeState, at: number, event: TransitionLog['event'], reason?: string): TransitionResult {
    const from = this.state;
    this.state = to;
    this.logs.push({ at, from, to, event, reason });
    return { state: this.state, accepted: true, reason };
  }

  private reject(reason: string, at: number, event: TransitionLog['event']): TransitionResult {
    this.logs.push({ at, from: this.state, to: this.state, event, reason });
    return { state: this.state, accepted: false, reason };
  }
}
