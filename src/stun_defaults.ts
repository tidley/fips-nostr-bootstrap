export const DEFAULT_STUN_SERVERS = [
  'stun:fips.tomdwyer.uk:3478',
  'stun:stun.l.google.com:19302',
] as const;

export const DEFAULT_STUN_SERVER = DEFAULT_STUN_SERVERS[0];

export function parseStunServerList(raw = DEFAULT_STUN_SERVERS.join(',')): string[] {
  return [...new Set(raw.split(',').map((server) => server.trim()).filter(Boolean))];
}

export function parseStunUrl(input: string): { host: string; port: number } {
  const raw = input.replace(/^stun:/, '');
  const idx = raw.lastIndexOf(':');
  if (idx <= 0) throw new Error(`invalid STUN url: ${input}`);
  const host = raw.slice(0, idx);
  const port = Number(raw.slice(idx + 1));
  if (!host || !Number.isFinite(port)) throw new Error(`invalid STUN url: ${input}`);
  return { host, port };
}
