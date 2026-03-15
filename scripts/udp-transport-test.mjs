#!/usr/bin/env node
import dgram from 'node:dgram';
import { performance } from 'node:perf_hooks';

function parseArgs() {
  const args = process.argv.slice(2);
  const out = {
    mode: 'local', // local | server | client
    host: '0.0.0.0',
    targetHost: '',
    port: 9999,
    rounds: 200,
    payloadBytes: 64,
    warmup: 20,
    timeoutMs: 3000,
  };

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    const v = args[i + 1];
    if (a === '--mode' && v) out.mode = v;
    if (a === '--host' && v) out.host = v;
    if (a === '--target-host' && v) out.targetHost = v;
    if (a === '--port' && Number.isFinite(Number(v))) out.port = Number(v);
    if (a === '--rounds' && Number.isFinite(Number(v))) out.rounds = Number(v);
    if (a === '--payload' && Number.isFinite(Number(v))) out.payloadBytes = Number(v);
    if (a === '--warmup' && Number.isFinite(Number(v))) out.warmup = Number(v);
    if (a === '--timeout' && Number.isFinite(Number(v))) out.timeoutMs = Number(v);
  }

  return out;
}

function percentile(values, p) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

function mean(values) {
  if (!values.length) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

async function bindSocket(socket, host, port) {
  await new Promise((resolve, reject) => {
    socket.once('error', reject);
    socket.bind(port, host, resolve);
  });
}

function makePingPacket(id, payload) {
  const idBuf = Buffer.alloc(4);
  idBuf.writeUInt32BE(id, 0);
  const body = Buffer.concat([idBuf, payload]);
  return Buffer.concat([Buffer.from('PING'), body]);
}

function parsePacket(msg) {
  if (msg.length < 8) return null;
  const type = msg.subarray(0, 4).toString();
  const id = msg.readUInt32BE(4);
  return { type, id };
}

async function runServer(cfg) {
  const socket = dgram.createSocket('udp4');
  await bindSocket(socket, cfg.host, cfg.port);
  const addr = socket.address();

  let pings = 0;
  const started = Date.now();

  socket.on('message', (msg, rinfo) => {
    const parsed = parsePacket(msg);
    if (!parsed) return;

    if (parsed.type === 'PING') {
      pings += 1;
      const pong = Buffer.concat([Buffer.from('PONG'), msg.subarray(4)]);
      socket.send(pong, rinfo.port, rinfo.address);
    }
  });

  process.on('SIGINT', () => {
    const report = {
      mode: 'server',
      listening: `${addr.address}:${addr.port}`,
      uptimeSec: Number(((Date.now() - started) / 1000).toFixed(3)),
      pingsHandled: pings,
    };
    console.log(JSON.stringify(report, null, 2));
    socket.close(() => process.exit(0));
  });

  console.log(
    JSON.stringify(
      {
        mode: 'server',
        listening: `${addr.address}:${addr.port}`,
        note: 'Press Ctrl+C to stop and print final stats',
      },
      null,
      2,
    ),
  );
}

async function runClient(cfg) {
  if (!cfg.targetHost) throw new Error('--target-host is required in client mode');

  const socket = dgram.createSocket('udp4');
  await bindSocket(socket, '0.0.0.0', 0);
  const localAddr = socket.address();

  const payload = Buffer.alloc(Math.max(1, cfg.payloadBytes), 0x61);
  const rtts = [];
  let seq = 0;

  async function pingOnce() {
    return await new Promise((resolve, reject) => {
      const id = seq++;
      const packet = makePingPacket(id, payload);
      const started = performance.now();

      const timer = setTimeout(() => {
        socket.off('message', onMessage);
        reject(new Error(`timeout waiting for seq=${id}`));
      }, cfg.timeoutMs);

      function onMessage(msg) {
        const parsed = parsePacket(msg);
        if (!parsed || parsed.type !== 'PONG' || parsed.id !== id) return;
        clearTimeout(timer);
        socket.off('message', onMessage);
        resolve(performance.now() - started);
      }

      socket.on('message', onMessage);
      socket.send(packet, cfg.port, cfg.targetHost);
    });
  }

  const setupStart = performance.now();
  const firstRtt = await pingOnce();
  const setupMs = performance.now() - setupStart;

  for (let i = 0; i < cfg.warmup; i++) await pingOnce();

  const benchStart = performance.now();
  for (let i = 0; i < cfg.rounds; i++) {
    const rtt = await pingOnce();
    rtts.push(rtt);
  }
  const benchMs = performance.now() - benchStart;

  socket.close();

  const totalBytes = cfg.rounds * (payload.length + 8) * 2;
  const throughputMbps = (totalBytes * 8) / (benchMs / 1000) / 1_000_000;

  const report = {
    mode: 'client',
    local: `${localAddr.address}:${localAddr.port}`,
    remote: `${cfg.targetHost}:${cfg.port}`,
    config: cfg,
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
  };

  console.log(JSON.stringify(report, null, 2));
}

async function runLocal(cfg) {
  const server = dgram.createSocket('udp4');
  const client = dgram.createSocket('udp4');

  await bindSocket(server, '127.0.0.1', 0);
  await bindSocket(client, '127.0.0.1', 0);

  const sAddr = server.address();
  cfg.targetHost = sAddr.address;
  cfg.port = sAddr.port;

  server.on('message', (msg, rinfo) => {
    const parsed = parsePacket(msg);
    if (!parsed || parsed.type !== 'PING') return;
    const pong = Buffer.concat([Buffer.from('PONG'), msg.subarray(4)]);
    server.send(pong, rinfo.port, rinfo.address);
  });

  // temporarily monkey-patch runClient to use already-open client socket? simpler: close server/client and reuse runClient with fresh server.
  // To keep behavior unchanged from previous local mode, run client logic with current server socket by using a tiny local clone.
  const payload = Buffer.alloc(Math.max(1, cfg.payloadBytes), 0x61);
  const rtts = [];
  let seq = 0;

  async function pingOnce() {
    return await new Promise((resolve, reject) => {
      const id = seq++;
      const packet = makePingPacket(id, payload);
      const started = performance.now();

      const timer = setTimeout(() => {
        client.off('message', onMessage);
        reject(new Error(`timeout waiting for seq=${id}`));
      }, cfg.timeoutMs);

      function onMessage(msg) {
        const parsed = parsePacket(msg);
        if (!parsed || parsed.type !== 'PONG' || parsed.id !== id) return;
        clearTimeout(timer);
        client.off('message', onMessage);
        resolve(performance.now() - started);
      }

      client.on('message', onMessage);
      client.send(packet, sAddr.port, sAddr.address);
    });
  }

  const setupStart = performance.now();
  const firstRtt = await pingOnce();
  const setupMs = performance.now() - setupStart;

  for (let i = 0; i < cfg.warmup; i++) await pingOnce();

  const benchStart = performance.now();
  for (let i = 0; i < cfg.rounds; i++) {
    const rtt = await pingOnce();
    rtts.push(rtt);
  }
  const benchMs = performance.now() - benchStart;

  const cAddr = client.address();
  client.close();
  server.close();

  const totalBytes = cfg.rounds * (payload.length + 8) * 2;
  const throughputMbps = (totalBytes * 8) / (benchMs / 1000) / 1_000_000;

  const report = {
    mode: 'local',
    clients: {
      a: `${cAddr.address}:${cAddr.port}`,
      b: `${sAddr.address}:${sAddr.port}`,
    },
    config: cfg,
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
  };

  console.log(JSON.stringify(report, null, 2));
}

async function main() {
  const cfg = parseArgs();

  if (!['local', 'server', 'client'].includes(cfg.mode)) {
    throw new Error(`unsupported --mode=${cfg.mode}. Use local|server|client`);
  }

  if (cfg.mode === 'server') return runServer(cfg);
  if (cfg.mode === 'client') return runClient(cfg);
  return runLocal(cfg);
}

main().catch((err) => {
  console.error('[udp-transport-test] failed:', err.message);
  process.exit(1);
});
