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
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => resolve(body));
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
const rustDaemonBinary = `${process.cwd()}/rust/fips-nostr-rendezvous/target/debug/fips-console-daemon`;
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
      'fips-console-daemon',
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
  console.error('[console-ui] failed to start rust daemon', JSON.stringify({ error: String(error) }));
});
daemon.stdout.on('data', (chunk) => process.stdout.write(String(chunk)));
daemon.stderr.on('data', (chunk) => process.stderr.write(String(chunk)));
daemon.on('exit', (code, signal) => {
  if (code === 0 || signal === 'SIGINT' || signal === 'SIGTERM') return;
  console.error('[console-ui] rust daemon exited', JSON.stringify({ code, signal }));
});

const daemonBase = `http://127.0.0.1:${daemonPort}`;
const daemonStartupTimeoutMs = hasPrebuiltDaemon ? 15000 : 90000;
const meta = await waitForJson(`${daemonBase}/api/meta`, daemonStartupTimeoutMs);

const html = `<!doctype html>
<html><head><meta charset="utf-8"/><title>FIPS Console over Nostr</title>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<style>
body{margin:0;background:#121619;color:#e6edf3;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
.app{max-width:980px;margin:0 auto;padding:18px}
.panel{background:#1b2229;border:1px solid #344250;border-radius:12px;padding:12px}
input,button,textarea{font:inherit;background:#0f1419;color:#e6edf3;border:1px solid #445566;border-radius:8px;padding:8px 10px}
button{cursor:pointer}
.row{display:flex;gap:8px;flex-wrap:wrap}
.grow{flex:1}
.status{font-size:12px;color:#9fb0c0}
#log{width:100%;height:420px;box-sizing:border-box;resize:vertical}
</style></head><body>
<div class="app">
  <h3>FIPS Console over Nostr</h3>
  <div class="panel" style="margin-bottom:12px">
    <div class="status">Local npub: <code>${meta.npub}</code></div>
    <div class="row" style="margin-top:10px">
      <input id="npub" class="grow" placeholder="Target npub or leave blank to discover"/>
      <button id="discover">Discover</button>
      <button id="connect">Connect</button>
    </div>
    <div id="peers" class="status" style="margin-top:10px"></div>
    <div id="status" class="status" style="margin-top:10px">Status: idle</div>
  </div>
  <textarea id="log" spellcheck="false" readonly></textarea>
  <div class="row" style="margin-top:12px">
    <input id="message" class="grow" placeholder="Type a line and press Send"/>
    <button id="send">Send</button>
  </div>
</div>
<script>
const logEl = document.getElementById('log');
const statusEl = document.getElementById('status');
const peersEl = document.getElementById('peers');
const messageEl = document.getElementById('message');
const discoverBtn = document.getElementById('discover');
const connectBtn = document.getElementById('connect');
const sendBtn = document.getElementById('send');
let connected = false;
let busy = false;

function writeLine(s=''){ logEl.value += s + '\\n'; logEl.scrollTop = logEl.scrollHeight; }
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
function setBusy(nextBusy, label){
  busy = nextBusy;
  discoverBtn.disabled = nextBusy;
  connectBtn.disabled = nextBusy;
  statusEl.textContent = label || (connected ? 'Status: connected' : 'Status: idle');
}

async function refreshPeers() {
  if (busy) return;
  setBusy(true, 'Status: discovering peers...');
  writeLine('[discover] querying relay adverts...');
  try {
    const response = await fetch('/api/discover');
    const data = await response.json();
    if (!data.ok) throw new Error(data.error || 'discover failed');
    if (!data.peers.length) {
      peersEl.textContent = 'No active traversal adverts found';
      writeLine('[discover] no active traversal adverts found');
    } else {
      peersEl.innerHTML = data.peers.map((peer, index) =>
        '<button data-npub="' + peer.publisherNpub + '" style="margin-right:6px;margin-top:6px">' +
        'Peer ' + (index + 1) + ' ' + shortNpub(peer.publisherNpub) + ' (' + formatAdvertAge(peer.publishedAt) + ')' +
        '</button>'
      ).join('');
      for (const button of peersEl.querySelectorAll('button[data-npub]')) {
        button.onclick = () => { document.getElementById('npub').value = button.getAttribute('data-npub'); };
      }
      writeLine('[discover] found ' + data.peers.length + ' peer advert(s)');
    }
  } catch (err) {
    writeLine('[discover error] ' + String(err.message || err));
  } finally {
    setBusy(false, connected ? statusEl.textContent : 'Status: idle');
  }
}

async function connectPeer() {
  if (busy) return;
  const npub = document.getElementById('npub').value.trim();
  setBusy(true, npub ? ('Status: connecting to ' + shortNpub(npub)) : 'Status: connecting to discovered peer');
  writeLine(npub ? ('[connect] dialing ' + shortNpub(npub)) : '[connect] dialing first discovered peer');
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
    writeLine('[connected] ' + data.sessionId + ' -> ' + data.remote.host + ':' + data.remote.port);
  } catch (err) {
    connected = false;
    statusEl.textContent = 'Status: idle';
    writeLine('[connect error] ' + String(err.message || err));
  } finally {
    setBusy(false, connected ? statusEl.textContent : 'Status: idle');
  }
}

async function sendMessage() {
  const text = messageEl.value.trim();
  if (!text) return;
  if (!connected) {
    writeLine('[send error] not connected');
    return;
  }
  messageEl.value = '';
  writeLine('[me] ' + text);
  const response = await fetch('/api/send', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text }),
  });
  const data = await response.json();
  if (!data.ok) writeLine('[send error] ' + data.error);
}

document.getElementById('discover').onclick = refreshPeers;
document.getElementById('connect').onclick = connectPeer;
document.getElementById('send').onclick = () => sendMessage().catch((err) => writeLine('[send error] ' + String(err.message || err)));
messageEl.addEventListener('keydown', (ev) => {
  if (ev.key === 'Enter') {
    ev.preventDefault();
    sendMessage().catch((err) => writeLine('[send error] ' + String(err.message || err)));
  }
});

const es = new EventSource('/api/events');
es.addEventListener('status', (ev) => {
  const data = JSON.parse(ev.data);
  connected = !!data.connected;
  statusEl.textContent = data.connected
    ? ('Status: connected ' + data.sessionId + ' -> ' + data.remote.host + ':' + data.remote.port)
    : 'Status: idle';
});
es.addEventListener('message', (ev) => {
  const data = JSON.parse(ev.data);
  writeLine('[' + shortNpub(data.from) + '] ' + data.text);
});

writeLine('Console ready. Discover peers or paste an npub and press Connect.');
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
    if (req.method === 'POST' && req.url === '/api/send') {
      await proxyJson(req, res, '/api/send');
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
    app: 'fips-console-fips',
    http: `http://127.0.0.1:${httpPort}`,
    npub: meta.npub,
    udpPort: meta.udpPort,
    advertRelays: effectiveAdvertRelays,
    dmRelays: effectiveDmRelays,
    relaySource: relays.length ? 'cli-shared' : ((advertRelays.length || dmRelays.length) ? 'cli-split' : 'embedded-defaults'),
    runtime: 'rust-console-daemon',
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
