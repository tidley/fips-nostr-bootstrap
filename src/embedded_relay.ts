import { WebSocketServer } from 'ws';

export interface RelayEvent {
  id: string;
  pubkey: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
  sig: string;
}

type RelayFilter = {
  kinds?: number[];
  '#p'?: string[];
};

type Subscription = {
  ws: import('ws').WebSocket;
  subId: string;
  filters: RelayFilter[];
};

function matchesFilter(evt: RelayEvent, filter: RelayFilter): boolean {
  if (filter.kinds && !filter.kinds.includes(evt.kind)) return false;
  const pFilter = filter['#p'];
  if (pFilter && pFilter.length > 0) {
    const pTags = evt.tags.filter((t) => t[0] === 'p').map((t) => t[1]);
    if (!pFilter.some((p) => pTags.includes(p))) return false;
  }
  return true;
}

function matchesAny(evt: RelayEvent, filters: RelayFilter[]): boolean {
  if (!filters || filters.length === 0) return true;
  return filters.some((f) => matchesFilter(evt, f));
}

function safeSend(ws: import('ws').WebSocket, payload: unknown) {
  if (ws.readyState !== 1) return; // WebSocket.OPEN
  ws.send(JSON.stringify(payload));
}

export interface EmbeddedRelayServer {
  close: () => Promise<void>;
  url: string;
  port: number;
}

export async function startEmbeddedRelay(opts: { host?: string; port?: number; log?: (msg: string, meta?: unknown) => void } = {}): Promise<EmbeddedRelayServer> {
  const host = opts.host || '127.0.0.1';
  const port = opts.port ?? 1717;
  const log = opts.log || (() => undefined);

  const events: RelayEvent[] = [];
  const subs = new Map<string, Subscription>();

  const wss = new WebSocketServer({ host, port });

  wss.on('connection', (ws) => {
    ws.on('message', (raw) => {
      let msg: unknown;
      try {
        msg = JSON.parse(String(raw));
      } catch {
        safeSend(ws, ['NOTICE', 'invalid-json']);
        return;
      }

      if (!Array.isArray(msg) || msg.length < 2) {
        safeSend(ws, ['NOTICE', 'invalid-message']);
        return;
      }

      const type = msg[0];

      if (type === 'REQ') {
        const subId = String(msg[1]);
        const filters = msg.slice(2) as RelayFilter[];
        subs.set(subId, { ws, subId, filters });

        for (const evt of events) {
          if (matchesAny(evt, filters)) safeSend(ws, ['EVENT', subId, evt]);
        }
        safeSend(ws, ['EOSE', subId]);
        return;
      }

      if (type === 'CLOSE') {
        const subId = String(msg[1]);
        subs.delete(subId);
        return;
      }

      if (type === 'EVENT') {
        const evt = msg[1] as RelayEvent;
        if (!evt || typeof evt.kind !== 'number' || !Array.isArray(evt.tags)) {
          safeSend(ws, ['OK', evt?.id || '', false, 'invalid-event']);
          return;
        }

        events.push(evt);
        safeSend(ws, ['OK', evt.id || '', true, '']);

        for (const sub of subs.values()) {
          if (sub.ws.readyState !== 1) continue; // WebSocket.OPEN
          if (matchesAny(evt, sub.filters)) safeSend(sub.ws, ['EVENT', sub.subId, evt]);
        }
        return;
      }

      safeSend(ws, ['NOTICE', 'unsupported-type']);
    });

    ws.on('close', () => {
      for (const [k, sub] of subs.entries()) {
        if (sub.ws === ws) subs.delete(k);
      }
    });
  });

  await new Promise<void>((resolve) => {
    wss.once('listening', () => resolve());
  });

  const address = wss.address();
  const actualPort = typeof address === 'object' && address ? address.port : port;
  log('embedded relay listening', { host, port: actualPort });

  return {
    url: `ws://${host}:${actualPort}`,
    port: actualPort,
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        wss.close((err) => (err ? reject(err) : resolve()));
      });
    },
  };
}
