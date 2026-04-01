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
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      const response = await fetch(url);
      if (response.ok) return await response.json();
    } catch {
      // retry
    }
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

const httpPort = Number(arg('--http-port', '8787'));
const udpPort = Number(arg('--udp-port', '0'));
const discoveryEnabled = !process.argv.includes('--no-discover');
const relays = splitList(arg('--relays', ''));
const advertRelays = splitList(arg('--advert-relays', ''));
const dmRelays = splitList(arg('--dm-relays', ''));
const effectiveAdvertRelays = relays.length ? [...relays] : (advertRelays.length ? advertRelays : [...DEFAULT_ADVERT_RELAYS]);
const effectiveDmRelays = relays.length ? [...relays] : (dmRelays.length ? dmRelays : [...DEFAULT_DM_RELAYS]);

const daemonPort = Number(arg('--daemon-port', String(await reservePort())));
const rustDaemonBinary = `${process.cwd()}/rust/fips-nostr-rendezvous/target/debug/fips-web-daemon`;
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
    ]
  : [
      'run',
      '--quiet',
      '--manifest-path',
      'rust/fips-nostr-rendezvous/Cargo.toml',
      '--bin',
      'fips-web-daemon',
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
  console.error('[web-console] failed to start rust daemon', JSON.stringify({ error: String(error) }));
});
daemon.stdout.on('data', (chunk) => process.stdout.write(String(chunk)));
daemon.stderr.on('data', (chunk) => process.stderr.write(String(chunk)));
daemon.on('exit', (code, signal) => {
  if (code === 0 || signal === 'SIGINT' || signal === 'SIGTERM') return;
  console.error('[web-console] rust daemon exited', JSON.stringify({ code, signal }));
});

const daemonBase = `http://127.0.0.1:${daemonPort}`;
const daemonStartupTimeoutMs = hasPrebuiltDaemon ? 15000 : 90000;
const meta = await waitForJson(`${daemonBase}/api/meta`, daemonStartupTimeoutMs);

const html = `<!doctype html>
<html><head><meta charset="utf-8"/><title>FIPS SSH-like Console</title>
<style>
body{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;background:#1b1d1e;color:#d8d8d8;max-width:1000px;margin:18px auto;padding:0 12px}
.panel{background:#232629;border:1px solid #3b3f42;border-radius:6px;padding:10px}
input,button{font-family:inherit;font-size:13px;padding:7px;background:#2c2f33;color:#d8d8d8;border:1px solid #555;border-radius:4px}
button{cursor:pointer}
#term{width:100%;height:520px;background:#1e1e1e;color:#e6e6e6;border:1px solid #444;border-radius:6px;padding:10px;box-sizing:border-box;resize:vertical}
.meta{color:#9ea7ad;font-size:12px}
.ok{color:#8bd49c}
.err{color:#ff7f7f}
</style></head><body>
<h3>FIPS SSH-like Console</h3>
<div class="panel" style="margin-bottom:10px">
  <div class="meta">Local npub: <code>${meta.npub}</code></div>
  <div style="margin-top:8px;display:flex;gap:8px">
    <input id="npub" placeholder="Target npub or leave blank to discover" style="flex:1"/>
    <button id="discover">Discover</button>
    <button id="connect">Connect</button>
  </div>
  <div id="peers" class="meta" style="margin-top:8px"></div>
  <div id="status" class="meta" style="margin-top:8px">Status: idle</div>
</div>
<textarea id="term" spellcheck="false"></textarea>
<script>
const term = document.getElementById('term');
const statusEl = document.getElementById('status');
const peersEl = document.getElementById('peers');
const connectBtn = document.getElementById('connect');
const discoverBtn = document.getElementById('discover');
let activeState = null;
let prompt = 'fips@peer:$ ';
let cmdInFlight = false;
let transportBusy = false;
let cwd = '~';
const seen = new Set();
const pending = new Map();

function writeLine(s=''){ term.value += s + '\\n'; term.scrollTop = term.scrollHeight; }
function setPrompt(){ term.value += prompt; term.scrollTop = term.scrollHeight; }
function init(){ term.value=''; writeLine('Connected UI ready. Discover peers or paste an npub and press Connect.'); setPrompt(); }
function nextPaint(){ return new Promise((resolve) => requestAnimationFrame(() => resolve())); }
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
  const ageHr = Math.floor(ageMin / 60);
  if (ageHr < 24) return ageHr + 'h ago';
  const ageDay = Math.floor(ageHr / 24);
  return ageDay + 'd ago';
}
function setTransportBusy(busy, label){
  transportBusy = busy;
  connectBtn.disabled = busy;
  discoverBtn.disabled = busy;
  statusEl.textContent = label || (busy ? 'Status: working' : 'Status: idle');
}
init();

function currentLine(){
  const parts = term.value.split('\\n');
  return parts[parts.length-1];
}

function replaceCurrentLine(s){
  const parts = term.value.split('\\n');
  parts[parts.length-1] = s;
  term.value = parts.join('\\n');
}

function lockCursorEnd(){
  term.selectionStart = term.value.length;
  term.selectionEnd = term.value.length;
}

term.addEventListener('click', lockCursorEnd);
term.addEventListener('keyup', lockCursorEnd);
term.addEventListener('keydown', async (e) => {
  const line = currentLine();
  if (!line.startsWith(prompt)) {
    replaceCurrentLine(prompt);
    lockCursorEnd();
  }

  if (e.key === 'Backspace' && term.selectionStart <= term.value.lastIndexOf(prompt) + prompt.length) {
    e.preventDefault();
    return;
  }

  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c') {
    e.preventDefault();
    writeLine('^C');
    await fetch('/api/ctrlc',{method:'POST'});
    cmdInFlight = false;
    setPrompt();
    return;
  }

  if (e.key === 'Enter') {
    e.preventDefault();
    if (cmdInFlight) return;
    const cmd = currentLine().slice(prompt.length).trim();
    writeLine('');
    if (!cmd) { setPrompt(); return; }
    cmdInFlight = true;
    const r = await fetch('/api/cmd',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({cmd})});
    const d = await r.json();
    if (!d.ok) { writeLine('[error] ' + d.error); setPrompt(); cmdInFlight=false; }
    else {
      const t = setTimeout(() => {
        if (pending.has(d.id)) {
          pending.delete(d.id);
          writeLine('[timeout] no response for ' + d.id);
          cmdInFlight = false;
          setPrompt();
        }
      }, 10000);
      pending.set(d.id, t);
    }
  }
});

const es = new EventSource('/api/events');
es.addEventListener('status', ev => {
  const d = JSON.parse(ev.data);
  activeState = d.connected ? { sessionId: d.sessionId, remote: d.remote } : null;
  statusEl.textContent = d.connected ? ('Status: connected ' + d.sessionId + ' -> ' + d.remote.host + ':' + d.remote.port) : 'Status: idle';
  if (d.connected) setTransportBusy(false);
});

es.addEventListener('result', ev => {
  const d = JSON.parse(ev.data);
  if (d.id && seen.has(d.id)) return;
  if (d.id) {
    seen.add(d.id);
    const t = pending.get(d.id);
    if (t) {
      clearTimeout(t);
      pending.delete(d.id);
    }
  }
  if (d.cwd) { cwd = d.cwd; prompt = 'fips@peer:' + cwd + '$ '; }
  if (d.stdout) writeLine(d.stdout.replace(/\\n$/,''));
  if (d.stderr) writeLine('[stderr] ' + d.stderr.replace(/\\n$/,''));
  if (!d.ok) writeLine('[exit ' + (d.code ?? 1) + '] ' + (d.error || 'error'));
  setPrompt();
  cmdInFlight = false;
});

es.onerror = () => {
  if (es.readyState === EventSource.CLOSED) {
    if (!activeState) statusEl.textContent = 'Status: event stream closed';
    return;
  }
  if (!activeState && !transportBusy) statusEl.textContent = 'Status: reconnecting event stream...';
};

window.addEventListener('beforeunload', () => {
  try { es.close(); } catch {}
});

async function refreshPeers() {
  if (transportBusy) return;
  try {
    setTransportBusy(true, 'Status: discovering peers...');
    writeLine('[discover] querying relay adverts...');
    const r = await fetch('/api/discover');
    const d = await r.json();
    if (!d.ok) {
      peersEl.textContent = 'Discovery failed: ' + d.error;
      writeLine('[discover error] ' + d.error);
      return;
    }
    if (!d.peers.length) {
      peersEl.textContent = 'No active traversal adverts found';
      writeLine('[discover] no active traversal adverts found');
      return;
    }
    peersEl.innerHTML = d.peers.map((peer, index) =>
      '<button data-npub="' + peer.publisherNpub + '" style="margin-right:6px;margin-top:6px">' +
      'Peer ' + (index + 1) + ' ' + shortNpub(peer.publisherNpub) + ' (' + formatAdvertAge(peer.publishedAt) + ')' +
      '</button>'
    ).join('');
    for (const btn of peersEl.querySelectorAll('button[data-npub]')) {
      btn.onclick = () => {
        document.getElementById('npub').value = btn.getAttribute('data-npub');
      };
    }
    writeLine('[discover] found ' + d.peers.length + ' peer advert(s)');
  } catch (err) {
    writeLine('[discover error] ' + String(err.message || err));
  } finally {
    if (!activeState) setTransportBusy(false, 'Status: idle');
    else setTransportBusy(false, 'Status: connected ' + activeState.sessionId + ' -> ' + activeState.remote.host + ':' + activeState.remote.port);
  }
}

document.getElementById('connect').onclick = async () => {
  if (transportBusy) return;
  const npub = document.getElementById('npub').value.trim();
  let waitingTicker = null;
  try {
    setTransportBusy(true, npub ? 'Status: coordinating with ' + shortNpub(npub) : 'Status: coordinating with discovered peer...');
    writeLine(npub ? ('[connect] dialing ' + shortNpub(npub)) : '[connect] dialing first discovered peer');
    writeLine('[connect] waiting for relay coordination and UDP session establishment; this can take tens of seconds');
    waitingTicker = setInterval(() => {
      writeLine('[connect] still waiting for traversal session...');
    }, 10000);
    await nextPaint();
    const r = await fetch('/api/connect',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({npub})});
    const d = await r.json();
    if (waitingTicker) clearInterval(waitingTicker);
    if (!d.ok) {
      writeLine('[connect error] ' + d.error);
      setTransportBusy(false, 'Status: idle');
    } else {
      const source = d.discoveredAdvert?.publisherNpub ? ' via advert ' + shortNpub(d.discoveredAdvert.publisherNpub) : '';
      writeLine('[connected] ' + d.sessionId + source);
    }
  } catch (err) {
    if (waitingTicker) clearInterval(waitingTicker);
    writeLine('[connect error] ' + String(err.message || err));
    setTransportBusy(false, 'Status: idle');
  }
  setPrompt();
};

document.getElementById('discover').onclick = refreshPeers;
refreshPeers().catch(() => {});
</script>
</body></html>`;

async function proxyJson(req, res, path) {
  const body = req.method === 'POST' ? await readRequestBody(req) : undefined;

  if (path === '/api/connect' && body) {
    try {
      const parsed = JSON.parse(body);
      const npub = String(parsed?.npub || '').trim();
      console.log('[web-console] connect request', JSON.stringify({
        target: npub || '(first-discovered-peer)',
        mode: npub ? 'explicit-npub-direct' : 'advert-discovery',
      }));
    } catch {}
  }

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

  if (path === '/api/connect') {
    if (json?.ok) {
      if (json.discoveredAdvert?.publisherNpub) {
        console.log('[web-console] target advert observed', JSON.stringify({
          target: json.discoveredAdvert.publisherNpub,
          advertRelays: json.discoveredAdvert.relays,
          publishedAt: json.discoveredAdvert.publishedAt,
        }));
      }
      console.log('[web-console] connect success', JSON.stringify({
        sessionId: json.sessionId,
        remote: json.remote,
      }));
    } else {
      console.error('[web-console] connect failure', JSON.stringify({
        error: String(json?.error || 'unknown'),
      }));
    }
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
    // eslint-disable-next-line no-constant-condition
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
    if (req.url === '/api/discover' && req.method === 'GET') {
      await proxyJson(req, res, '/api/discover');
      return;
    }
    if (req.url === '/api/connect' && req.method === 'POST') {
      await proxyJson(req, res, '/api/connect');
      return;
    }
    if (req.url === '/api/cmd' && req.method === 'POST') {
      await proxyJson(req, res, '/api/cmd');
      return;
    }
    if (req.url === '/api/ctrlc' && req.method === 'POST') {
      await proxyJson(req, res, '/api/ctrlc');
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
    app: 'fips-web-console',
    http: `http://127.0.0.1:${httpPort}`,
    npub: meta.npub,
    udpPort: meta.udpPort,
    advertRelays: effectiveAdvertRelays,
    dmRelays: effectiveDmRelays,
    relaySource: relays.length ? 'cli-shared' : ((advertRelays.length || dmRelays.length) ? 'cli-split' : 'embedded-defaults'),
    runtime: 'rust-daemon',
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
