// @ts-nocheck
import dgram from 'node:dgram';
import os from 'node:os';
import { EventEmitter } from 'node:events';
import { createHash, randomBytes } from 'node:crypto';
import { SimplePool, finalizeEvent, generateSecretKey, getPublicKey, nip19 } from 'nostr-tools';
import { useWebSocketImplementation } from 'nostr-tools/relay';
import { wrapEvent, unwrapEvent } from 'nostr-tools/nip17';
const ADVERT_KIND = 30078;
const ADVERT_PROTOCOL = 'fips.nat.traversal.v1';
const TRAVERSAL_SIGNAL_KIND = 21059;
const TRAVERSAL_SIGNAL_TTL_MS = 60 * 1000;
const INBOX_RELAYS_KIND = 10050;
const NIP09_DELETE_KIND = 5;
const STUN_MAGIC_COOKIE = 0x2112a442;
const STUN_BINDING_REQUEST = 0x0001;
const STUN_BINDING_SUCCESS = 0x0101;
const STUN_ATTR_MAPPED_ADDRESS = 0x0001;
const STUN_ATTR_XOR_MAPPED_ADDRESS = 0x0020;
const PUNCH_MAGIC = 0x4e505443;
const PUNCH_ACK_MAGIC = 0x4e505441;
export const DEFAULT_RELAYS = [
    'wss://offchain.pub',
    'wss://strfry.bitsbytom.com',
    'wss://nip17.com',
];
export const DEFAULT_ADVERT_RELAYS = [
    'wss://offchain.pub',
    'wss://strfry.bitsbytom.com',
];
export const DEFAULT_DM_RELAYS = [
    'wss://nip17.com',
    'wss://offchain.pub',
];
export const DEFAULT_STUN_SERVERS = [
    'stun:fips.tomdwyer.uk:3478',
    'stun:stun.l.google.com:19302',
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
    if (override)
        return override;
    const ifaces = os.networkInterfaces();
    for (const list of Object.values(ifaces)) {
        if (!list)
            continue;
        for (const addr of list)
            if (addr.family === 'IPv4' && !addr.internal)
                return addr.address;
    }
    return '127.0.0.1';
}
function localIpv4Addresses() {
    const seen = new Set();
    const addresses = [];
    const ifaces = os.networkInterfaces();
    for (const list of Object.values(ifaces)) {
        if (!list)
            continue;
        for (const addr of list) {
            if (addr.family !== 'IPv4' || addr.internal || !addr.address)
                continue;
            if (seen.has(addr.address))
                continue;
            seen.add(addr.address);
            addresses.push(addr.address);
        }
    }
    return addresses;
}
function nonce() {
    return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
function parseStunUrl(input) {
    const raw = String(input || '').replace(/^stun:/, '');
    const idx = raw.lastIndexOf(':');
    if (idx <= 0)
        throw new Error(`invalid STUN url: ${input}`);
    const host = raw.slice(0, idx);
    const port = Number(raw.slice(idx + 1));
    if (!host || !Number.isFinite(port))
        throw new Error(`invalid STUN url: ${input}`);
    return { host, port };
}
function createStunBindingRequest(txnId) {
    const packet = Buffer.alloc(20);
    packet.writeUInt16BE(STUN_BINDING_REQUEST, 0);
    packet.writeUInt16BE(0, 2);
    packet.writeUInt32BE(STUN_MAGIC_COOKIE, 4);
    txnId.copy(packet, 8);
    return packet;
}
function ipv4BufferToString(buf) {
    return Array.from(buf).join('.');
}
function parseMappedAddress(buf) {
    if (buf.length < 8 || buf[1] !== 0x01)
        return null;
    return {
        ip: ipv4BufferToString(buf.subarray(4, 8)),
        port: buf.readUInt16BE(2),
    };
}
function parseXorMappedAddress(buf) {
    if (buf.length < 8 || buf[1] !== 0x01)
        return null;
    const ipBytes = Buffer.from(buf.subarray(4, 8));
    const cookie = Buffer.alloc(4);
    cookie.writeUInt32BE(STUN_MAGIC_COOKIE, 0);
    for (let i = 0; i < 4; i++) {
        ipBytes[i] ^= cookie[i];
    }
    return {
        ip: ipv4BufferToString(ipBytes),
        port: buf.readUInt16BE(2) ^ (STUN_MAGIC_COOKIE >>> 16),
    };
}
function parseStunBindingSuccess(packet, txnId) {
    if (!Buffer.isBuffer(packet) || packet.length < 20)
        return null;
    if (packet.readUInt16BE(0) !== STUN_BINDING_SUCCESS)
        return null;
    if (packet.readUInt32BE(4) !== STUN_MAGIC_COOKIE)
        return null;
    if (!packet.subarray(8, 20).equals(txnId))
        return null;
    const messageLength = packet.readUInt16BE(2);
    let offset = 20;
    const maxOffset = Math.min(packet.length, 20 + messageLength);
    while (offset + 4 <= maxOffset) {
        const attrType = packet.readUInt16BE(offset);
        const attrLength = packet.readUInt16BE(offset + 2);
        const valueStart = offset + 4;
        const valueEnd = valueStart + attrLength;
        if (valueEnd > packet.length)
            break;
        const value = packet.subarray(valueStart, valueEnd);
        if (attrType === STUN_ATTR_XOR_MAPPED_ADDRESS) {
            const parsed = parseXorMappedAddress(value);
            if (parsed)
                return parsed;
        }
        if (attrType === STUN_ATTR_MAPPED_ADDRESS) {
            const parsed = parseMappedAddress(value);
            if (parsed)
                return parsed;
        }
        offset = valueEnd + ((4 - (attrLength % 4)) % 4);
    }
    return null;
}
function buildPunchPacket(magic, sessionId) {
    const hash = createHash('sha256').update(String(sessionId)).digest().subarray(0, 16);
    const packet = Buffer.alloc(20);
    packet.writeUInt32BE(magic, 0);
    hash.copy(packet, 4);
    return packet;
}
function parsePunchPacket(buf) {
    if (!Buffer.isBuffer(buf) || buf.length < 20)
        return null;
    const magic = buf.readUInt32BE(0);
    if (magic !== PUNCH_MAGIC && magic !== PUNCH_ACK_MAGIC)
        return null;
    return {
        type: magic === PUNCH_MAGIC ? 'PROBE' : 'PROBE_ACK',
        sessionHash: buf.subarray(4, 20).toString('hex'),
    };
}
function parsePacket(buf) {
    const binaryPunch = parsePunchPacket(buf);
    if (binaryPunch)
        return { t: binaryPunch.type, h: binaryPunch.sessionHash };
    try {
        return JSON.parse(buf.toString('utf8'));
    }
    catch {
        return null;
    }
}
function isUdpAddress(value) {
    return (value &&
        value.protocol === 'udp' &&
        typeof value.ip === 'string' &&
        typeof value.port === 'number' &&
        value.port > 0 &&
        value.port <= 65535);
}
function isTraversalOfferMessage(value) {
    return (value &&
        value.app === ADVERT_PROTOCOL &&
        value.eventKind === TRAVERSAL_SIGNAL_KIND &&
        value.type === 'offer' &&
        typeof value.sessionId === 'string' &&
        typeof value.nonce === 'string' &&
        typeof value.senderNpub === 'string' &&
        typeof value.recipientNpub === 'string' &&
        (isUdpAddress(value.reflexiveAddress) || (Array.isArray(value.localAddresses) && value.localAddresses.some(isUdpAddress))));
}
function isTraversalAnswerMessage(value) {
    return (value &&
        value.app === ADVERT_PROTOCOL &&
        value.eventKind === TRAVERSAL_SIGNAL_KIND &&
        value.type === 'answer' &&
        typeof value.sessionId === 'string' &&
        typeof value.nonce === 'string' &&
        typeof value.inReplyTo === 'string' &&
        typeof value.senderNpub === 'string' &&
        typeof value.recipientNpub === 'string' &&
        typeof value.accepted === 'boolean');
}
function selectTraversalRemote(message) {
    if (isUdpAddress(message?.reflexiveAddress)) {
        return { host: message.reflexiveAddress.ip, port: message.reflexiveAddress.port };
    }
    if (Array.isArray(message?.localAddresses)) {
        const localCandidate = message.localAddresses.find(isUdpAddress);
        if (localCandidate)
            return { host: localCandidate.ip, port: localCandidate.port };
    }
    return null;
}
function isTraversalAdvertMessage(value) {
    return (value &&
        value.app === ADVERT_PROTOCOL &&
        typeof value.publisherNpub === 'string' &&
        typeof value.expiresAt === 'number' &&
        value.expiresAt > Date.now() &&
        Array.isArray(value.relays) &&
        Array.isArray(value.stunServers) &&
        Array.isArray(value.transports));
}
function parseInboxRelayListEvent(evt) {
    if (!evt || evt.kind !== INBOX_RELAYS_KIND || !Array.isArray(evt.tags))
        return null;
    const relays = evt.tags
        .filter((tag) => Array.isArray(tag) && tag[0] === 'relay' && typeof tag[1] === 'string')
        .map((tag) => tag[1])
        .filter(Boolean);
    if (relays.length === 0)
        return null;
    return {
        pubkey: evt.pubkey,
        relays: [...new Set(relays)],
        createdAt: Number(evt.created_at || 0),
        eventId: evt.id,
    };
}
function publishNostrEvent({ pool, relays, evt, logContext }) {
    Promise.allSettled(pool.publish(relays, evt))
        .then((results) => {
        if (!logContext)
            return;
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
function sortAdverts(adverts) {
    return [...adverts].sort((a, b) => {
        const bPublished = Number(b.publishedAt || 0);
        const aPublished = Number(a.publishedAt || 0);
        if (bPublished !== aPublished)
            return bPublished - aPublished;
        return Number(b.sequence || 0) - Number(a.sequence || 0);
    });
}
function publishDM({ pool, relays, sk, recipientPubkey, obj, logContext }) {
    const event = wrapEvent(sk, { publicKey: recipientPubkey }, JSON.stringify(obj));
    Promise.allSettled(pool.publish(relays, event))
        .then((results) => {
        if (!logContext)
            return;
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
    publishNostrEvent({ pool, relays, evt, logContext });
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
                }
                catch {
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
            if (rinfo.address !== this.remote.host || rinfo.port !== this.remote.port)
                return;
            if (msg.length < 5)
                return;
            if (msg.subarray(0, 5).toString() !== 'FIPS1')
                return;
            try {
                const frame = JSON.parse(msg.subarray(5).toString('utf8'));
                if (frame?.sessionId !== this.sessionId)
                    return;
                this.emit('frame', frame);
                if (frame?.channel)
                    this.emit(`channel:${frame.channel}`, frame.payload, frame);
            }
            catch {
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
        this.inboxLookupRelays = opts.inboxLookupRelays ?? [...new Set([...this.dmRelays, ...this.advertRelays])];
        this.relays = [...new Set([...this.advertRelays, ...this.dmRelays])];
        this.trustedNpubs = new Set(opts.trustedNpubs ?? []);
        this.publicHost = opts.publicHost;
        this.udpPort = opts.udpPort ?? 9999;
        this.punchIntervalMs = opts.punchIntervalMs ?? 300;
        this.punchDurationMs = opts.punchDurationMs ?? 30000;
        this.punchStartDelayMs = opts.punchStartDelayMs ?? 3000;
        this.stunPort = opts.stunPort ?? 3478;
        this.stunUri = opts.stunUri || null;
        const configuredStunServers = opts.stunServers ?? (this.stunUri ? [this.stunUri] : (this.publicHost ? [] : DEFAULT_STUN_SERVERS));
        this.stunServers = [...new Set(configuredStunServers)];
        this.stunTimeoutMs = opts.stunTimeoutMs ?? 2000;
        this.stunRefreshMs = opts.stunRefreshMs ?? 60 * 1000;
        this.advertise = opts.advertise !== false;
        this.advertiseIntervalMs = opts.advertiseIntervalMs ?? 5 * 60 * 1000;
        this.advertiseTtlMs = opts.advertiseTtlMs ?? 10 * 60 * 1000;
        this.publishInboxRelays = opts.publishInboxRelays !== false;
        this.sk = opts.nsec ? nip19.decode(opts.nsec).data : generateSecretKey();
        this.pubkey = getPublicKey(this.sk);
        this.npub = nip19.npubEncode(this.pubkey);
        this.pool = null;
        this.socket = dgram.createSocket('udp4');
        this.punchSessions = new Map();
        this.sessions = new Map();
        this.advertTimer = null;
        this.advertCache = new Map();
        this.inboxRelayCache = new Map();
        this.pendingTraversalResponses = new Map();
        this.punchHashToNonce = new Map();
        this.punchTimers = new Set();
        this.stunObservation = null;
        this.stunObservedAt = 0;
        this.lastAdvertEventId = null;
        this.lastInboxRelaysEventId = null;
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
        await this._refreshTraversalObservation({ force: true });
        this.socket.on('message', (msg, rinfo) => {
            const pkt = parsePacket(msg);
            if (!pkt || !pkt.t)
                return;
            const punchNonce = pkt.n || this.punchHashToNonce.get(pkt.h);
            if (!punchNonce)
                return;
            if (pkt.t === 'PROBE') {
                this.socket.send(buildPunchPacket(PUNCH_ACK_MAGIC, punchNonce), rinfo.port, rinfo.address);
                this.punchSessions.set(punchNonce, { established: true, remote: { host: rinfo.address, port: rinfo.port } });
                this.emit('punch', { nonce: punchNonce, remote: { host: rinfo.address, port: rinfo.port } });
                if (!this.sessions.has(punchNonce)) {
                    const session = new FipsStackSession({ socket: this.socket, remote: { host: rinfo.address, port: rinfo.port }, sessionId: punchNonce });
                    this.sessions.set(punchNonce, session);
                    this.emit('session', { sessionId: punchNonce, remote: { host: rinfo.address, port: rinfo.port }, session });
                }
            }
            if (pkt.t === 'PROBE_ACK') {
                this.punchSessions.set(punchNonce, { established: true, remote: { host: rinfo.address, port: rinfo.port } });
                this.emit('punch', { nonce: punchNonce, remote: { host: rinfo.address, port: rinfo.port } });
                if (!this.sessions.has(punchNonce)) {
                    const session = new FipsStackSession({ socket: this.socket, remote: { host: rinfo.address, port: rinfo.port }, sessionId: punchNonce });
                    this.sessions.set(punchNonce, session);
                    this.emit('session', { sessionId: punchNonce, remote: { host: rinfo.address, port: rinfo.port }, session });
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
                            await this._refreshTraversalObservation();
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
                            await this._refreshTraversalObservation();
                            const local = this.socket.address();
                            const now = Date.now();
                            const traversal = this._resolveTraversalCandidates();
                            const primaryAddress = traversal.reflexiveAddress || traversal.localAddresses[0] || {
                                protocol: 'udp',
                                ip: publicHostHint(this.publicHost),
                                port: local.port,
                            };
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
                                endpoint: { host: primaryAddress.ip, port: primaryAddress.port },
                                ...(wants.stunInfo
                                    ? { stun: { uri: this.stunObservation?.server || this.stunServers[0] || this.stunUri || `stun:${primaryAddress.ip}:${this.stunPort}`, metadataTag: 'stun' } }
                                    : {}),
                                ...(wants.fipsConnect ? { punch } : {}),
                            };
                            console.log('[rendezvous] hello received', JSON.stringify({
                                fromNpub,
                                nonce: msg.nonce,
                                sessionId: msg.sessionId || msg.nonce,
                                wants,
                                hasClientEndpoint: Boolean(msg?.clientEndpoint?.host && msg?.clientEndpoint?.port),
                            }));
                            this._publishDM(rumor.pubkey, reply, {
                                kind: 'server-info',
                                nonce: reply.nonce,
                                sessionId: reply.sessionId,
                                toPubkey: rumor.pubkey,
                            });
                            console.log('[rendezvous] server-info published', JSON.stringify({
                                toPubkey: rumor.pubkey,
                                nonce: reply.nonce,
                                sessionId: reply.sessionId,
                                endpoint: reply.endpoint,
                                hasStun: Boolean(reply.stun),
                                hasPunch: Boolean(reply.punch),
                            }));
                            if (wants.fipsConnect && msg?.clientEndpoint?.host && msg?.clientEndpoint?.port) {
                                this._startPunch(msg.nonce, msg.clientEndpoint, punch);
                            }
                        }
                    }
                    catch {
                        // ignore
                    }
                },
            },
        });
        this.advertSub = this.pool.subscribeMany(this.advertRelays, { kinds: [ADVERT_KIND], since: Math.floor(Date.now() / 1000) - 3 * 24 * 60 * 60 }, {
            onevent: (evt) => {
                this._handleAdvertEvent(evt);
            },
        });
        if (this.publishInboxRelays) {
            this._publishInboxRelayList();
        }
        if (this.advertise) {
            this._publishAdvert();
            this.advertTimer = setInterval(() => this._publishAdvert(), this.advertiseIntervalMs);
        }
        return { npub: this.npub, udpPort: this.socket.address().port };
    }
    async findAdvertisedPeer(targetNpub, opts = {}) {
        const target = nip19.decode(targetNpub);
        if (target.type !== 'npub')
            throw new Error('target must be npub');
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
            return await this._collectAdvertisedPeersOnce({ waitMs, settleMs, excludedNpubs, filter, maxPeers });
        }
        return await this._collectAdvertisedPeersOnce({ waitMs, settleMs, excludedNpubs, filter, maxPeers });
    }
    async _collectAdvertisedPeersOnce({ waitMs, settleMs, excludedNpubs, filter, maxPeers }) {
        return await new Promise((resolve) => {
            let timeout = null;
            let settleTimer = null;
            let sub = null;
            const finish = () => {
                if (timeout)
                    clearTimeout(timeout);
                if (settleTimer)
                    clearTimeout(settleTimer);
                try {
                    sub?.close();
                }
                catch { }
                resolve(this._selectAdvertisedPeers({ excludedNpubs, filter, maxPeers }));
            };
            sub = this.pool.subscribeMany(this.advertRelays, { kinds: [ADVERT_KIND], since: Math.floor(Date.now() / 1000) - 3 * 24 * 60 * 60 }, {
                onevent: (evt) => {
                    try {
                        this._handleAdvertEvent(evt);
                        const matches = this._selectAdvertisedPeers({ excludedNpubs, filter, maxPeers });
                        if (matches.length === 0)
                            return;
                        if (settleMs <= 0) {
                            finish();
                            return;
                        }
                        if (settleTimer)
                            clearTimeout(settleTimer);
                        settleTimer = setTimeout(() => finish(), settleMs);
                    }
                    catch {
                        // ignore malformed adverts
                    }
                },
            });
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
        if (!isTraversalAdvertMessage(advert))
            throw new Error('invalid traversal advert');
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
        if (targetNpub === this.npub)
            throw new Error('refusing to connect to self');
        const target = nip19.decode(targetNpub);
        if (target.type !== 'npub')
            throw new Error('target must be npub');
        const targetPubkey = target.data;
        await this._refreshTraversalObservation();
        const offer = this._buildTraversalOffer(targetNpub);
        const hello = this._buildLegacyHello(offer);
        const waitMs = opts.waitMs || 60000;
        const retryMs = opts.retryMs || 5000;
        const dmRelays = opts.dmRelays ?? await this.findRecipientInboxRelays(targetNpub, {
            waitMs: opts.inboxWaitMs || 1500,
            fallbackRelays: this.dmRelays,
        });
        const response = await new Promise((resolve, reject) => {
            const started = Date.now();
            let timer;
            const closePending = () => {
                if (timer)
                    clearInterval(timer);
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
            }
            else {
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
                                }))
                                    return;
                                closePending();
                                try {
                                    tempSub.close();
                                }
                                catch { }
                                resolve(msg);
                            }
                            catch {
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
                    try {
                        tempSub?.close();
                    }
                    catch { }
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
            if (!response.accepted)
                throw new Error(response.reason || 'traversal rejected');
            remote = selectTraversalRemote(response);
            punch = response.punch;
        }
        else {
            remote = response.endpoint;
            punch = response.punch;
        }
        if (!remote?.host || !remote?.port)
            throw new Error('remote endpoint missing from traversal response');
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
        if (existing?.established)
            return Promise.resolve(existing);
        return new Promise((resolve) => {
            const onPunch = ({ nonce, remote }) => {
                if (nonce !== nonceValue)
                    return;
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
        const punchHash = createHash('sha256').update(String(nonceValue)).digest().subarray(0, 16).toString('hex');
        this.punchHashToNonce.set(punchHash, nonceValue);
        const startTimer = setTimeout(() => {
            this.punchTimers.delete(startTimer);
            const tick = setInterval(() => {
                this.socket.send(buildPunchPacket(PUNCH_MAGIC, nonceValue), remote.port, remote.host);
            }, intervalMs);
            this.punchTimers.add(tick);
            const stopTimer = setTimeout(() => {
                clearInterval(tick);
                this.punchTimers.delete(tick);
                this.punchTimers.delete(stopTimer);
            }, durationMs);
            this.punchTimers.add(stopTimer);
        }, Math.max(0, startAtMs - Date.now()));
        this.punchTimers.add(startTimer);
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
        const traversal = this._resolveTraversalCandidates();
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
            reflexiveAddress: traversal.reflexiveAddress,
            localAddresses: traversal.localAddresses,
        };
    }
    _buildLegacyHello(offer) {
        const clientEndpoint = offer.reflexiveAddress || offer.localAddresses?.[0];
        return {
            type: 'fips.rendezvous.hello',
            version: '1.0',
            sessionId: offer.sessionId,
            nonce: offer.nonce,
            issuedAt: offer.issuedAt,
            wants: { stunInfo: true, fipsConnect: true },
            clientEndpoint: clientEndpoint ? { host: clientEndpoint.ip, port: clientEndpoint.port } : undefined,
        };
    }
    _buildTraversalAnswer({ offer, now = Date.now() }) {
        const traversal = this._resolveTraversalCandidates();
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
            reflexiveAddress: traversal.reflexiveAddress,
            localAddresses: traversal.localAddresses,
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
    async _refreshTraversalObservation(opts = {}) {
        if (this.stunServers.length === 0)
            return this.stunObservation;
        if (!opts.force && this.stunObservation && Date.now() - this.stunObservedAt < this.stunRefreshMs) {
            return this.stunObservation;
        }
        const baseObservation = {
            localPort: this.socket.address().port,
            localInterfaceAddresses: localIpv4Addresses(),
        };
        for (const server of this.stunServers) {
            try {
                const reflexiveAddress = await this._probeStunServer(server, opts.timeoutMs || this.stunTimeoutMs);
                this.stunObservation = { ...baseObservation, server, reflexiveAddress };
                this.stunObservedAt = Date.now();
                return this.stunObservation;
            }
            catch {
                // keep trying the next server
            }
        }
        this.stunObservation = { ...baseObservation, server: this.stunServers[0] };
        this.stunObservedAt = Date.now();
        return this.stunObservation;
    }
    async _probeStunServer(stunUrl, timeoutMs) {
        const { host, port } = parseStunUrl(stunUrl);
        const txnId = randomBytes(12);
        const request = createStunBindingRequest(txnId);
        return await new Promise((resolve, reject) => {
            const onMessage = (msg) => {
                const mapped = parseStunBindingSuccess(msg, txnId);
                if (!mapped)
                    return;
                cleanup();
                resolve(mapped);
            };
            const onError = (err) => {
                cleanup();
                reject(err);
            };
            const cleanup = () => {
                clearTimeout(timer);
                this.socket.off('message', onMessage);
                this.socket.off('error', onError);
            };
            const timer = setTimeout(() => {
                cleanup();
                reject(new Error(`stun timeout to ${host}:${port}`));
            }, timeoutMs);
            this.socket.on('message', onMessage);
            this.socket.on('error', onError);
            this.socket.send(request, port, host, (err) => {
                if (err) {
                    cleanup();
                    reject(err);
                }
            });
        });
    }
    async findRecipientInboxRelays(targetNpub, opts = {}) {
        if (!targetNpub)
            return opts.fallbackRelays ?? this.dmRelays;
        if (!this.pool?.subscribeMany)
            return opts.fallbackRelays ?? this.dmRelays;
        const decoded = nip19.decode(targetNpub);
        if (decoded.type !== 'npub')
            return opts.fallbackRelays ?? this.dmRelays;
        const targetPubkey = decoded.data;
        const cached = this.inboxRelayCache.get(targetPubkey);
        if (cached?.relays?.length) {
            return cached.relays;
        }
        const waitMs = opts.waitMs || 1500;
        const fallbackRelays = opts.fallbackRelays ?? this.dmRelays;
        return await new Promise((resolve) => {
            let best = null;
            let settled = false;
            let timer = null;
            let sub = null;
            const finish = () => {
                if (settled)
                    return;
                settled = true;
                if (timer)
                    clearTimeout(timer);
                try {
                    sub?.close();
                }
                catch { }
                if (best?.relays?.length) {
                    this.inboxRelayCache.set(targetPubkey, best);
                    resolve(best.relays);
                    return;
                }
                resolve(fallbackRelays);
            };
            sub = this.pool.subscribeMany(this.inboxLookupRelays, { kinds: [INBOX_RELAYS_KIND], authors: [targetPubkey], since: Math.floor(Date.now() / 1000) - 30 * 24 * 60 * 60 }, {
                onevent: (evt) => {
                    const parsed = parseInboxRelayListEvent(evt);
                    if (!parsed || parsed.pubkey !== targetPubkey)
                        return;
                    if (!best || parsed.createdAt >= best.createdAt) {
                        best = parsed;
                    }
                },
                oneose: finish,
            });
            timer = setTimeout(() => finish(), waitMs);
        });
    }
    _resolveTraversalCandidates() {
        const local = this.socket.address();
        const localAddresses = localIpv4Addresses()
            .filter((ip) => ip !== this.stunObservation?.reflexiveAddress?.ip)
            .map((ip) => ({ protocol: 'udp', ip, port: local.port }));
        let reflexiveAddress = this.stunObservation?.reflexiveAddress
            ? { protocol: 'udp', ip: this.stunObservation.reflexiveAddress.ip, port: this.stunObservation.reflexiveAddress.port }
            : undefined;
        if (!reflexiveAddress && this.publicHost) {
            reflexiveAddress = {
                protocol: 'udp',
                ip: this.publicHost,
                port: local.port,
            };
        }
        if (localAddresses.length === 0) {
            localAddresses.push({
                protocol: 'udp',
                ip: publicHostHint(this.publicHost),
                port: local.port,
            });
        }
        return { reflexiveAddress, localAddresses };
    }
    _resolveTraversalAddress() {
        const traversal = this._resolveTraversalCandidates();
        return traversal.reflexiveAddress || traversal.localAddresses[0];
    }
    close() {
        if (this.advertTimer)
            clearInterval(this.advertTimer);
        if (this.lastAdvertEventId) {
            this._publishDeletion([this.lastAdvertEventId], this.advertRelays, 'traversal advert shutdown');
        }
        if (this.lastInboxRelaysEventId) {
            this._publishDeletion([this.lastInboxRelaysEventId], this.inboxLookupRelays, 'inbox relay list shutdown');
        }
        this.sub?.close();
        this.advertSub?.close();
        this.pool?.close(this.relays);
        for (const s of this.sessions.values())
            s.close();
        this.sessions.clear();
        this.advertCache.clear();
        this.inboxRelayCache.clear();
        this.pendingTraversalResponses.clear();
        this.punchHashToNonce.clear();
        for (const timer of this.punchTimers) {
            clearTimeout(timer);
            clearInterval(timer);
        }
        this.punchTimers.clear();
        this.socket.close();
    }
    _publishAdvert() {
        const local = this.socket.address();
        const now = Date.now();
        const traversal = this._resolveTraversalCandidates();
        const primaryAddress = traversal.reflexiveAddress || traversal.localAddresses[0] || {
            protocol: 'udp',
            ip: publicHostHint(this.publicHost),
            port: local.port,
        };
        const advert = {
            app: ADVERT_PROTOCOL,
            eventKind: ADVERT_KIND,
            protocol: ADVERT_PROTOCOL,
            publisherNpub: this.npub,
            publishedAt: now,
            expiresAt: now + this.advertiseTtlMs,
            sequence: now,
            relays: this.dmRelays,
            stunServers: this.stunServers,
            transports: ['udp'],
            endpointHint: { host: primaryAddress.ip, port: primaryAddress.port },
        };
        const evt = finalizeEvent({
            kind: ADVERT_KIND,
            created_at: Math.floor(now / 1000),
            tags: [
                ['d', `fips-traversal:${this.npub}`],
                ['t', 'fips'],
                ['t', 'traversal'],
                ['expiration', String(Math.floor((now + this.advertiseTtlMs) / 1000))],
            ],
            content: JSON.stringify(advert),
        }, this.sk);
        if (this.lastAdvertEventId && this.lastAdvertEventId !== evt.id) {
            this._publishDeletion([this.lastAdvertEventId], this.advertRelays, 'superseded traversal advert');
        }
        this.lastAdvertEventId = evt.id;
        publishEvent({
            pool: this.pool,
            relays: this.advertRelays,
            sk: this.sk,
            evt,
            logContext: { kind: 'advert', npub: this.npub },
        });
    }
    _publishInboxRelayList() {
        const evt = finalizeEvent({
            kind: INBOX_RELAYS_KIND,
            created_at: Math.floor(Date.now() / 1000),
            tags: this.dmRelays.map((relay) => ['relay', relay]),
            content: '',
        }, this.sk);
        if (this.lastInboxRelaysEventId && this.lastInboxRelaysEventId !== evt.id) {
            this._publishDeletion([this.lastInboxRelaysEventId], this.inboxLookupRelays, 'superseded inbox relay list');
        }
        this.lastInboxRelaysEventId = evt.id;
        publishNostrEvent({
            pool: this.pool,
            relays: this.inboxLookupRelays,
            evt,
            logContext: { kind: 'inbox-relays', npub: this.npub },
        });
    }
    _publishDeletion(eventIds, relays, reason) {
        if (!this.pool || !eventIds?.length)
            return;
        const evt = finalizeEvent({
            kind: NIP09_DELETE_KIND,
            created_at: Math.floor(Date.now() / 1000),
            tags: eventIds.map((id) => ['e', id]),
            content: reason || '',
        }, this.sk);
        publishNostrEvent({
            pool: this.pool,
            relays,
            evt,
            logContext: { kind: 'delete', eventIds, reason },
        });
    }
    _handleAdvertEvent(evt) {
        try {
            const msg = JSON.parse(evt.content);
            if (!isTraversalAdvertMessage(msg))
                return false;
            const existing = this.advertCache.get(msg.publisherNpub);
            if (!existing || sortAdverts([msg, existing])[0] === msg) {
                this.advertCache.set(msg.publisherNpub, msg);
                this.emit('advert:update', msg);
            }
            return true;
        }
        catch {
            return false;
        }
    }
    _selectAdvertisedPeers({ excludedNpubs = new Set(), filter = () => true, maxPeers = 20 } = {}) {
        return sortAdverts([...this.advertCache.values()].filter((msg) => !excludedNpubs.has(msg.publisherNpub) && filter(msg))).slice(0, maxPeers);
    }
    _matchesPendingTraversalResponse({ entry, msg, rumorPubkey }) {
        if (rumorPubkey !== entry.targetPubkey)
            return false;
        if (isTraversalAnswerMessage(msg)) {
            return (msg.sessionId === entry.sessionId &&
                msg.inReplyTo === entry.nonce &&
                msg.recipientNpub === entry.recipientNpub);
        }
        return msg?.type === 'fips.rendezvous.server-info' && msg?.nonce === entry.nonce;
    }
    _resolvePendingTraversalResponse(msg, rumorPubkey) {
        const key = isTraversalAnswerMessage(msg) ? msg.inReplyTo : msg?.nonce;
        if (!key)
            return false;
        const entry = this.pendingTraversalResponses.get(key);
        if (!entry)
            return false;
        if (!this._matchesPendingTraversalResponse({ entry, msg, rumorPubkey }))
            return false;
        entry.resolve(msg);
        return true;
    }
}
export function createFipsNostrRendezvousNode(options) {
    return new FipsNostrRendezvousNode(options);
}
