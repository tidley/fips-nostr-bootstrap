#!/usr/bin/env node
import 'dotenv/config';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import {
  createFipsNostrRendezvousNode,
  DEFAULT_ADVERT_RELAYS,
  DEFAULT_DM_RELAYS,
} from '../packages/fips-nostr-rendezvous/src/index.js';

function arg(name, fallback = '') {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

const httpPort = Number(arg('--http-port', '8787'));
const udpPort = Number(arg('--udp-port', '0'));
const discoveryEnabled = !process.argv.includes('--no-discover');
const relays = (arg('--relays', '') || '').split(',').map((s) => s.trim()).filter(Boolean);
const advertRelays = (arg('--advert-relays', '') || '').split(',').map((s) => s.trim()).filter(Boolean);
const dmRelays = (arg('--dm-relays', '') || '').split(',').map((s) => s.trim()).filter(Boolean);
const effectiveAdvertRelays = relays.length ? [...relays] : (advertRelays.length ? advertRelays : [...DEFAULT_ADVERT_RELAYS]);
const effectiveDmRelays = relays.length ? [...relays] : (dmRelays.length ? dmRelays : [...DEFAULT_DM_RELAYS]);

const node = createFipsNostrRendezvousNode({
  udpPort,
  advertRelays: effectiveAdvertRelays,
  dmRelays: effectiveDmRelays,
  nsec: process.env.NOSTR_NSEC,
  publicHost: process.env.FIPS_UDP_PUBLIC_HOST,
  advertise: false,
});
const started = await node.start();

let active = null;
const eventClients = new Set();

function emit(type, data) {
  const line = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of eventClients) res.write(line);
}

function attachSession(sessionId, remote, session) {
  if (active?.sessionId === sessionId) return;
  active = { sessionId, remote, session };
  session.on('channel:shell_result', (payload) => emit('result', payload));
  emit('status', { connected: true, sessionId, remote });
}

node.on('session', ({ sessionId, remote, session }) => {
  attachSession(sessionId, remote, session);
});

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
  <div class="meta">Local npub: <code>${started.npub}</code></div>
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

const server = http.createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(html);
    return;
  }

  if (req.method === 'GET' && req.url === '/api/events') {
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    });
    eventClients.add(res);
    const keepalive = setInterval(() => {
      try {
        res.write(': keepalive\\n\\n');
      } catch {}
    }, 15000);
    res.write(`event: status\ndata: ${JSON.stringify({ connected: !!active, sessionId: active?.sessionId || null, remote: active?.remote || null })}\n\n`);
    req.on('close', () => {
      clearInterval(keepalive);
      eventClients.delete(res);
    });
    return;
  }

  if (req.method === 'POST' && req.url === '/api/connect') {
    let b = '';
    req.on('data', (d) => (b += d));
    req.on('end', async () => {
      const startedAt = Date.now();
      try {
        const { npub } = JSON.parse(b || '{}');
        console.log('[web-console] connect request', JSON.stringify({
          target: npub || '(first-discovered-peer)',
          mode: npub ? 'explicit-npub-direct' : 'advert-discovery',
        }));
        if (npub && npub === started.npub) throw new Error('refusing to connect to self');
        let conn;
        if (discoveryEnabled) {
          if (npub) {
            try {
              const advert = await node.findAdvertisedPeer(npub, { waitMs: 2000, settleMs: 500 });
              console.log('[web-console] target advert observed', JSON.stringify({
                target: npub,
                advertRelays: advert.relays,
                publishedAt: advert.publishedAt,
              }));
              conn = await node.connectFromAdvert(advert, { waitMs: 60000 });
            } catch (err) {
              console.warn('[web-console] target advert not observed; falling back to direct connect', JSON.stringify({
                target: npub,
                error: String(err.message || err),
              }));
              conn = await node.connect(npub, { waitMs: 60000 });
            }
          } else {
            conn = await node.connectToDiscoveredPeer({ discoveryWaitMs: 60000, waitMs: 60000 });
          }
        } else {
          conn = await node.connect(npub, { waitMs: 60000 });
        }
        attachSession(conn.nonce, conn.remote, conn.session);
        console.log('[web-console] connect success', JSON.stringify({
          sessionId: conn.nonce,
          remote: conn.remote,
          elapsedMs: Date.now() - startedAt,
        }));
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
          ok: true,
          sessionId: conn.nonce,
          remote: conn.remote,
          discovered: Boolean(conn.discoveredAdvert),
          discoveredAdvert: conn.discoveredAdvert || null,
        }));
      } catch (e) {
        console.error('[web-console] connect failure', JSON.stringify({
          error: String(e.message || e),
          elapsedMs: Date.now() - startedAt,
        }));
        res.writeHead(400, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: String(e.message || e) }));
      }
    });
    return;
  }

  if (req.method === 'GET' && req.url === '/api/discover') {
    try {
      const peers = discoveryEnabled ? await node.listAdvertisedPeers({
        waitMs: 5000,
        maxPeers: 10,
        excludePublisherNpubs: [started.npub],
      }) : [];
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, peers }));
    } catch (e) {
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: String(e.message || e), peers: [] }));
    }
    return;
  }

  if (req.method === 'POST' && req.url === '/api/cmd') {
    let b = '';
    req.on('data', (d) => (b += d));
    req.on('end', async () => {
      try {
        if (!active?.session) throw new Error('not connected');
        const { cmd } = JSON.parse(b || '{}');
        const id = randomUUID();
        active.session.send('shell', { id, cmd }, 'request');
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true, id }));
      } catch (e) {
        res.writeHead(400, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: String(e.message || e) }));
      }
    });
    return;
  }

  if (req.method === 'POST' && req.url === '/api/ctrlc') {
    try {
      if (!active?.session) throw new Error('not connected');
      active.session.send('shell_interrupt', { ts: Date.now() }, 'request');
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    } catch (e) {
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: String(e.message || e) }));
    }
    return;
  }

  res.writeHead(404);
  res.end('not found');
});

server.listen(httpPort, () => {
  console.log(JSON.stringify({
    app: 'fips-web-console',
    http: `http://127.0.0.1:${httpPort}`,
    npub: started.npub,
    udpPort: started.udpPort,
    advertRelays: effectiveAdvertRelays,
    dmRelays: effectiveDmRelays,
    relaySource: relays.length ? 'cli-shared' : ((advertRelays.length || dmRelays.length) ? 'cli-split' : 'embedded-defaults'),
  }, null, 2));
});

process.on('SIGINT', () => {
  server.close();
  node.close();
  process.exit(0);
});
