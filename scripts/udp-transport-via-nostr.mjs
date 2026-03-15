#!/usr/bin/env node
import dgram from 'node:dgram';
import os from 'node:os';
import { performance } from 'node:perf_hooks';
import { SimplePool, generateSecretKey, getPublicKey, nip19 } from 'nostr-tools';
import { wrapEvent, unwrapEvent } from 'nostr-tools/nip17';

async function ensureWebSocketSupport() {
  if (typeof globalThis.WebSocket !== 'undefined') return;
  const ws = await import('ws');
  globalThis.WebSocket = ws.WebSocket || ws.default;
}

function parseArgs() {
  const args = process.argv.slice(2);
  const out = {
    mode: 'client', // server | client
    npub: '',
    port: 9999,
    host: '0.0.0.0',
    rounds: 200,
    payloadBytes: 64,
    warmup: 20,
    timeoutMs: 3000,
    waitMs: 30000,
    showEndpoints: false,
    debug: false,
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
    if (a === '--show-endpoints') out.showEndpoints = true;
    if (a === '--debug') out.debug = true;
  }
  return out;
}

function resolveSecretKey() {
  const nsec = process.env.NOSTR_NSEC;
  if (!nsec) {
    return { sk: generateSecretKey(), source: 'generated-ephemeral' };
  }
  const decoded = nip19.decode(nsec);
  if (decoded.type !== 'nsec') throw new Error('NOSTR_NSEC must be valid nsec');
  return { sk: decoded.data, source: 'env-nsec' };
}

function relaysFromEnv() {
  const raw = process.env.NOSTR_RELAYS || 'wss://relay.damus.io,wss://nos.lol,wss://relay.primal.net,wss://nip17.tomdwyer.uk';
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
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
  Promise.allSettled(pubs)
    .then((results) => {
      const summary = results.map((r) => (r.status === 'fulfilled' ? 'ok' : String(r.reason))).slice(0, 8);
      debugLog?.('publish-result', { type: obj?.type, results: summary });
    })
    .catch(() => {
      // swallow relay write errors; rendezvous retries handle transient failures
    });
}

function parseIncomingNip17(event, recipientSk) {
  const rumor = unwrapEvent(event, recipientSk);
  return {
    senderPubkey: rumor.pubkey,
    message: JSON.parse(rumor.content),
  };
}

async function runServer(cfg) {
  const debugLog = cfg.debug ? (label, data = {}) => console.error(`[debug][server] ${label}`, data) : null;
  const { sk, source: keySource } = resolveSecretKey();
  const relays = relaysFromEnv();
  const pool = new SimplePool();
  const senderPubkey = getPublicKey(sk);

  const socket = dgram.createSocket('udp4');
  await bindSocket(socket, cfg.host, cfg.port);
  const addr = socket.address();
  const advertiseHost = publicHostHint();

  let pings = 0;
  socket.on('message', (msg, rinfo) => {
    if (msg.subarray(0, 4).toString() !== 'PING') return;
    pings += 1;
    const pong = Buffer.concat([Buffer.from('PONG'), msg.subarray(4)]);
    socket.send(pong, rinfo.port, rinfo.address);
  });

  const sub = pool.subscribeMany(relays, { kinds: [1059], '#p': [senderPubkey], since: Math.floor(Date.now() / 1000) }, {
    onevent: async (evt) => {
      debugLog?.('recv-event', { id: evt.id, kind: evt.kind, pubkey: evt.pubkey });
      try {
        const { senderPubkey: fromPubkey, message: msg } = parseIncomingNip17(evt, sk);
        debugLog?.('recv-msg', { fromPubkey, type: msg?.type, nonce: msg?.nonce });
        if (msg?.type !== 'fips.udp.test.hello' || !msg?.nonce) return;

        const reply = {
          type: 'fips.udp.test.server-info',
          nonce: msg.nonce,
          endpoint: { host: advertiseHost, port: addr.port },
          issuedAt: Date.now(),
        };

        publishDM({ pool, relays, sk, recipientPubkey: fromPubkey, obj: reply, debugLog });
      } catch (err) {
        debugLog?.('recv-parse-failed', { err: String(err?.message || err) });
      }
    },
    oneose: () => debugLog?.('eose'),
    onclose: (reasons) => debugLog?.('sub-close', { reasons }),
  });

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
  const pool = new SimplePool();
  const senderPubkey = getPublicKey(sk);

  const helloNonce = nonce();

  const serverInfo = await new Promise(async (resolve, reject) => {
    const started = Date.now();
    const since = Math.floor(Date.now() / 1000) - 120;
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

    const hello = { type: 'fips.udp.test.hello', nonce: helloNonce, want: 'udp-endpoint' };
    publishDM({ pool, relays, sk, recipientPubkey: serverPubkey, obj: hello, debugLog });

    const republishEveryMs = 7000;
    let nextRepublishAt = Date.now() + republishEveryMs;
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
        nextRepublishAt = now + republishEveryMs;
      }
    }, 250);
  });

  const targetHost = serverInfo.endpoint.host;
  const targetPort = serverInfo.endpoint.port;

  const socket = dgram.createSocket('udp4');
  await bindSocket(socket, '0.0.0.0', 0);
  const localAddr = socket.address();

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
      socket.send(packet, targetPort, targetHost);
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

  socket.close();
  pool.close(relays);

  console.log(
    JSON.stringify(
      {
        mode: 'client',
        identity: nip19.npubEncode(senderPubkey),
        keySource,
        rendezvous: {
          viaNostrDM: true,
          serverNpub: cfg.npub,
          endpointDiscovered: true,
        },
        endpoints: cfg.showEndpoints
          ? { local: `${localAddr.address}:${localAddr.port}`, remote: `${targetHost}:${targetPort}` }
          : { local: '[hidden]', remote: '[hidden-discovered-via-dm]' },
        setup: {
          firstProbeRttMs: Number(firstRtt.toFixed(3)),
          setupTimeMs: Number(setupMs.toFixed(3)),
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
