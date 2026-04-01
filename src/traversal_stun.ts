import type { TraversalAddress } from './traversal_signal.js';

export interface StunBindingObservation {
  server: string;
  localPort: number;
  reflexiveAddress?: { ip: string; port: number };
  localInterfaceAddresses: string[];
}

export interface DerivedTraversalAddresses {
  stunServer: string;
  reflexiveAddress?: TraversalAddress;
  localAddresses: TraversalAddress[];
  hasUsableStun: boolean;
}

function toTraversalAddress(ip: string, port: number): TraversalAddress {
  return { protocol: 'udp', ip, port };
}

export function deriveTraversalAddresses(observation: StunBindingObservation): DerivedTraversalAddresses {
  const reflexiveAddress = observation.reflexiveAddress
    ? toTraversalAddress(observation.reflexiveAddress.ip, observation.reflexiveAddress.port)
    : undefined;

  const seen = new Set<string>();
  const localAddresses: TraversalAddress[] = [];
  for (const ip of observation.localInterfaceAddresses) {
    const key = `${ip}:${observation.localPort}`;
    if (!ip || seen.has(key)) continue;
    seen.add(key);
    if (reflexiveAddress && reflexiveAddress.ip === ip && reflexiveAddress.port === observation.localPort) {
      continue;
    }
    localAddresses.push(toTraversalAddress(ip, observation.localPort));
  }

  return {
    stunServer: observation.server,
    reflexiveAddress,
    localAddresses,
    hasUsableStun: Boolean(reflexiveAddress),
  };
}
