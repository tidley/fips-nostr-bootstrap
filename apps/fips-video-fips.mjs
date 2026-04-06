#!/usr/bin/env node
import 'dotenv/config';
import http from 'node:http';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import {
  DEFAULT_ADVERT_RELAYS,
  DEFAULT_DM_RELAYS,
} from '../packages/fips-nostr-rendezvous/src/index.js';

function arg(name, fallback = '') {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

function splitList(value) {
  return String(value || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function reservePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('failed to reserve port'));
        return;
      }
      const { port } = address;
      server.close((err) => (err ? reject(err) : resolve(port)));
    });
  });
}

async function waitForJson(url, timeoutMs = 15000) {
  const started = Date.now();
  while (true) {
    try {
      const response = await fetch(url);
      if (response.ok) return await response.json();
    } catch {}
    if (Date.now() - started > timeoutMs) {
      throw new Error(`timed out waiting for ${url}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

async function readRequestBody(req) {
  return await new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

const httpPort = Number(arg('--http-port', '8090'));
const udpPort = Number(arg('--udp-port', '0'));
const discoveryEnabled = !process.argv.includes('--no-discover');
const relays = splitList(arg('--relays', ''));
const advertRelays = splitList(arg('--advert-relays', ''));
const dmRelays = splitList(arg('--dm-relays', ''));
const effectiveAdvertRelays = relays.length ? [...relays] : (advertRelays.length ? advertRelays : [...DEFAULT_ADVERT_RELAYS]);
const effectiveDmRelays = relays.length ? [...relays] : (dmRelays.length ? dmRelays : [...DEFAULT_DM_RELAYS]);

const daemonPort = Number(arg('--daemon-port', String(await reservePort())));
const rustDaemonBinary = `${process.cwd()}/rust/fips-nostr-rendezvous/target/debug/fips-video-daemon`;
const hasPrebuiltDaemon = existsSync(rustDaemonBinary);
const daemonCommand = hasPrebuiltDaemon ? rustDaemonBinary : 'cargo';
const daemonArgs = hasPrebuiltDaemon
  ? [
      '--nsec',
      process.env.NOSTR_NSEC || '',
      '--http-port',
      String(daemonPort),
      '--udp-port',
      String(udpPort),
      '--advert-relays',
      effectiveAdvertRelays.join(','),
      '--dm-relays',
      effectiveDmRelays.join(','),
      '--handoff-fips',
    ]
  : [
      'run',
      '--quiet',
      '--manifest-path',
      'rust/fips-nostr-rendezvous/Cargo.toml',
      '--bin',
      'fips-video-daemon',
      '--',
      '--nsec',
      process.env.NOSTR_NSEC || '',
      '--http-port',
      String(daemonPort),
      '--udp-port',
      String(udpPort),
      '--advert-relays',
      effectiveAdvertRelays.join(','),
      '--dm-relays',
      effectiveDmRelays.join(','),
      '--handoff-fips',
    ];
if (!discoveryEnabled) daemonArgs.push('--no-discover');
if (process.env.FIPS_UDP_PUBLIC_HOST) {
  daemonArgs.push('--public-host', process.env.FIPS_UDP_PUBLIC_HOST);
}
if (process.env.FIPS_STUN_SERVERS) {
  daemonArgs.push('--stun-servers', process.env.FIPS_STUN_SERVERS);
}

const daemon = spawn(daemonCommand, daemonArgs, {
  cwd: process.cwd(),
  env: { ...process.env },
  stdio: ['ignore', 'pipe', 'pipe'],
});
daemon.on('error', (error) => {
  console.error('[video-ui] failed to start rust daemon', JSON.stringify({ error: String(error) }));
});
daemon.stdout.on('data', (chunk) => process.stdout.write(String(chunk)));
daemon.stderr.on('data', (chunk) => process.stderr.write(String(chunk)));
daemon.on('exit', (code, signal) => {
  if (code === 0 || signal === 'SIGINT' || signal === 'SIGTERM') return;
  console.error('[video-ui] rust daemon exited', JSON.stringify({ code, signal }));
});

const daemonBase = `http://127.0.0.1:${daemonPort}`;
const daemonStartupTimeoutMs = hasPrebuiltDaemon ? 15000 : 90000;
const meta = await waitForJson(`${daemonBase}/api/meta`, daemonStartupTimeoutMs);

const html = `<!doctype html>
<html><head><meta charset="utf-8"/><title>FIPS Video over Nostr</title>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<style>
body{margin:0;background:#11151a;color:#e7edf4;font-family:ui-sans-serif,system-ui,sans-serif}
.app{max-width:1200px;margin:0 auto;padding:18px}
.card{background:#1b232c;border:1px solid #2d3945;border-radius:16px;padding:14px}
.top{display:grid;grid-template-columns:1fr 1fr;gap:14px}
.controls{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}
input,button{background:#10161d;color:#e7edf4;border:1px solid #41505f;border-radius:10px;padding:10px 12px;font:inherit}
input{flex:1}
button{cursor:pointer}
.primary{background:#0d6efd;border-color:#0d6efd}
.stage{margin-top:14px;display:grid;grid-template-columns:1fr 1fr;gap:14px}
.video{aspect-ratio:16/9;background:#0b0f13;border:1px solid #324050;border-radius:16px;overflow:hidden;display:flex;align-items:center;justify-content:center}
video,img{width:100%;height:100%;object-fit:cover;background:#000}
.status{font-size:13px;color:#9fb1c4}
.meta{font-size:12px;color:#8ba1b8;word-break:break-all}
.log{margin-top:14px;background:#0b0f13;border:1px solid #273240;border-radius:14px;padding:10px;height:220px;overflow:auto;white-space:pre-wrap;font-family:ui-monospace,monospace;font-size:12px}
@media (max-width: 900px){.top,.stage{grid-template-columns:1fr}}
</style></head><body>
<div class="app">
  <h2>FIPS Video over Nostr</h2>
  <div class="top">
    <div class="card">
      <div class="meta">Local npub: <code>${meta.npub}</code></div>
      <div class="controls">
        <input id="npub" placeholder="Peer npub or leave blank to discover"/>
        <button id="discover">Discover</button>
        <button id="connect" class="primary">Connect</button>
      </div>
      <div id="peers" class="meta" style="margin-top:10px"></div>
      <div id="status" class="status" style="margin-top:10px">Status: idle</div>
    </div>
    <div class="card">
      <div class="status">Controls</div>
      <div class="controls">
        <button id="startCamera" class="primary">Start Camera</button>
        <button id="stopCamera">Stop Camera</button>
      </div>
      <div class="meta" style="margin-top:10px">Frames are low-rate JPEGs sent over a FIPS app port after Nostr/STUN bootstrap and FIPS handoff.</div>
    </div>
  </div>
  <div class="stage">
    <div class="card">
      <div class="status">Local</div>
      <div class="video" style="margin-top:8px"><video id="localVideo" autoplay playsinline muted></video></div>
    </div>
    <div class="card">
      <div class="status">Remote</div>
      <div class="video" style="margin-top:8px"><img id="remoteFrame" alt="Remote frame"/></div>
    </div>
  </div>
  <div id="log" class="log"></div>
</div>
<script>
const statusEl = document.getElementById('status');
const peersEl = document.getElementById('peers');
const logEl = document.getElementById('log');
const localVideo = document.getElementById('localVideo');
const remoteFrame = document.getElementById('remoteFrame');
const discoverBtn = document.getElementById('discover');
const connectBtn = document.getElementById('connect');
let connected = false;
let captureTimer = null;
let captureCanvas = null;
let localStream = null;

function log(line){
  logEl.textContent += line + '\\n';
  logEl.scrollTop = logEl.scrollHeight;
}
function shortNpub(npub){
  if (!npub || npub.length <= 11) return npub || '';
  return npub.slice(0, 6) + '...' + npub.slice(-5);
}
function formatAdvertAge(publishedAt){
  if (!publishedAt) return 'age unknown';
  const ageMs = Math.max(0, Date.now() - Number(publishedAt));
  const ageSec = Math.floor(ageMs / 1000);
  if (ageSec < 60) return ageSec + 's ago';
  const ageMin = Math.floor(ageSec / 60);
  if (ageMin < 60) return ageMin + 'm ago';
  return Math.floor(ageMin / 60) + 'h ago';
}
function setBusy(busy, text){
  discoverBtn.disabled = busy;
  connectBtn.disabled = busy;
  statusEl.textContent = text;
}
async function startCamera(){
  if (localStream) return;
  localStream = await navigator.mediaDevices.getUserMedia({ video: { width: 320, height: 180 }, audio: false });
  localVideo.srcObject = localStream;
  captureCanvas = document.createElement('canvas');
  captureCanvas.width = 320;
  captureCanvas.height = 180;
  log('[camera] started');
  maybeStartCapture();
}
function stopCamera(){
  if (captureTimer) { clearInterval(captureTimer); captureTimer = null; }
  if (localStream) {
    for (const track of localStream.getTracks()) track.stop();
    localStream = null;
  }
  localVideo.srcObject = null;
  log('[camera] stopped');
}
async function sendCurrentFrame(){
  if (!connected || !captureCanvas || !localStream) return;
  const ctx = captureCanvas.getContext('2d');
  ctx.drawImage(localVideo, 0, 0, captureCanvas.width, captureCanvas.height);
  const blob = await new Promise((resolve) => captureCanvas.toBlob(resolve, 'image/jpeg', 0.5));
  if (!blob) return;
  const buffer = await blob.arrayBuffer();
  const response = await fetch('/api/frame', { method: 'POST', headers: { 'content-type': 'image/jpeg' }, body: buffer });
  const data = await response.json();
  if (!data.ok) log('[frame error] ' + data.error);
}
function maybeStartCapture(){
  if (!connected || !localStream || captureTimer) return;
  captureTimer = setInterval(() => {
    sendCurrentFrame().catch((err) => log('[frame error] ' + String(err.message || err)));
  }, 400);
}
function stopCapture(){
  if (captureTimer) {
    clearInterval(captureTimer);
    captureTimer = null;
  }
}
async function refreshPeers() {
  setBusy(true, 'Status: discovering peers...');
  log('[discover] querying relay adverts...');
  try {
    const response = await fetch('/api/discover');
    const data = await response.json();
    if (!data.ok) throw new Error(data.error || 'discover failed');
    if (!data.peers.length) {
      peersEl.textContent = 'No active traversal adverts found';
      log('[discover] no active traversal adverts found');
    } else {
      peersEl.innerHTML = data.peers.map((peer, index) =>
        '<button data-npub="' + peer.publisherNpub + '" style="margin-right:6px;margin-top:6px">' +
        'Peer ' + (index + 1) + ' ' + shortNpub(peer.publisherNpub) + ' (' + formatAdvertAge(peer.publishedAt) + ')' +
        '</button>'
      ).join('');
      for (const button of peersEl.querySelectorAll('button[data-npub]')) {
        button.onclick = () => { document.getElementById('npub').value = button.getAttribute('data-npub'); };
      }
      log('[discover] found ' + data.peers.length + ' peer advert(s)');
    }
  } catch (err) {
    log('[discover error] ' + String(err.message || err));
  } finally {
    setBusy(false, connected ? 'Status: connected' : 'Status: idle');
  }
}
document.getElementById('discover').onclick = refreshPeers;
document.getElementById('startCamera').onclick = () => startCamera().catch((err) => log('[camera error] ' + String(err.message || err)));
document.getElementById('stopCamera').onclick = stopCamera;
document.getElementById('connect').onclick = async () => {
  const npub = document.getElementById('npub').value.trim();
  setBusy(true, npub ? ('Status: connecting to ' + shortNpub(npub)) : 'Status: connecting to discovered peer');
  log(npub ? ('[connect] dialing ' + shortNpub(npub)) : '[connect] dialing first discovered peer');
  try {
    const response = await fetch('/api/connect', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ npub }),
    });
    const data = await response.json();
    if (!data.ok) throw new Error(data.error || 'connect failed');
    connected = true;
    statusEl.textContent = 'Status: connected ' + data.sessionId + ' -> ' + data.remote.host + ':' + data.remote.port;
    log('[connected] ' + data.sessionId + ' -> ' + data.remote.host + ':' + data.remote.port);
    maybeStartCapture();
  } catch (err) {
    connected = false;
    stopCapture();
    statusEl.textContent = 'Status: idle';
    log('[connect error] ' + String(err.message || err));
  } finally {
    if (connected) setBusy(false, statusEl.textContent);
    else setBusy(false, 'Status: idle');
  }
};
const es = new EventSource('/api/events');
es.addEventListener('status', (ev) => {
  const data = JSON.parse(ev.data);
  connected = !!data.connected;
  if (!connected) {
    stopCapture();
    statusEl.textContent = 'Status: idle';
    return;
  }
  statusEl.textContent = 'Status: connected ' + data.sessionId + ' -> ' + data.remote.host + ':' + data.remote.port;
  maybeStartCapture();
});
es.addEventListener('frame', () => {
  remoteFrame.src = '/api/remote-frame?ts=' + Date.now();
});
refreshPeers().catch(() => {});
</script>
</body></html>`;

async function proxyJson(req, res, path) {
  const body = req.method === 'POST' ? await readRequestBody(req) : undefined;
  const upstream = await fetch(`${daemonBase}${path}`, {
    method: req.method,
    headers: { 'content-type': req.headers['content-type'] || 'application/json' },
    body,
  });
  const text = await upstream.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { ok: false, error: text || `unexpected response from ${path}` };
  }
  res.writeHead(upstream.status || 200, { 'content-type': 'application/json' });
  res.end(JSON.stringify(json));
}

async function proxyBinary(req, res, path) {
  const upstream = await fetch(`${daemonBase}${path}`);
  const buffer = Buffer.from(await upstream.arrayBuffer());
  const contentType = upstream.headers.get('content-type') || 'application/octet-stream';
  res.writeHead(upstream.status || 200, { 'content-type': contentType, 'cache-control': 'no-store, max-age=0' });
  res.end(buffer);
}

async function proxySse(res) {
  const upstream = await fetch(`${daemonBase}/api/events`, {
    headers: { accept: 'text/event-stream' },
  });
  if (!upstream.ok || !upstream.body) {
    res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('failed to connect to rust daemon event stream');
    return;
  }
  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
  });
  const reader = upstream.body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(Buffer.from(value));
    }
  } finally {
    try { await reader.cancel(); } catch {}
    res.end();
  }
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'GET' && req.url === '/') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(html);
      return;
    }
    if (req.method === 'GET' && req.url === '/api/events') {
      await proxySse(res);
      return;
    }
    if (req.method === 'GET' && req.url === '/api/discover') {
      await proxyJson(req, res, '/api/discover');
      return;
    }
    if (req.method === 'POST' && req.url === '/api/connect') {
      await proxyJson(req, res, '/api/connect');
      return;
    }
    if (req.method === 'POST' && req.url === '/api/frame') {
      await proxyJson(req, res, '/api/frame');
      return;
    }
    if (req.method === 'GET' && req.url.startsWith('/api/remote-frame')) {
      await proxyBinary(req, res, '/api/remote-frame');
      return;
    }
    res.writeHead(404);
    res.end('not found');
  } catch (error) {
    res.writeHead(500, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: String(error.message || error) }));
  }
});

server.listen(httpPort, () => {
  console.log(JSON.stringify({
    app: 'fips-video-fips',
    http: `http://127.0.0.1:${httpPort}`,
    npub: meta.npub,
    udpPort: meta.udpPort,
    advertRelays: effectiveAdvertRelays,
    dmRelays: effectiveDmRelays,
    relaySource: relays.length ? 'cli-shared' : ((advertRelays.length || dmRelays.length) ? 'cli-split' : 'embedded-defaults'),
    runtime: 'rust-video-daemon',
  }, null, 2));
});

async function shutdown() {
  server.close();
  if (daemon.exitCode === null && daemon.signalCode === null) {
    daemon.kill('SIGINT');
  }
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
