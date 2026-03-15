import dgram from 'node:dgram';
import os from 'node:os';
import { EventEmitter } from 'node:events';
import { SimplePool, finalizeEvent, generateSecretKey, getPublicKey, nip19 } from 'nostr-tools';
import { useWebSocketImplementation } from 'nostr-tools/relay';
import { wrapEvent, unwrapEvent } from 'nostr-tools/nip17';

async function ensureWs() {
  if (typeof globalThis.WebSocket !== 'undefined') {
    useWebSocketImplementation(globalThis.WebSocket);
    return;
  }
  const ws = await import('ws');
  const WS = ws.WebSocket || ws.default;
  globalThis.WebSocket = WS;
  useWebSocketImplementation(WS);
}

function publicHostHint(override) {
  if (override) return override;
  const ifaces = os.networkInterfaces();
  for (const list of Object.values(ifaces)) {
    if (!list) continue;
    for (const addr of list) if (addr.family === 'IPv4' && !addr.internal) return addr.address;
  }
  return '127.0.0.1';
}

function nonce() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function parsePacket(buf) {
  try {
    return JSON.parse(buf.toString('utf8'));
  } catch {
    return null;
  }
}

function publishDM({ pool, relays, sk, recipientPubkey, obj }) {
  const event = wrapEvent(sk, { publicKey: recipientPubkey }, JSON.stringify(obj));
  Promise.allSettled(pool.publish(relays, event)).catch(() => undefined);
}

export class FipsNostrRendezvousNode extends EventEmitter {
  constructor(opts = {}) {
    super();
    this.relays = opts.relays || ['wss://nos.lol'];
    this.trustedNpubs = new Set(opts.trustedNpubs || []);
    this.publicHost = opts.publicHost;
    this.udpPort = opts.udpPort || 9999;
    this.punchIntervalMs = opts.punchIntervalMs || 300;
    this.punchDurationMs = opts.punchDurationMs || 30000;
    this.punchStartDelayMs = opts.punchStartDelayMs || 3000;

    this.sk = opts.nsec ? nip19.decode(opts.nsec).data : generateSecretKey();
    this.pubkey = getPublicKey(this.sk);
    this.npub = nip19.npubEncode(this.pubkey);

    this.pool = null;
    this.socket = dgram.createSocket('udp4');
    this.punchSessions = new Map();
  }

  getNpub() {
    return this.npub;
  }

  setTrustedNpubs(npubs = []) {
    this.trustedNpubs = new Set(npubs);
  }

  async start() {
    await ensureWs();
    this.pool = new SimplePool({
      automaticallyAuth: () => async (authTemplate) => finalizeEvent(authTemplate, this.sk),
    });

    await new Promise((resolve, reject) => {
      this.socket.once('error', reject);
      this.socket.bind(this.udpPort, '0.0.0.0', resolve);
    });

    this.socket.on('message', (msg, rinfo) => {
      const pkt = parsePacket(msg);
      if (!pkt || !pkt.t || !pkt.n) return;
      if (pkt.t === 'PROBE') {
        this.socket.send(Buffer.from(JSON.stringify({ t: 'PROBE_ACK', n: pkt.n })), rinfo.port, rinfo.address);
        this.punchSessions.set(pkt.n, { established: true, remote: { host: rinfo.address, port: rinfo.port } });
        this.emit('punch', { nonce: pkt.n, remote: { host: rinfo.address, port: rinfo.port } });
      }
      if (pkt.t === 'PROBE_ACK') {
        this.punchSessions.set(pkt.n, { established: true, remote: { host: rinfo.address, port: rinfo.port } });
        this.emit('punch', { nonce: pkt.n, remote: { host: rinfo.address, port: rinfo.port } });
      }
    });

    this.sub = this.pool.subscribeMany(
      this.relays,
      { kinds: [1059], '#p': [this.pubkey], since: Math.floor(Date.now() / 1000) - 3 * 24 * 60 * 60 },
      {
        onevent: async (evt) => {
          try {
            const rumor = unwrapEvent(evt, this.sk);
            const msg = JSON.parse(rumor.content);
            const fromNpub = nip19.npubEncode(rumor.pubkey);

            if (this.trustedNpubs.size > 0 && !this.trustedNpubs.has(fromNpub)) {
              this.emit('reject', { reason: 'untrusted-npub', fromNpub });
              return;
            }

            if (msg?.type === 'fips.rendezvous.hello' && msg?.nonce && msg?.clientEndpoint) {
              const local = this.socket.address();
              const reply = {
                type: 'fips.rendezvous.server-info',
                nonce: msg.nonce,
                endpoint: { host: publicHostHint(this.publicHost), port: local.port },
                punch: {
                  startAtMs: Date.now() + this.punchStartDelayMs,
                  intervalMs: this.punchIntervalMs,
                  durationMs: this.punchDurationMs,
                },
              };
              publishDM({ pool: this.pool, relays: this.relays, sk: this.sk, recipientPubkey: rumor.pubkey, obj: reply });
              this._startPunch(msg.nonce, msg.clientEndpoint, reply.punch);
            }
          } catch {
            // ignore
          }
        },
      },
    );

    return { npub: this.npub, udpPort: this.socket.address().port };
  }

  async connect(targetNpub, opts = {}) {
    const target = nip19.decode(targetNpub);
    if (target.type !== 'npub') throw new Error('target must be npub');
    const targetPubkey = target.data;

    const local = this.socket.address();
    const helloNonce = nonce();
    const hello = {
      type: 'fips.rendezvous.hello',
      nonce: helloNonce,
      clientEndpoint: { host: publicHostHint(this.publicHost), port: local.port },
    };

    const waitMs = opts.waitMs || 60000;
    const retryMs = opts.retryMs || 5000;

    const serverInfo = await new Promise((resolve, reject) => {
      const started = Date.now();
      let timer;
      const sub = this.pool.subscribeMany(
        this.relays,
        { kinds: [1059], '#p': [this.pubkey], since: Math.floor(Date.now() / 1000) - 3 * 24 * 60 * 60 },
        {
          onevent: async (evt) => {
            try {
              const rumor = unwrapEvent(evt, this.sk);
              if (rumor.pubkey !== targetPubkey) return;
              const msg = JSON.parse(rumor.content);
              if (msg?.type !== 'fips.rendezvous.server-info' || msg?.nonce !== helloNonce) return;
              clearInterval(timer);
              sub.close();
              resolve(msg);
            } catch {
              // ignore
            }
          },
        },
      );

      publishDM({ pool: this.pool, relays: this.relays, sk: this.sk, recipientPubkey: targetPubkey, obj: hello });

      timer = setInterval(() => {
        if (Date.now() - started > waitMs) {
          clearInterval(timer);
          sub.close();
          reject(new Error('timed out waiting for server-info'));
          return;
        }
        publishDM({ pool: this.pool, relays: this.relays, sk: this.sk, recipientPubkey: targetPubkey, obj: hello });
      }, retryMs);
    });

    this._startPunch(helloNonce, serverInfo.endpoint, serverInfo.punch);

    const established = await this.waitForPunch(helloNonce, opts.punchWaitMs || (serverInfo.punch?.durationMs || 30000) + 5000);
    return { nonce: helloNonce, established, remote: established?.remote || serverInfo.endpoint, socket: this.socket };
  }

  waitForPunch(nonceValue, timeoutMs = 35000) {
    return new Promise((resolve) => {
      const started = Date.now();
      const timer = setInterval(() => {
        const st = this.punchSessions.get(nonceValue);
        if (st?.established) {
          clearInterval(timer);
          resolve(st);
          return;
        }
        if (Date.now() - started > timeoutMs) {
          clearInterval(timer);
          resolve(null);
        }
      }, 100);
    });
  }

  _startPunch(nonceValue, remote, punch) {
    const startAtMs = punch?.startAtMs || Date.now();
    const intervalMs = punch?.intervalMs || this.punchIntervalMs;
    const durationMs = punch?.durationMs || this.punchDurationMs;

    let seq = 0;
    setTimeout(() => {
      const tick = setInterval(() => {
        this.socket.send(Buffer.from(JSON.stringify({ t: 'PROBE', n: nonceValue, s: seq++ })), remote.port, remote.host);
      }, intervalMs);
      setTimeout(() => clearInterval(tick), durationMs);
    }, Math.max(0, startAtMs - Date.now()));
  }

  close() {
    this.sub?.close();
    this.pool.close(this.relays);
    this.socket.close();
  }
}

export function createFipsNostrRendezvousNode(options) {
  return new FipsNostrRendezvousNode(options);
}
