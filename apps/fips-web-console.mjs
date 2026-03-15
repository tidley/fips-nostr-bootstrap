#!/usr/bin/env node
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { createFipsNostrRendezvousNode } from '../packages/fips-nostr-rendezvous/src/index.js';

function arg(name, fallback = '') {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

const httpPort = Number(arg('--http-port', '8787'));
const udpPort = Number(arg('--udp-port', '0'));
const relays = (process.env.NOSTR_RELAYS || 'wss://nos.lol').split(',').map((s) => s.trim()).filter(Boolean);

const node = createFipsNostrRendezvousNode({ udpPort, relays, publicHost: process.env.FIPS_UDP_PUBLIC_HOST });
const started = await node.start();

let active = null;
const eventClients = new Set();

function emit(type, data) {
  const line = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of eventClients) res.write(line);
}

node.on('session', ({ sessionId, remote, session }) => {
  active = { sessionId, remote, session };
  emit('status', { connected: true, sessionId, remote });

  session.on('channel:shell_result', (payload) => {
    emit('result', payload);
  });
});

const html = `<!doctype html>
<html><head><meta charset="utf-8"/><title>FIPS Nostr Console</title>
<style>body{font-family:system-ui;max-width:900px;margin:20px auto;padding:0 12px}textarea{width:100%;height:320px}input,button{font-size:14px;padding:8px}code{background:#eee;padding:2px 4px}</style>
</head><body>
<h2>FIPS Nostr Web Console</h2>
<p>Local npub: <code id="local">${started.npub}</code></p>
<div>
<input id="npub" placeholder="Target npub" style="width:70%"/>
<button id="connect">Connect</button>
</div>
<div style="margin-top:10px">
<input id="cmd" placeholder="command (e.g. uname -a)" style="width:70%"/>
<button id="send">Send</button>
</div>
<p id="status">Status: idle</p>
<textarea id="out" readonly></textarea>
<script>
const out = document.getElementById('out');
const status = document.getElementById('status');
function log(x){ out.value += x + '\n'; out.scrollTop = out.scrollHeight; }

const es = new EventSource('/api/events');
es.addEventListener('status', ev => {
  const d = JSON.parse(ev.data);
  status.textContent = d.connected ? 'Status: connected ' + d.sessionId : 'Status: idle';
  log('[status] ' + JSON.stringify(d));
});
es.addEventListener('result', ev => {
  const d = JSON.parse(ev.data);
  log('\n$ ' + d.command + '\n' + (d.stdout||'') + (d.stderr||''));
  if(!d.ok) log('[error] ' + (d.error||('exit '+d.code)));
});

document.getElementById('connect').onclick = async () => {
  const npub = document.getElementById('npub').value.trim();
  const r = await fetch('/api/connect',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({npub})});
  const d = await r.json();
  log('[connect] ' + JSON.stringify(d));
};

document.getElementById('send').onclick = async () => {
  const cmd = document.getElementById('cmd').value;
  const r = await fetch('/api/cmd',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({cmd})});
  const d = await r.json();
  log('[send] ' + JSON.stringify(d));
};
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
    res.write(`event: status\ndata: ${JSON.stringify({ connected: !!active, sessionId: active?.sessionId || null })}\n\n`);
    req.on('close', () => eventClients.delete(res));
    return;
  }

  if (req.method === 'POST' && req.url === '/api/connect') {
    let b = '';
    req.on('data', (d) => (b += d));
    req.on('end', async () => {
      try {
        const { npub } = JSON.parse(b || '{}');
        if (!npub) throw new Error('missing npub');
        const conn = await node.connect(npub, { waitMs: 60000 });
        active = { sessionId: conn.nonce, remote: conn.remote, session: conn.session };
        active.session.on('channel:shell_result', (payload) => emit('result', payload));
        emit('status', { connected: true, sessionId: conn.nonce, remote: conn.remote });
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true, sessionId: conn.nonce, remote: conn.remote }));
      } catch (e) {
        res.writeHead(400, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: String(e.message || e) }));
      }
    });
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

  res.writeHead(404);
  res.end('not found');
});

server.listen(httpPort, () => {
  console.log(JSON.stringify({
    app: 'fips-web-console',
    http: `http://127.0.0.1:${httpPort}`,
    npub: started.npub,
    udpPort: started.udpPort,
    relays,
  }, null, 2));
});

process.on('SIGINT', () => {
  server.close();
  node.close();
  process.exit(0);
});
