#!/usr/bin/env node
import dgram from 'node:dgram';
import os from 'node:os';
import { performance } from 'node:perf_hooks';
import { SimplePool, finalizeEvent, generateSecretKey, getPublicKey, nip19 } from 'nostr-tools';
import { useWebSocketImplementation } from 'nostr-tools/relay';
import { wrapEvent, unwrapEvent } from 'nostr-tools/nip17';

async function ensureWebSocketSupport() {
  if (typeof globalThis.WebSocket !== 'undefined') {
    useWebSocketImplementation(globalThis.WebSocket);
    return;
  }
  const ws = await import('ws');
  const WS = ws.WebSocket || ws.default;
  globalThis.WebSocket = WS;
  useWebSocketImplementation(WS);
}

function parseArgs() {
  const args = process.argv.slice(2);
  const out = {
    mode: 'client',
    npub: '',
    port: 9999,
    host: '0.0.0.0',
    rounds: 10,
    payloadBytes: 64,
    warmup: 20,
    timeoutMs: 3000,
    waitMs: 30000,
    showEndpoints: false,
    debug: false,
    retryMs: 5000,
    punchIntervalMs: 300,
    punchDurationMs: 30000,
    punchStartDelayMs: 3000,
    duplexBytes: 10 * 1024 * 1024,
    duplexChunkBytes: 1200,
    duplexIntervalMs: 0,
    duplexTimeoutMs: 90000,
  };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    const v = args[i + 1];
    if (a === '--mode' && v) out.mode = v;
    if (a === '--npub' && v) out.npub = v;
    if (a === '--port' && Number.isFinite(Number(v))) out.port = Number(v);
    if (a === '--host' && v) out.host = v;
    if (a === '--rounds' && Number.isFinite(Number(v))) out.rounds = Number(v);
    if (a === '--payload' && Number.isFinite(Number(v))) out.payloadBytes = Number(v);
    if (a === '--warmup' && Number.isFinite(Number(v))) out.warmup = Number(v);
    if (a === '--timeout' && Number.isFinite(Number(v))) out.timeoutMs = Number(v);
    if (a === '--wait' && Number.isFinite(Number(v))) out.waitMs = Number(v);
    if (a === '--retry-ms' && Number.isFinite(Number(v))) out.retryMs = Number(v);
    if (a === '--punch-interval-ms' && Number.isFinite(Number(v))) out.punchIntervalMs = Number(v);
    if (a === '--punch-duration-ms' && Number.isFinite(Number(v))) out.punchDurationMs = Number(v);
    if (a === '--punch-start-delay-ms' && Number.isFinite(Number(v))) out.punchStartDelayMs = Number(v);
    if (a === '--duplex-bytes' && Number.isFinite(Number(v))) out.duplexBytes = Number(v);
    if (a === '--duplex-chunk-bytes' && Number.isFinite(Number(v))) out.duplexChunkBytes = Number(v);
    if (a === '--duplex-interval-ms' && Number.isFinite(Number(v))) out.duplexIntervalMs = Number(v);
    if (a === '--duplex-timeout-ms' && Number.isFinite(Number(v))) out.duplexTimeoutMs = Number(v);
    if (a === '--show-endpoints') out.showEndpoints = true;
    if (a === '--debug') out.debug = true;
  }
  return out;
}

function resolveSecretKey() {
  const nsec = process.env.NOSTR_NSEC;
  if (!nsec) return { sk: generateSecretKey(), source: 'generated-ephemeral' };
  const decoded = nip19.decode(nsec);
  if (decoded.type !== 'nsec') throw new Error('NOSTR_NSEC must be valid nsec');
  return { sk: decoded.data, source: 'env-nsec' };
}

function relaysFromEnv() {
  const raw = process.env.NOSTR_RELAYS || 'wss://relay.damus.io,wss://nos.lol,wss://relay.primal.net,wss://nip17.tomdwyer.uk';
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

function createPoolWithAuth(sk, debugLog) {
  return new SimplePool({
    automaticallyAuth: (relayUrl) => async (authTemplate) => {
      debugLog?.('nip42-auth', { relayUrl });
      return finalizeEvent(authTemplate, sk);
    },
  });
}

function publicHostHint() {
  if (process.env.FIPS_UDP_PUBLIC_HOST) return process.env.FIPS_UDP_PUBLIC_HOST;
  const ifaces = os.networkInterfaces();
  for (const list of Object.values(ifaces)) {
    if (!list) continue;
    for (const addr of list) {
      if (addr.family === 'IPv4' && !addr.internal) return addr.address;
    }
  }
  return '127.0.0.1';
}

function nonce() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function mean(values) {
  if (!values.length) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function percentile(values, p) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

async function bindSocket(socket, host, port) {
  await new Promise((resolve, reject) => {
    socket.once('error', reject);
    socket.bind(port, host, resolve);
  });
}

function publishDM({ pool, relays, sk, recipientPubkey, obj, debugLog }) {
  const event = wrapEvent(sk, { publicKey: recipientPubkey }, JSON.stringify(obj));
  debugLog?.('publish', { kind: event.kind, to: recipientPubkey, type: obj?.type, id: event.id });
  const pubs = pool.publish(relays, event);
  Promise.allSettled(pubs).then((results) => {
    const summary = results.map((r) => (r.status === 'fulfilled' ? 'ok' : String(r.reason))).slice(0, 8);
    debugLog?.('publish-result', { type: obj?.type, results: summary });
  });
}

function parseIncomingNip17(event, recipientSk) {
  const rumor = unwrapEvent(event, recipientSk);
  return { senderPubkey: rumor.pubkey, message: JSON.parse(rumor.content) };
}

function makeProbePacket(nonceValue, seq) {
  return Buffer.from(JSON.stringify({ t: 'PROBE', n: nonceValue, s: seq }));
}
function makeProbeAckPacket(nonceValue) {
  return Buffer.from(JSON.stringify({ t: 'PROBE_ACK', n: nonceValue }));
}
function makeStreamStartPacket(nonceValue, totalBytes, chunkBytes, intervalMs) {
  return Buffer.from(JSON.stringify({ t: 'STREAM_START', n: nonceValue, totalBytes, chunkBytes, intervalMs }));
}
function makeStreamDonePacket(nonceValue, sentBytes) {
  return Buffer.from(JSON.stringify({ t: 'STREAM_DONE', n: nonceValue, sentBytes }));
}
function makeDataPacket(seq, payload) {
  const h = Buffer.alloc(8);
  h.write('DATA', 0, 4, 'utf8');
  h.writeUInt32BE(seq, 4);
  return Buffer.concat([h, payload]);
}
function isDataPacket(buf) {
  return buf.length >= 8 && buf.subarray(0, 4).toString() === 'DATA';
}

function startDataSender({ socket, remote, nonceValue, totalBytes, chunkBytes, intervalMs, debugLog }) {
  const payload = Buffer.alloc(Math.max(64, chunkBytes), 0x55);
  let seq = 0;
  let sentBytes = 0;

  return new Promise((resolve) => {
    const sendOne = () => {
      if (sentBytes >= totalBytes) {
        socket.send(makeStreamDonePacket(nonceValue, sentBytes), remote.port, remote.host);
        debugLog?.('stream-sent-done', { nonce: nonceValue, sentBytes });
        resolve(sentBytes);
        return;
      }

      const remaining = totalBytes - sentBytes;
      const thisSize = Math.min(payload.length, remaining);
      const pkt = makeDataPacket(seq++, payload.subarray(0, thisSize));
      try {
        socket.send(pkt, remote.port, remote.host);
        sentBytes += thisSize;
      } catch {
        resolve(sentBytes);
        return;
      }

      if (intervalMs > 0) setTimeout(sendOne, intervalMs);
      else setImmediate(sendOne);
    };

    sendOne();
  });
}
function parseJsonPacket(buf) {
  try {
    return JSON.parse(buf.toString('utf8'));
  } catch {
    return null;
  }
}

function startPunching({ socket, remote, punchNonce, startAtMs, intervalMs, durationMs, debugLog }) {
  let seq = 0;
  let interval = null;
  let stopTimer = null;
  const beginIn = Math.max(0, startAtMs - Date.now());
  debugLog?.('punch-schedule', { remote, startAtMs, beginIn, intervalMs, durationMs });

  const starter = setTimeout(() => {
    interval = setInterval(() => {
      try {
        socket.send(makeProbePacket(punchNonce, seq++), remote.port, remote.host);
      } catch {
        // socket may have been closed; stop punching silently
        if (interval) clearInterval(interval);
      }
    }, intervalMs);

    stopTimer = setTimeout(() => {
      if (interval) clearInterval(interval);
      interval = null;
    }, durationMs);
  }, beginIn);

  return () => {
    clearTimeout(starter);
    if (interval) clearInterval(interval);
    if (stopTimer) clearTimeout(stopTimer);
  };
}

async function runServer(cfg) {
  const debugLog = cfg.debug ? (label, data = {}) => console.error(`[debug][server] ${label}`, data) : null;
  const { sk, source: keySource } = resolveSecretKey();
  const relays = relaysFromEnv();
  const pool = createPoolWithAuth(sk, debugLog);
  const senderPubkey = getPublicKey(sk);

  const socket = dgram.createSocket('udp4');
  await bindSocket(socket, cfg.host, cfg.port);
  const addr = socket.address();
  const advertiseHost = publicHostHint();
  const activePunch = new Map();
  const stopPunchers = new Map();
  const streamStats = new Map();

  let pings = 0;
  socket.on('message', (msg, rinfo) => {
    const txt = msg.subarray(0, 4).toString();
    if (txt === 'PING') {
      pings += 1;
      const pong = Buffer.concat([Buffer.from('PONG'), msg.subarray(4)]);
      socket.send(pong, rinfo.port, rinfo.address);
      return;
    }

    if (isDataPacket(msg)) {
      for (const st of streamStats.values()) st.receivedBytes += msg.length - 8;
      return;
    }

    const pkt = parseJsonPacket(msg);
    if (!pkt?.t || !pkt?.n) return;

    if (pkt.t === 'PROBE') {
      debugLog?.('punch-probe-recv', { from: `${rinfo.address}:${rinfo.port}`, nonce: pkt.n, seq: pkt.s });
      socket.send(makeProbeAckPacket(pkt.n), rinfo.port, rinfo.address);
      const st = activePunch.get(pkt.n) || {};
      st.established = true;
      st.remote = { host: rinfo.address, port: rinfo.port };
      activePunch.set(pkt.n, st);
      return;
    }

    if (pkt.t === 'PROBE_ACK') {
      debugLog?.('punch-ack-recv', { from: `${rinfo.address}:${rinfo.port}`, nonce: pkt.n });
      const st = activePunch.get(pkt.n) || {};
      st.established = true;
      st.remote = { host: rinfo.address, port: rinfo.port };
      activePunch.set(pkt.n, st);
      return;
    }

    if (pkt.t === 'STREAM_START') {
      debugLog?.('stream-start-recv', { nonce: pkt.n, from: `${rinfo.address}:${rinfo.port}`, totalBytes: pkt.totalBytes });
      const st = { receivedBytes: 0, remoteDone: false, remoteSentBytes: 0 };
      streamStats.set(pkt.n, st);
      startDataSender({
        socket,
        remote: { host: rinfo.address, port: rinfo.port },
        nonceValue: pkt.n,
        totalBytes: pkt.totalBytes,
        chunkBytes: pkt.chunkBytes,
        intervalMs: pkt.intervalMs,
        debugLog,
      });
      return;
    }

    if (pkt.t === 'STREAM_DONE') {
      const st = streamStats.get(pkt.n) || { receivedBytes: 0, remoteDone: false, remoteSentBytes: 0 };
      st.remoteDone = true;
      st.remoteSentBytes = pkt.sentBytes || 0;
      streamStats.set(pkt.n, st);
      debugLog?.('stream-done-recv', { nonce: pkt.n, remoteSentBytes: st.remoteSentBytes, receivedBytes: st.receivedBytes });
    }
  });

  const sub = pool.subscribeMany(
    relays,
    { kinds: [1059], '#p': [senderPubkey], since: Math.floor(Date.now() / 1000) - 3 * 24 * 60 * 60 },
    {
      onevent: async (evt) => {
        debugLog?.('recv-event', { id: evt.id, kind: evt.kind, pubkey: evt.pubkey });
        try {
          const { senderPubkey: fromPubkey, message: msg } = parseIncomingNip17(evt, sk);
          debugLog?.('recv-msg', { fromPubkey, type: msg?.type, nonce: msg?.nonce });
          if (msg?.type !== 'fips.udp.test.hello' || !msg?.nonce || !msg?.clientEndpoint) return;

          const startAtMs = Date.now() + cfg.punchStartDelayMs;
          activePunch.set(msg.nonce, { established: false, remote: msg.clientEndpoint });
          const stopPunch = startPunching({
            socket,
            remote: msg.clientEndpoint,
            punchNonce: msg.nonce,
            startAtMs,
            intervalMs: cfg.punchIntervalMs,
            durationMs: cfg.punchDurationMs,
            debugLog,
          });
          stopPunchers.set(msg.nonce, stopPunch);

          const reply = {
            type: 'fips.udp.test.server-info',
            nonce: msg.nonce,
            endpoint: { host: advertiseHost, port: addr.port },
            punch: {
              startAtMs,
              intervalMs: cfg.punchIntervalMs,
              durationMs: cfg.punchDurationMs,
            },
            issuedAt: Date.now(),
          };

          publishDM({ pool, relays, sk, recipientPubkey: fromPubkey, obj: reply, debugLog });
        } catch (err) {
          debugLog?.('recv-parse-failed', { err: String(err?.message || err) });
        }
      },
      oneose: () => debugLog?.('eose'),
      onclose: (reasons) => debugLog?.('sub-close', { reasons }),
    },
  );

  console.log(
    JSON.stringify(
      {
        mode: 'server',
        relayCount: relays.length,
        identity: nip19.npubEncode(senderPubkey),
        keySource,
        listening: cfg.showEndpoints ? `${addr.address}:${addr.port}` : '[hidden]',
        advertisedEndpoint: cfg.showEndpoints ? `${advertiseHost}:${addr.port}` : '[hidden-discovered-via-dm]',
        note: 'Client only needs --npub. Stop with Ctrl+C.',
      },
      null,
      2,
    ),
  );

  process.on('SIGINT', () => {
    sub.close();
    pool.close(relays);
    for (const stop of stopPunchers.values()) stop();
    stopPunchers.clear();
    const report = { mode: 'server', pingsHandled: pings };
    console.log(JSON.stringify(report, null, 2));
    socket.close(() => process.exit(0));
  });
}

async function runClient(cfg) {
  const debugLog = cfg.debug ? (label, data = {}) => console.error(`[debug][client] ${label}`, data) : null;
  if (!cfg.npub) throw new Error('--npub is required in client mode');
  const decoded = nip19.decode(cfg.npub);
  if (decoded.type !== 'npub') throw new Error('--npub must be valid npub');
  const serverPubkey = decoded.data;

  const { sk, source: keySource } = resolveSecretKey();
  const relays = relaysFromEnv();
  const pool = createPoolWithAuth(sk, debugLog);
  const senderPubkey = getPublicKey(sk);

  const helloNonce = nonce();

  const socket = dgram.createSocket('udp4');
  await bindSocket(socket, '0.0.0.0', 0);
  const localAddr = socket.address();
  const clientCandidate = { host: publicHostHint(), port: localAddr.port };

  const punchState = { established: false, remote: null, nonce: null };
  const duplexState = { nonce: helloNonce, receivedBytes: 0, remoteDone: false, remoteSentBytes: 0 };

  socket.on('message', (msg, rinfo) => {
    const txt = msg.subarray(0, 4).toString();
    if (txt === 'PONG') return;

    if (isDataPacket(msg)) {
      duplexState.receivedBytes += msg.length - 8;
      return;
    }

    const pkt = parseJsonPacket(msg);
    if (!pkt?.t || !pkt?.n) return;
    if (pkt.t === 'PROBE') {
      debugLog?.('punch-probe-recv', { from: `${rinfo.address}:${rinfo.port}`, nonce: pkt.n, seq: pkt.s });
      socket.send(makeProbeAckPacket(pkt.n), rinfo.port, rinfo.address);
      punchState.established = true;
      punchState.remote = { host: rinfo.address, port: rinfo.port };
      punchState.nonce = pkt.n;
      return;
    }
    if (pkt.t === 'PROBE_ACK') {
      debugLog?.('punch-ack-recv', { from: `${rinfo.address}:${rinfo.port}`, nonce: pkt.n });
      punchState.established = true;
      punchState.remote = { host: rinfo.address, port: rinfo.port };
      punchState.nonce = pkt.n;
      return;
    }
    if (pkt.t === 'STREAM_DONE' && pkt.n === duplexState.nonce) {
      duplexState.remoteDone = true;
      duplexState.remoteSentBytes = pkt.sentBytes || 0;
      debugLog?.('stream-done-recv', { nonce: pkt.n, remoteSentBytes: duplexState.remoteSentBytes, receivedBytes: duplexState.receivedBytes });
    }
  });

  const serverInfo = await new Promise(async (resolve, reject) => {
    const started = Date.now();
    const since = Math.floor(Date.now() / 1000) - 3 * 24 * 60 * 60;
    let timer;

    const sub = pool.subscribeMany(relays, { kinds: [1059], '#p': [senderPubkey], since }, {
      onevent: async (evt) => {
        debugLog?.('recv-event', { id: evt.id, kind: evt.kind, pubkey: evt.pubkey });
        try {
          const { senderPubkey: fromPubkey, message: msg } = parseIncomingNip17(evt, sk);
          debugLog?.('recv-msg', { fromPubkey, type: msg?.type, nonce: msg?.nonce });
          if (fromPubkey !== serverPubkey) return;
          if (msg?.type !== 'fips.udp.test.server-info') return;
          if (msg?.nonce !== helloNonce) return;
          if (timer) clearInterval(timer);
          sub.close();
          resolve(msg);
        } catch (err) {
          debugLog?.('recv-parse-failed', { err: String(err?.message || err) });
        }
      },
      oneose: () => debugLog?.('eose'),
      onclose: (reasons) => debugLog?.('sub-close', { reasons }),
    });

    const hello = {
      type: 'fips.udp.test.hello',
      nonce: helloNonce,
      want: 'udp-endpoint',
      clientEndpoint: clientCandidate,
    };
    publishDM({ pool, relays, sk, recipientPubkey: serverPubkey, obj: hello, debugLog });

    let nextRepublishAt = Date.now() + cfg.retryMs;
    timer = setInterval(() => {
      const now = Date.now();
      if (now - started > cfg.waitMs) {
        clearInterval(timer);
        sub.close();
        reject(new Error('timed out waiting for server-info DM'));
        return;
      }
      if (now >= nextRepublishAt) {
        publishDM({ pool, relays, sk, recipientPubkey: serverPubkey, obj: hello, debugLog });
        nextRepublishAt = now + cfg.retryMs;
      }
    }, 250);
  });

  const stopPunch = startPunching({
    socket,
    remote: serverInfo.endpoint,
    punchNonce: helloNonce,
    startAtMs: serverInfo.punch?.startAtMs || Date.now(),
    intervalMs: serverInfo.punch?.intervalMs || cfg.punchIntervalMs,
    durationMs: serverInfo.punch?.durationMs || cfg.punchDurationMs,
    debugLog,
  });

  const punchWaitStart = Date.now();
  while (!punchState.established && Date.now() - punchWaitStart < (serverInfo.punch?.durationMs || cfg.punchDurationMs) + 5000) {
    await new Promise((r) => setTimeout(r, 100));
  }

  const target = punchState.remote || serverInfo.endpoint;
  if (!punchState.established) debugLog?.('punch-not-established', { fallbackTarget: target });

  // Duplex ~video-call style stream: both peers send at same time
  const duplexStart = Date.now();
  socket.send(makeStreamStartPacket(helloNonce, cfg.duplexBytes, cfg.duplexChunkBytes, cfg.duplexIntervalMs), target.port, target.host);
  const localDuplexSentPromise = startDataSender({
    socket,
    remote: target,
    nonceValue: helloNonce,
    totalBytes: cfg.duplexBytes,
    chunkBytes: cfg.duplexChunkBytes,
    intervalMs: cfg.duplexIntervalMs,
    debugLog,
  });
  const localDuplexSent = await localDuplexSentPromise;

  const duplexWaitStart = Date.now();
  while (!duplexState.remoteDone && Date.now() - duplexWaitStart < cfg.duplexTimeoutMs) {
    await new Promise((r) => setTimeout(r, 100));
  }
  const duplexDurationMs = Date.now() - duplexStart;

  const payload = Buffer.alloc(Math.max(1, cfg.payloadBytes), 0x61);
  const rtts = [];
  let seq = 0;

  async function pingOnce() {
    return await new Promise((resolve, reject) => {
      const id = seq++;
      const idBuf = Buffer.alloc(4);
      idBuf.writeUInt32BE(id, 0);
      const packet = Buffer.concat([Buffer.from('PING'), idBuf, payload]);
      const started = performance.now();

      const timer = setTimeout(() => {
        socket.off('message', onMessage);
        reject(new Error(`timeout waiting for seq=${id}`));
      }, cfg.timeoutMs);

      function onMessage(msg) {
        if (msg.subarray(0, 4).toString() !== 'PONG') return;
        const got = msg.readUInt32BE(4);
        if (got !== id) return;
        clearTimeout(timer);
        socket.off('message', onMessage);
        resolve(performance.now() - started);
      }

      socket.on('message', onMessage);
      socket.send(packet, target.port, target.host);
    });
  }

  const setupStart = performance.now();
  const firstRtt = await pingOnce();
  const setupMs = performance.now() - setupStart;

  for (let i = 0; i < cfg.warmup; i++) await pingOnce();
  const benchStart = performance.now();
  for (let i = 0; i < cfg.rounds; i++) rtts.push(await pingOnce());
  const benchMs = performance.now() - benchStart;

  const totalBytes = cfg.rounds * (payload.length + 8) * 2;
  const throughputMbps = (totalBytes * 8) / (benchMs / 1000) / 1_000_000;

  stopPunch();
  socket.close();
  pool.close(relays);

  console.log(
    JSON.stringify(
      {
        mode: 'client',
        identity: nip19.npubEncode(senderPubkey),
        keySource,
        rendezvous: { viaNostrDM: true, serverNpub: cfg.npub, endpointDiscovered: true },
        punching: {
          established: punchState.established,
          selectedRemote: cfg.showEndpoints ? target : '[hidden]',
        },
        endpoints: cfg.showEndpoints
          ? { local: `${localAddr.address}:${localAddr.port}`, remote: `${target.host}:${target.port}` }
          : { local: '[hidden]', remote: '[hidden-discovered-via-dm]' },
        setup: { firstProbeRttMs: Number(firstRtt.toFixed(3)), setupTimeMs: Number(setupMs.toFixed(3)) },
        duplex: {
          requestedBytesEachWay: cfg.duplexBytes,
          localSentBytes: localDuplexSent,
          remoteSentBytes: duplexState.remoteSentBytes,
          localReceivedBytes: duplexState.receivedBytes,
          remoteDone: duplexState.remoteDone,
          durationMs: duplexDurationMs,
          localSendMbps: Number(((localDuplexSent * 8) / (duplexDurationMs / 1000) / 1_000_000).toFixed(3)),
          localReceiveMbps: Number(((duplexState.receivedBytes * 8) / (duplexDurationMs / 1000) / 1_000_000).toFixed(3)),
        },
        latency: {
          avgRttMs: Number(mean(rtts).toFixed(3)),
          p50RttMs: Number(percentile(rtts, 50).toFixed(3)),
          p95RttMs: Number(percentile(rtts, 95).toFixed(3)),
          p99RttMs: Number(percentile(rtts, 99).toFixed(3)),
          minRttMs: Number(Math.min(...rtts).toFixed(3)),
          maxRttMs: Number(Math.max(...rtts).toFixed(3)),
        },
        speed: {
          roundsCompleted: cfg.rounds,
          benchmarkDurationMs: Number(benchMs.toFixed(3)),
          estimatedThroughputMbps: Number(throughputMbps.toFixed(3)),
        },
      },
      null,
      2,
    ),
  );
}

async function main() {
  await ensureWebSocketSupport();
  const cfg = parseArgs();
  if (!['server', 'client'].includes(cfg.mode)) throw new Error('use --mode server|client');
  if (cfg.mode === 'server') return runServer(cfg);
  return runClient(cfg);
}

main().catch((err) => {
  console.error('[udp-transport-via-nostr] failed:', err.message);
  process.exit(1);
});
