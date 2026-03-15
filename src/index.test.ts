import { describe, expect, it } from 'vitest';

import { HandshakeMachine, InMemoryNostrSignalAdapter, newNonce, newSessionId } from './index.js';

describe('index exports', () => {
  it('exports core API', () => {
    const m = new HandshakeMachine({ identity: 'x', ackTimeoutMs: 1, probeTimeoutMs: 1, maxMonotonicSkewMs: 0 });
    expect(m.getState()).toBe('idle');
    const s = new InMemoryNostrSignalAdapter();
    expect(typeof s.publish).toBe('function');
    expect(newSessionId().length).toBeGreaterThan(10);
    expect(newNonce().length).toBeGreaterThan(10);
  });
});
