import type { TransportMode } from './types.js';

export interface FallbackDecision {
  mode: TransportMode;
  reason: string;
}

export function chooseFallback(canRelayAssist: boolean, reason: string): FallbackDecision {
  if (canRelayAssist) return { mode: 'relay_assisted', reason };
  return { mode: 'udp_direct', reason: `${reason}:no-fallback-available` };
}
