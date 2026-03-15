#!/usr/bin/env node
import 'dotenv/config';
import http from 'node:http';
import { WebSocketServer } from 'ws';

function arg(name, fallback = '') {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

const port = Number(arg('--port', '8088'));

const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>FIPS Simple Video Chat</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 980px; margin: 24px auto; padding: 0 12px; }
    .row { display: flex; gap: 8px; margin-bottom: 10px; align-items: center; }
    input, button { padding: 8px; font-size: 14px; }
    input { flex: 1; }
    video { width: 48%; background: #111; border-radius: 8px; }
    #status { color: #555; font-size: 13px; }
    #myNpub { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; word-break: break-all; }
    #qr { width: 170px; height: 170px; border: 1px solid #ddd; border-radius: 8px; }
  </style>
</head>
<body>
  <h2>Simple 1:1 Video Chat (ephemeral npub per tab)</h2>

  <div class="row" style="align-items:flex-start">
    <div style="flex:1">
      <div><strong>Your ephemeral npub:</strong></div>
      <div id="myNpub"></div>
      <button id="copyNpub" style="margin-top:8px">Copy npub</button>
    </div>
    <div>
      <div><strong>Scan/share QR:</strong></div>
      <img id="qr" alt="npub QR" />
    </div>
  </div>

  <div class="row">
    <input id="peerNpub" placeholder="Peer npub (paste or scan)" />
    <button id="connect">Connect</button>
  </div>

  <div class="row">
    <button id="cam">Start camera+mic</button>
    <button id="call">Call</button>
    <button id="mute">Mute mic</button>
    <button id="speaker">Mute speaker</button>
  </div>

  <p id="status">Status: idle</p>

  <div class="row">
    <video id="localVideo" autoplay playsinline muted></video>
    <video id="remoteVideo" autoplay playsinline></video>
  </div>

<script type="module">
import { generateSecretKey, getPublicKey, nip19 } from 'https://esm.sh/nostr-tools@2.17.0';

(() => {
  const statusEl = document.getElementById('status');
  const peerNpubEl = document.getElementById('peerNpub');
  const localVideo = document.getElementById('localVideo');
  const remoteVideo = document.getElementById('remoteVideo');
  const myNpubEl = document.getElementById('myNpub');
  const qrEl = document.getElementById('qr');

  const sk = generateSecretKey();
  const pub = getPublicKey(sk);
  const myNpub = nip19.npubEncode(pub);

  myNpubEl.textContent = myNpub;
  qrEl.src = 'https://api.qrserver.com/v1/create-qr-code/?size=170x170&data=' + encodeURIComponent(myNpub);

  let ws = null;
  let localStream = null;
  let pc = null;
  let peerNpub = null;
  let peerReachable = false;
  let micMuted = false;
  let speakerMuted = false;

  function status(s) { statusEl.textContent = 'Status: ' + s; }

  function send(obj) {
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
  }

  function ensurePeer() {
    if (pc) return pc;
    pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });

    pc.onicecandidate = (e) => {
      if (e.candidate && peerNpub) send({ type: 'ice', to: peerNpub, candidate: e.candidate });
    };

    pc.ontrack = (e) => {
      remoteVideo.srcObject = e.streams[0];
      status('remote stream connected');
    };

    if (localStream) {
      for (const t of localStream.getTracks()) pc.addTrack(t, localStream);
    }

    return pc;
  }

  async function startCamera() {
    localStream = await navigator.mediaDevices.getUserMedia({
      video: true,
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
    });
    localVideo.srcObject = localStream;
    status('camera+mic started');
    if (pc) {
      for (const t of localStream.getTracks()) pc.addTrack(t, localStream);
    }
  }

  async function startCall() {
    if (!peerNpub) return status('enter peer npub first');
    if (!peerReachable) return status('peer not confirmed yet; click Connect on both sides');
    const p = ensurePeer();
    const offer = await p.createOffer();
    await p.setLocalDescription(offer);
    send({ type: 'offer', to: peerNpub, sdp: offer });
    status('offer sent to peer');
  }

  function connectSignal() {
    peerNpub = peerNpubEl.value.trim();
    if (!peerNpub.startsWith('npub')) return status('invalid peer npub');

    ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws');

    ws.onopen = () => {
      send({ type: 'hello', npub: myNpub });
      send({ type: 'probe', to: peerNpub });
      status('signaling connected as ' + myNpub.slice(0, 16) + '... (probing peer)');
    };

    ws.onmessage = async (ev) => {
      const msg = JSON.parse(ev.data);
      if (!msg) return;

      if (msg.type === 'peer-online' && msg.npub === peerNpub) {
        status('peer is online');
      }

      if (msg.type === 'probe' && msg.from === peerNpub) {
        send({ type: 'probe_ack', to: peerNpub });
      }

      if (msg.type === 'probe_ack' && msg.from === peerNpub) {
        peerReachable = true;
        status('peer reachable: ' + peerNpub.slice(0, 16) + '...');
      }

      if (msg.type === 'offer' && msg.from === peerNpub) {
        const p = ensurePeer();
        await p.setRemoteDescription(new RTCSessionDescription(msg.sdp));
        const answer = await p.createAnswer();
        await p.setLocalDescription(answer);
        send({ type: 'answer', to: peerNpub, sdp: answer });
        status('answer sent');
      }

      if (msg.type === 'answer' && msg.from === peerNpub) {
        const p = ensurePeer();
        await p.setRemoteDescription(new RTCSessionDescription(msg.sdp));
        status('call established');
      }

      if (msg.type === 'ice' && msg.from === peerNpub && msg.candidate) {
        const p = ensurePeer();
        try { await p.addIceCandidate(msg.candidate); } catch (_) {}
      }
    };

    ws.onclose = () => status('signaling disconnected');
  }

  document.getElementById('copyNpub').onclick = async () => {
    await navigator.clipboard.writeText(myNpub);
    status('npub copied');
  };

  document.getElementById('connect').onclick = connectSignal;
  document.getElementById('cam').onclick = () => startCamera().catch(e => status('camera error: ' + e.message));
  document.getElementById('call').onclick = () => startCall().catch(e => status('call error: ' + e.message));
  document.getElementById('mute').onclick = () => {
    if (!localStream) return;
    micMuted = !micMuted;
    for (const t of localStream.getAudioTracks()) t.enabled = !micMuted;
    document.getElementById('mute').textContent = micMuted ? 'Unmute mic' : 'Mute mic';
    status(micMuted ? 'mic muted' : 'mic unmuted');
  };
  document.getElementById('speaker').onclick = () => {
    speakerMuted = !speakerMuted;
    remoteVideo.muted = speakerMuted;
    document.getElementById('speaker').textContent = speakerMuted ? 'Unmute speaker' : 'Mute speaker';
    status(speakerMuted ? 'speaker muted' : 'speaker unmuted');
  };
})();
</script>
</body>
</html>`;

const server = http.createServer((req, res) => {
  if (req.url === '/' || req.url === '/index.html') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(html);
    return;
  }
  res.writeHead(404);
  res.end('not found');
});

const wss = new WebSocketServer({ server, path: '/ws' });
const peers = new Map(); // npub -> ws

function send(ws, obj) {
  if (ws && ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj));
}

wss.on('connection', (ws) => {
  let myNpub = null;

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(String(raw));

      if (msg.type === 'hello' && typeof msg.npub === 'string') {
        myNpub = msg.npub;
        peers.set(myNpub, ws);
        for (const [npub, peerWs] of peers.entries()) {
          if (npub !== myNpub) {
            send(peerWs, { type: 'peer-online', npub: myNpub });
            send(ws, { type: 'peer-online', npub });
          }
        }
        return;
      }

      if (!myNpub || !msg.to) return;
      const toWs = peers.get(msg.to);
      if (!toWs) return;

      if (['offer', 'answer', 'ice', 'probe', 'probe_ack'].includes(msg.type)) {
        send(toWs, { ...msg, from: myNpub });
      }
    } catch {
      // ignore malformed messages
    }
  });

  ws.on('close', () => {
    if (myNpub && peers.get(myNpub) === ws) peers.delete(myNpub);
  });
});

server.listen(port, () => {
  console.log(JSON.stringify({ app: 'fips-video-chat', url: `http://0.0.0.0:${port}` }, null, 2));
});
