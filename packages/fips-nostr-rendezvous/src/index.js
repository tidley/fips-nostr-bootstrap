import dgram from 'node:dgram';
import os from 'node:os';
import { EventEmitter } from 'node:events';
import { SimplePool, finalizeEvent, generateSecretKey, getPublicKey, nip19 } from 'nostr-tools';
import { useWebSocketImplementation } from 'nostr-tools/relay';
import { wrapEvent, unwrapEvent } from 'nostr-tools/nip17';

const ADVERT_KIND = 30078;
const ADVERT_PROTOCOL = 'fips.nat.traversal.v1';
const TRAVERSAL_SIGNAL_KIND = 21059;
const TRAVERSAL_SIGNAL_TTL_MS = 60 * 1000;

export const DEFAULT_RELAYS = [
  'wss://offchain.pub',
  'wss://www.nostr.ltd',
  'wss://relay.nostr.band',
  'wss://nip17.com',
  'wss://nip17.tomdwyer.uk',
];

export const DEFAULT_ADVERT_RELAYS = [
  'wss://offchain.pub',
  'wss://www.nostr.ltd',
  'wss://relay.nostr.band',
];

export const DEFAULT_DM_RELAYS = [
  'wss://nip17.com',
  'wss://nip17.tomdwyer.uk',
  'wss://relay.nostr.band',
  'wss://offchain.pub',
  'wss://www.nostr.ltd',
];

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

function isUdpAddress(value) {
  return (
    value &&
    value.protocol === 'udp' &&
    typeof value.ip === 'string' &&
    typeof value.port === 'number' &&
    value.port > 0 &&
    value.port <= 65535
  );
}

function isTraversalOfferMessage(value) {
  return (
    value &&
    value.app === ADVERT_PROTOCOL &&
    value.eventKind === TRAVERSAL_SIGNAL_KIND &&
    value.type === 'offer' &&
    typeof value.sessionId === 'string' &&
    typeof value.nonce === 'string' &&
    typeof value.senderNpub === 'string' &&
    typeof value.recipientNpub === 'string' &&
    (isUdpAddress(value.reflexiveAddress) || (Array.isArray(value.localAddresses) && value.localAddresses.some(isUdpAddress)))
  );
}

function isTraversalAnswerMessage(value) {
  return (
    value &&
    value.app === ADVERT_PROTOCOL &&
    value.eventKind === TRAVERSAL_SIGNAL_KIND &&
    value.type === 'answer' &&
    typeof value.sessionId === 'string' &&
    typeof value.nonce === 'string' &&
    typeof value.inReplyTo === 'string' &&
    typeof value.senderNpub === 'string' &&
    typeof value.recipientNpub === 'string' &&
    typeof value.accepted === 'boolean'
  );
}

function selectTraversalRemote(message) {
  if (isUdpAddress(message?.reflexiveAddress)) {
    return { host: message.reflexiveAddress.ip, port: message.reflexiveAddress.port };
  }
  if (Array.isArray(message?.localAddresses)) {
    const localCandidate = message.localAddresses.find(isUdpAddress);
    if (localCandidate) return { host: localCandidate.ip, port: localCandidate.port };
  }
  return null;
}

function isTraversalAdvertMessage(value) {
  return (
    value &&
    value.app === ADVERT_PROTOCOL &&
    typeof value.publisherNpub === 'string' &&
    typeof value.expiresAt === 'number' &&
    value.expiresAt > Date.now() &&
    Array.isArray(value.relays) &&
    Array.isArray(value.stunServers) &&
    Array.isArray(value.transports)
  );
}

function sortAdverts(adverts) {
  return [...adverts].sort((a, b) => {
    const bPublished = Number(b.publishedAt || 0);
    const aPublished = Number(a.publishedAt || 0);
    if (bPublished !== aPublished) return bPublished - aPublished;
    return Number(b.sequence || 0) - Number(a.sequence || 0);
  });
}

function publishDM({ pool, relays, sk, recipientPubkey, obj, logContext }) {
  const event = wrapEvent(sk, { publicKey: recipientPubkey }, JSON.stringify(obj));
  Promise.allSettled(pool.publish(relays, event))
    .then((results) => {
      if (!logContext) return;
      const summary = results.map((r, i) => ({
        relay: relays[i] || `relay-${i}`,
        status: r.status,
        reason: r.status === 'rejected' ? String(r.reason) : undefined,
      }));
      console.log('[rendezvous] publish outcomes', JSON.stringify({ logContext, summary }));
    })
    .catch((err) => {
      console.error('[rendezvous] publish failure', String(err));
    });
}

function publishEvent({ pool, relays, sk, evt, logContext }) {
  Promise.allSettled(pool.publish(relays, evt))
    .then((results) => {
      if (!logContext) return;
      const summary = results.map((r, i) => ({
        relay: relays[i] || `relay-${i}`,
        status: r.status,
        reason: r.status === 'rejected' ? String(r.reason) : undefined,
      }));
      console.log('[rendezvous] public publish outcomes', JSON.stringify({ logContext, summary }));
    })
    .catch((err) => {
      console.error('[rendezvous] public publish failure', String(err));
    });
}

function subscribeDirectMessages({ pool, relays, recipientPubkey, handlers, since }) {
  const filters = [
    { kinds: [1059], '#p': [recipientPubkey], since },
    { kinds: [1059], since },
  ];
  const subs = filters.map((filter) => pool.subscribeMany(relays, filter, handlers));
  return {
    close() {
      for (const sub of subs) {
        try {
          sub.close();
        } catch {
          // ignore close errors
        }
      }
    },
  };
}

class FipsStackSession extends EventEmitter {
  constructor({ socket, remote, sessionId }) {
    super();
    this.socket = socket;
    this.remote = remote;
    this.sessionId = sessionId;
    this._onMessage = (msg, rinfo) => {
      if (rinfo.address !== this.remote.host || rinfo.port !== this.remote.port) return;
      if (msg.length < 5) return;
      if (msg.subarray(0, 5).toString() !== 'FIPS1') return;
      try {
        const frame = JSON.parse(msg.subarray(5).toString('utf8'));
        if (frame?.sessionId !== this.sessionId) return;
        this.emit('frame', frame);
        if (frame?.channel) this.emit(`channel:${frame.channel}`, frame.payload, frame);
      } catch {
        // ignore malformed frame
      }
    };
    this.socket.on('message', this._onMessage);
  }

  send(channel, payload, type = 'data') {
    const frame = { sessionId: this.sessionId, type, channel, payload, at: Date.now() };
    const pkt = Buffer.concat([Buffer.from('FIPS1'), Buffer.from(JSON.stringify(frame))]);
    this.socket.send(pkt, this.remote.port, this.remote.host);
  }

  close() {
    this.socket.off('message', this._onMessage);
  }
}

export class FipsNostrRendezvousNode extends EventEmitter {
  constructor(opts = {}) {
    super();
    this.advertRelays = opts.advertRelays ?? opts.relays ?? DEFAULT_ADVERT_RELAYS;
    this.dmRelays = opts.dmRelays ?? opts.relays ?? DEFAULT_DM_RELAYS;
    this.relays = [...new Set([...this.advertRelays, ...this.dmRelays])];
    this.trustedNpubs = new Set(opts.trustedNpubs ?? []);
    this.publicHost = opts.publicHost;
    this.udpPort = opts.udpPort ?? 9999;
    this.punchIntervalMs = opts.punchIntervalMs ?? 300;
    this.punchDurationMs = opts.punchDurationMs ?? 30000;
    this.punchStartDelayMs = opts.punchStartDelayMs ?? 3000;
    this.stunPort = opts.stunPort ?? 3478;
    this.stunUri = opts.stunUri || null;
    this.advertise = opts.advertise !== false;
    this.advertiseIntervalMs = opts.advertiseIntervalMs ?? 5 * 60 * 1000;
    this.advertiseTtlMs = opts.advertiseTtlMs ?? 10 * 60 * 1000;

    this.sk = opts.nsec ? nip19.decode(opts.nsec).data : generateSecretKey();
    this.pubkey = getPublicKey(this.sk);
    this.npub = nip19.npubEncode(this.pubkey);

    this.pool = null;
    this.socket = dgram.createSocket('udp4');
    this.punchSessions = new Map();
    this.sessions = new Map();
    this.advertTimer = null;
    this.advertCache = new Map();
    this.pendingTraversalResponses = new Map();
    this.sub = null;
    this.advertSub = null;
  }

  getNpub() {
    return this.npub;
  }

  setTrustedNpubs(npubs = []) {
    this.trustedNpubs = new Set(npubs);
  }

  async start() {
    await ensureWs();
    // Keep relay auth opt-in. Some public relays challenge aggressively and may reject
    // client AUTH attempts in ways that can break startup if we attach a global signer.
    this.pool = new SimplePool();

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
        if (!this.sessions.has(pkt.n)) {
          const session = new FipsStackSession({ socket: this.socket, remote: { host: rinfo.address, port: rinfo.port }, sessionId: pkt.n });
          this.sessions.set(pkt.n, session);
          this.emit('session', { sessionId: pkt.n, remote: { host: rinfo.address, port: rinfo.port }, session });
        }
      }
      if (pkt.t === 'PROBE_ACK') {
        this.punchSessions.set(pkt.n, { established: true, remote: { host: rinfo.address, port: rinfo.port } });
        this.emit('punch', { nonce: pkt.n, remote: { host: rinfo.address, port: rinfo.port } });
        if (!this.sessions.has(pkt.n)) {
          const session = new FipsStackSession({ socket: this.socket, remote: { host: rinfo.address, port: rinfo.port }, sessionId: pkt.n });
          this.sessions.set(pkt.n, session);
          this.emit('session', { sessionId: pkt.n, remote: { host: rinfo.address, port: rinfo.port }, session });
        }
      }
    });

    this.sub = subscribeDirectMessages({
      pool: this.pool,
      relays: this.dmRelays,
      recipientPubkey: this.pubkey,
      since: Math.floor(Date.now() / 1000) - 3 * 24 * 60 * 60,
      handlers: {
        onevent: async (evt) => {
          try {
            const rumor = unwrapEvent(evt, this.sk);
            const msg = JSON.parse(rumor.content);
            const fromNpub = nip19.npubEncode(rumor.pubkey);

            if (this.trustedNpubs.size > 0 && !this.trustedNpubs.has(fromNpub)) {
              this.emit('reject', { reason: 'untrusted-npub', fromNpub });
              return;
            }

            if (this._resolvePendingTraversalResponse(msg, rumor.pubkey)) {
              return;
            }

            if (isTraversalOfferMessage(msg) && msg.recipientNpub === this.npub) {
              const reply = this._handleTraversalOffer(msg, Date.now());
              this._publishDM(rumor.pubkey, reply, {
                kind: 'answer',
                nonce: reply.nonce,
                sessionId: reply.sessionId,
                toPubkey: rumor.pubkey,
                inReplyTo: reply.inReplyTo,
              });
              return;
            }

            if (msg?.type === 'fips.rendezvous.hello' && msg?.nonce) {
              const local = this.socket.address();
              const now = Date.now();
              const host = publicHostHint(this.publicHost);
              const wants = msg?.wants || {};
              const punch = {
                startAtMs: now + this.punchStartDelayMs,
                intervalMs: this.punchIntervalMs,
                durationMs: this.punchDurationMs,
              };

              const reply = {
                type: 'fips.rendezvous.server-info',
                version: '1.0',
                sessionId: msg.sessionId || msg.nonce,
                nonce: msg.nonce,
                issuedAt: now,
                endpoint: { host, port: local.port },
                ...(wants.stunInfo
                  ? { stun: { uri: this.stunUri || `stun:${host}:${this.stunPort}`, metadataTag: 'stun' } }
                  : {}),
                ...(wants.fipsConnect ? { punch } : {}),
              };

              console.log(
                '[rendezvous] hello received',
                JSON.stringify({
                  fromNpub,
                  nonce: msg.nonce,
                  sessionId: msg.sessionId || msg.nonce,
                  wants,
                  hasClientEndpoint: Boolean(msg?.clientEndpoint?.host && msg?.clientEndpoint?.port),
                }),
              );

              this._publishDM(rumor.pubkey, reply, {
                kind: 'server-info',
                nonce: reply.nonce,
                sessionId: reply.sessionId,
                toPubkey: rumor.pubkey,
              });

              console.log(
                '[rendezvous] server-info published',
                JSON.stringify({
                  toPubkey: rumor.pubkey,
                  nonce: reply.nonce,
                  sessionId: reply.sessionId,
                  endpoint: reply.endpoint,
                  hasStun: Boolean(reply.stun),
                  hasPunch: Boolean(reply.punch),
                }),
              );

              if (wants.fipsConnect && msg?.clientEndpoint?.host && msg?.clientEndpoint?.port) {
                this._startPunch(msg.nonce, msg.clientEndpoint, punch);
              }
            }
          } catch {
            // ignore
          }
        },
      },
    });

    this.advertSub = this.pool.subscribeMany(
      this.advertRelays,
      { kinds: [ADVERT_KIND], since: Math.floor(Date.now() / 1000) - 3 * 24 * 60 * 60 },
      {
        onevent: (evt) => {
          this._handleAdvertEvent(evt);
        },
      },
    );

    if (this.advertise) {
      this._publishAdvert();
      this.advertTimer = setInterval(() => this._publishAdvert(), this.advertiseIntervalMs);
    }

    return { npub: this.npub, udpPort: this.socket.address().port };
  }

  async findAdvertisedPeer(targetNpub, opts = {}) {
    const target = nip19.decode(targetNpub);
    if (target.type !== 'npub') throw new Error('target must be npub');
    const adverts = await this.listAdvertisedPeers({
      ...opts,
      filter: (msg) => msg.publisherNpub === targetNpub,
      maxPeers: 1,
    });
    if (adverts.length === 0) {
      throw new Error(`timed out waiting for advert for ${targetNpub} after ${opts.waitMs || 15000}ms`);
    }
    return adverts[0];
  }

  async listAdvertisedPeers(opts = {}) {
    const waitMs = opts.waitMs || 15000;
    const maxPeers = opts.maxPeers || 20;
    const settleMs = opts.settleMs ?? 750;
    const excludedNpubs = new Set(opts.excludePublisherNpubs || []);
    const filter = typeof opts.filter === 'function' ? opts.filter : () => true;

    if (this.advertSub) {
      const current = this._selectAdvertisedPeers({ excludedNpubs, filter, maxPeers });
      if (current.length > 0) {
        return current;
      }

      return await new Promise((resolve) => {
        let timeout = null;
        let settleTimer = null;

        const finish = () => {
          if (timeout) clearTimeout(timeout);
          if (settleTimer) clearTimeout(settleTimer);
          this.off('advert:update', onAdvertUpdate);
          resolve(this._selectAdvertisedPeers({ excludedNpubs, filter, maxPeers }));
        };

        const onAdvertUpdate = () => {
          const matches = this._selectAdvertisedPeers({ excludedNpubs, filter, maxPeers });
          if (matches.length === 0) return;
          if (settleMs <= 0) {
            finish();
            return;
          }
          if (settleTimer) clearTimeout(settleTimer);
          settleTimer = setTimeout(() => finish(), Math.max(0, settleMs));
        };

        this.on('advert:update', onAdvertUpdate);
        timeout = setTimeout(() => finish(), waitMs);
      });
    }

    return await new Promise((resolve) => {
      let timeout = null;
      let settleTimer = null;
      const byPublisher = new Map();

      const finish = () => {
        if (timeout) clearTimeout(timeout);
        if (settleTimer) clearTimeout(settleTimer);
        try { sub.close(); } catch {}
        resolve(sortAdverts([...byPublisher.values()]).slice(0, maxPeers));
      };

      const sub = this.pool.subscribeMany(
        this.advertRelays,
        { kinds: [ADVERT_KIND], since: Math.floor(Date.now() / 1000) - 3 * 24 * 60 * 60 },
        {
          onevent: (evt) => {
            try {
              const msg = JSON.parse(evt.content);
              if (!isTraversalAdvertMessage(msg)) return;
              if (excludedNpubs.has(msg.publisherNpub)) return;
              if (!filter(msg)) return;
              const existing = byPublisher.get(msg.publisherNpub);
              if (!existing || sortAdverts([msg, existing])[0] === msg) {
                byPublisher.set(msg.publisherNpub, msg);
              }
              if (byPublisher.size > 0) {
                if (settleMs <= 0) {
                  finish();
                  return;
                }
                if (settleTimer) clearTimeout(settleTimer);
                settleTimer = setTimeout(() => finish(), settleMs);
              }
            } catch {
              // ignore malformed adverts
            }
          },
        },
      );

      timeout = setTimeout(() => {
        finish();
      }, waitMs);
    });
  }

  async connectToAdvertisedPeer(targetNpub, opts = {}) {
    const discoveredAdvert = await this.findAdvertisedPeer(targetNpub, {
      waitMs: opts.discoveryWaitMs || opts.waitMs || 15000,
    });
    const conn = await this.connectFromAdvert(discoveredAdvert, opts);
    return { ...conn, discoveredAdvert };
  }

  async connectFromAdvert(advert, opts = {}) {
    if (!isTraversalAdvertMessage(advert)) throw new Error('invalid traversal advert');
    const conn = await this.connect(advert.publisherNpub, {
      ...opts,
      dmRelays: opts.dmRelays ?? advert.relays ?? this.dmRelays,
    });
    return { ...conn, discoveredAdvert: advert };
  }

  async connectToDiscoveredPeer(opts = {}) {
    const adverts = await this.listAdvertisedPeers({
      waitMs: opts.discoveryWaitMs || opts.waitMs || 15000,
      maxPeers: 1,
      excludePublisherNpubs: opts.includeSelf ? [] : [this.npub],
    });
    if (adverts.length === 0) {
      throw new Error(`timed out waiting for any traversal advert after ${opts.discoveryWaitMs || opts.waitMs || 15000}ms`);
    }
    return this.connectFromAdvert(adverts[0], opts);
  }

  async connect(targetNpub, opts = {}) {
    if (targetNpub === this.npub) throw new Error('refusing to connect to self');
    const target = nip19.decode(targetNpub);
    if (target.type !== 'npub') throw new Error('target must be npub');
    const targetPubkey = target.data;
    const offer = this._buildTraversalOffer(targetNpub);
    const hello = this._buildLegacyHello(offer);

    const waitMs = opts.waitMs || 60000;
    const retryMs = opts.retryMs || 5000;
    const dmRelays = opts.dmRelays ?? this.dmRelays;

    const response = await new Promise((resolve, reject) => {
      const started = Date.now();
      let timer;
      const closePending = () => {
        if (timer) clearInterval(timer);
        this.pendingTraversalResponses.delete(offer.nonce);
      };

      let tempSub = null;
      if (this.sub) {
        this.pendingTraversalResponses.set(offer.nonce, {
          targetPubkey,
          sessionId: offer.sessionId,
          nonce: offer.nonce,
          recipientNpub: this.npub,
          resolve: (msg) => {
            closePending();
            resolve(msg);
          },
        });
      } else {
        tempSub = subscribeDirectMessages({
          pool: this.pool,
          relays: dmRelays,
          recipientPubkey: this.pubkey,
          since: Math.floor(Date.now() / 1000) - 3 * 24 * 60 * 60,
          handlers: {
            onevent: async (evt) => {
              try {
                const rumor = unwrapEvent(evt, this.sk);
                const msg = JSON.parse(rumor.content);
                if (!this._matchesPendingTraversalResponse({
                  entry: {
                    targetPubkey,
                    sessionId: offer.sessionId,
                    nonce: offer.nonce,
                    recipientNpub: this.npub,
                  },
                  msg,
                  rumorPubkey: rumor.pubkey,
                })) return;
                closePending();
                try { tempSub.close(); } catch {}
                resolve(msg);
              } catch {
                // ignore
              }
            },
          },
        });
      }

      this._publishDM(targetPubkey, offer, {
        relays: dmRelays,
        kind: 'offer',
        nonce: offer.nonce,
        sessionId: offer.sessionId,
        toPubkey: targetPubkey,
      });
      this._publishDM(targetPubkey, hello, {
        relays: dmRelays,
        kind: 'hello-fallback',
        nonce: hello.nonce,
        sessionId: hello.sessionId,
        toPubkey: targetPubkey,
      });

      timer = setInterval(() => {
        if (Date.now() - started > waitMs) {
          closePending();
          try { tempSub?.close(); } catch {}
          reject(new Error('timed out waiting for traversal answer'));
          return;
        }
        this._publishDM(targetPubkey, offer, {
          relays: dmRelays,
          kind: 'offer-retry',
          nonce: offer.nonce,
          sessionId: offer.sessionId,
          toPubkey: targetPubkey,
        });
        this._publishDM(targetPubkey, hello, {
          relays: dmRelays,
          kind: 'hello-fallback-retry',
          nonce: hello.nonce,
          sessionId: hello.sessionId,
          toPubkey: targetPubkey,
        });
      }, retryMs);
    });

    let remote = null;
    let punch = null;
    if (isTraversalAnswerMessage(response)) {
      if (!response.accepted) throw new Error(response.reason || 'traversal rejected');
      remote = selectTraversalRemote(response);
      punch = response.punch;
    } else {
      remote = response.endpoint;
      punch = response.punch;
    }
    if (!remote?.host || !remote?.port) throw new Error('remote endpoint missing from traversal response');

    this._startPunch(offer.nonce, remote, punch);

    const established = await this.waitForPunch(offer.nonce, opts.punchWaitMs || (punch?.durationMs || 30000) + 5000);
    if (!established?.established) {
      throw new Error('timed out waiting for UDP hole punch');
    }
    remote = established?.remote || remote;
    let session = this.sessions.get(offer.nonce);
    if (!session) {
      session = new FipsStackSession({ socket: this.socket, remote, sessionId: offer.nonce });
      this.sessions.set(offer.nonce, session);
      this.emit('session', { sessionId: offer.nonce, remote, session });
    }
    return { nonce: offer.nonce, established, remote, socket: this.socket, session, targetNpub };
  }

  waitForPunch(nonceValue, timeoutMs = 35000) {
    const existing = this.punchSessions.get(nonceValue);
    if (existing?.established) return Promise.resolve(existing);

    return new Promise((resolve) => {
      const onPunch = ({ nonce, remote }) => {
        if (nonce !== nonceValue) return;
        clearTimeout(timer);
        this.off('punch', onPunch);
        resolve({ established: true, remote });
      };
      const timer = setTimeout(() => {
        this.off('punch', onPunch);
        resolve(null);
      }, timeoutMs);
      this.on('punch', onPunch);
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

  _publishDM(recipientPubkey, obj, logContext = {}) {
    publishDM({
      pool: this.pool,
      relays: logContext.relays ?? this.dmRelays,
      sk: this.sk,
      recipientPubkey,
      obj,
      logContext: {
        ...logContext,
        relays: undefined,
      },
    });
  }

  _buildTraversalOffer(targetNpub, now = Date.now()) {
    const sessionId = nonce();
    const reflexiveAddress = this._resolveTraversalAddress();
    return {
      app: ADVERT_PROTOCOL,
      eventKind: TRAVERSAL_SIGNAL_KIND,
      type: 'offer',
      sessionId,
      issuedAt: now,
      expiresAt: now + TRAVERSAL_SIGNAL_TTL_MS,
      nonce: sessionId,
      senderNpub: this.npub,
      recipientNpub: targetNpub,
      reflexiveAddress,
      localAddresses: [reflexiveAddress],
    };
  }

  _buildLegacyHello(offer) {
    return {
      type: 'fips.rendezvous.hello',
      version: '1.0',
      sessionId: offer.sessionId,
      nonce: offer.nonce,
      issuedAt: offer.issuedAt,
      wants: { stunInfo: true, fipsConnect: true },
      clientEndpoint: { host: offer.reflexiveAddress.ip, port: offer.reflexiveAddress.port },
    };
  }

  _buildTraversalAnswer({ offer, now = Date.now() }) {
    const reflexiveAddress = this._resolveTraversalAddress();
    const punch = {
      startAtMs: now + this.punchStartDelayMs,
      intervalMs: this.punchIntervalMs,
      durationMs: this.punchDurationMs,
    };
    return {
      app: ADVERT_PROTOCOL,
      eventKind: TRAVERSAL_SIGNAL_KIND,
      type: 'answer',
      sessionId: offer.sessionId,
      issuedAt: now,
      expiresAt: now + TRAVERSAL_SIGNAL_TTL_MS,
      nonce: nonce(),
      senderNpub: this.npub,
      recipientNpub: offer.senderNpub,
      inReplyTo: offer.nonce,
      accepted: true,
      reflexiveAddress,
      localAddresses: [reflexiveAddress],
      punch,
    };
  }

  _handleTraversalOffer(offer, now = Date.now()) {
    const reply = this._buildTraversalAnswer({ offer, now });
    const remote = selectTraversalRemote(offer);
    if (!remote) {
      return { ...reply, accepted: false, reason: 'missing-remote-address', punch: undefined };
    }
    this._startPunch(offer.nonce, remote, reply.punch);
    return reply;
  }

  _resolveTraversalAddress() {
    const local = this.socket.address();
    return {
      protocol: 'udp',
      ip: publicHostHint(this.publicHost),
      port: local.port,
    };
  }

  close() {
    if (this.advertTimer) clearInterval(this.advertTimer);
    this.sub?.close();
    this.advertSub?.close();
    this.pool?.close(this.relays);
    for (const s of this.sessions.values()) s.close();
    this.sessions.clear();
    this.advertCache.clear();
    this.pendingTraversalResponses.clear();
    this.socket.close();
  }

  _publishAdvert() {
    const local = this.socket.address();
    const now = Date.now();
    const host = publicHostHint(this.publicHost);
    const advert = {
      app: ADVERT_PROTOCOL,
      eventKind: ADVERT_KIND,
      protocol: ADVERT_PROTOCOL,
      publisherNpub: this.npub,
      publishedAt: now,
      expiresAt: now + this.advertiseTtlMs,
      sequence: now,
      relays: this.dmRelays,
      stunServers: [this.stunUri || `stun:${host}:${this.stunPort}`],
      transports: ['udp'],
      endpointHint: { host, port: local.port },
    };
    const evt = finalizeEvent({
      kind: ADVERT_KIND,
      created_at: Math.floor(now / 1000),
      tags: [['d', `fips-traversal:${this.npub}`], ['t', 'fips'], ['t', 'traversal']],
      content: JSON.stringify(advert),
    }, this.sk);
    publishEvent({
      pool: this.pool,
      relays: this.advertRelays,
      sk: this.sk,
      evt,
      logContext: { kind: 'advert', npub: this.npub },
    });
  }

  _handleAdvertEvent(evt) {
    try {
      const msg = JSON.parse(evt.content);
      if (!isTraversalAdvertMessage(msg)) return false;
      const existing = this.advertCache.get(msg.publisherNpub);
      if (!existing || sortAdverts([msg, existing])[0] === msg) {
        this.advertCache.set(msg.publisherNpub, msg);
        this.emit('advert:update', msg);
      }
      return true;
    } catch {
      return false;
    }
  }

  _selectAdvertisedPeers({ excludedNpubs = new Set(), filter = () => true, maxPeers = 20 } = {}) {
    return sortAdverts(
      [...this.advertCache.values()].filter((msg) => !excludedNpubs.has(msg.publisherNpub) && filter(msg)),
    ).slice(0, maxPeers);
  }

  _matchesPendingTraversalResponse({ entry, msg, rumorPubkey }) {
    if (rumorPubkey !== entry.targetPubkey) return false;
    if (isTraversalAnswerMessage(msg)) {
      return (
        msg.sessionId === entry.sessionId &&
        msg.inReplyTo === entry.nonce &&
        msg.recipientNpub === entry.recipientNpub
      );
    }
    return msg?.type === 'fips.rendezvous.server-info' && msg?.nonce === entry.nonce;
  }

  _resolvePendingTraversalResponse(msg, rumorPubkey) {
    const key = isTraversalAnswerMessage(msg) ? msg.inReplyTo : msg?.nonce;
    if (!key) return false;
    const entry = this.pendingTraversalResponses.get(key);
    if (!entry) return false;
    if (!this._matchesPendingTraversalResponse({ entry, msg, rumorPubkey })) return false;
    entry.resolve(msg);
    return true;
  }
}

export function createFipsNostrRendezvousNode(options) {
  return new FipsNostrRendezvousNode(options);
}
