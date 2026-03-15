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
    :root { color-scheme: dark; }
    body { font-family: system-ui, sans-serif; max-width: 980px; margin: 24px auto; padding: 0 12px; background:#0f1216; color:#dbe2ea; }
    .row { display: flex; gap: 8px; margin-bottom: 10px; align-items: center; }
    input, button { padding: 8px; font-size: 14px; background:#1b2129; color:#dbe2ea; border:1px solid #3a4655; border-radius:8px; }
    input { flex: 1; }
    button { cursor:pointer; }
    video { width: 48%; background: #090c10; border-radius: 8px; border:1px solid #2f3946; }
    #status { color: #9fb2c7; font-size: 13px; }
    #myNpub { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; word-break: break-all; color:#c5d7ea }
    #qr { width: 170px; height: 170px; border: 1px solid #2f3946; border-radius: 8px; background:#fff; }
    .panel { border:1px solid #2f3946; background:#141a22; border-radius:10px; padding:10px; margin-bottom:10px; }
    #stats { white-space: pre-wrap; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; color:#9ed0ff; }
  </style>
</head>
<body>
  <h2>Simple 1:1 Video Chat</h2>

  <div class="panel row" style="align-items:flex-start">
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
    <input id="peerNpub" placeholder="Peer npub (initiator fills this)" />
    <button id="scan">Scan QR</button>
    <button id="connect">Connect</button>
  </div>
  <div class="row" id="scanWrap" style="display:none">
    <video id="scanVideo" autoplay playsinline style="max-width:320px;border:1px solid #ccc;border-radius:8px"></video>
  </div>
  <div id="incomingWrap" style="margin:8px 0;padding:8px;border:1px solid #ddd;border-radius:8px;display:none">
    <strong>Incoming connection requests</strong>
    <div id="incomingList"></div>
  </div>

  <div class="row">
    <button id="cam">Start camera+mic</button>
    <button id="call">Call</button>
    <button id="mute">Mute mic</button>
    <button id="speaker">Mute speaker</button>
  </div>

  <p id="status">Status: idle</p>

  <div class="panel">
    <strong>Geek stats</strong>
    <div id="stats">collecting...</div>
  </div>

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
  const scanWrap = document.getElementById('scanWrap');
  const scanVideo = document.getElementById('scanVideo');
  const incomingWrap = document.getElementById('incomingWrap');
  const incomingList = document.getElementById('incomingList');
  const statsEl = document.getElementById('stats');

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
  let scanStream = null;
  let scanTimer = null;
  let statsTimer = null;
  let lastBytes = { sent: 0, recv: 0, ts: Date.now() };
  const pendingRequests = new Map();
  const allowedPeers = new Set();

  function status(s) { statusEl.textContent = 'Status: ' + s; }

  function renderIncoming() {
    const entries = Array.from(pendingRequests.keys());
    incomingWrap.style.display = entries.length ? 'block' : 'none';
    incomingList.innerHTML = '';
    for (const from of entries) {
      const row = document.createElement('div');
      row.style.marginTop = '6px';
      row.innerHTML = '<code style="font-size:12px">' + from + '</code> <button data-from="' + from + '">Accept</button>';
      incomingList.appendChild(row);
    }
    incomingList.querySelectorAll('button[data-from]').forEach((btn) => {
      btn.onclick = () => {
        const from = btn.getAttribute('data-from');
        pendingRequests.delete(from);
        renderIncoming();
        allowedPeers.add(from);
        peerNpub = from;
        peerNpubEl.value = from;
        send({ type: 'probe_ack', to: from });
        peerReachable = true;
        status('accepted peer ' + from.slice(0, 16) + '...');
      };
    });
  }

  function send(obj) {
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
  }

  async function renderStats() {
    if (!pc) {
      statsEl.textContent = 'pc: not created';
      return;
    }

    const stats = await pc.getStats();
    let selectedPair = null;
    let localCand = null;
    let remoteCand = null;
    let rttMs = null;
    let bytesSent = 0;
    let bytesReceived = 0;
    let audioOut = null;
    let audioIn = null;

    stats.forEach((r) => {
      if (r.type === 'transport' && r.selectedCandidatePairId) {
        selectedPair = stats.get(r.selectedCandidatePairId);
      }
      if (r.type === 'candidate-pair' && r.state === 'succeeded' && !selectedPair) {
        selectedPair = r;
      }
      if (r.type === 'outbound-rtp' && !r.isRemote) {
        bytesSent += r.bytesSent || 0;
        if (r.kind === 'audio') audioOut = r;
      }
      if (r.type === 'inbound-rtp' && !r.isRemote) {
        bytesReceived += r.bytesReceived || 0;
        if (r.kind === 'audio') audioIn = r;
      }
    });

    if (selectedPair) {
      localCand = stats.get(selectedPair.localCandidateId);
      remoteCand = stats.get(selectedPair.remoteCandidateId);
      if (typeof selectedPair.currentRoundTripTime === 'number') rttMs = Math.round(selectedPair.currentRoundTripTime * 1000);
    }

    const now = Date.now();
    const dt = Math.max(1, (now - lastBytes.ts) / 1000);
    const upMbps = (((bytesSent - lastBytes.sent) * 8) / dt / 1_000_000).toFixed(3);
    const downMbps = (((bytesReceived - lastBytes.recv) * 8) / dt / 1_000_000).toFixed(3);
    lastBytes = { sent: bytesSent, recv: bytesReceived, ts: now };

    const localIp = localCand?.address || localCand?.ip || 'n/a';
    const remoteIp = remoteCand?.address || remoteCand?.ip || 'n/a';

    statsEl.textContent = [
      'connectionState: ' + pc.connectionState,
      'iceConnectionState: ' + pc.iceConnectionState,
      'peerReachable: ' + peerReachable,
      'rttMs: ' + (rttMs ?? 'n/a'),
      'bytesSent: ' + bytesSent,
      'bytesReceived: ' + bytesReceived,
      'upMbps(now): ' + upMbps,
      'downMbps(now): ' + downMbps,
      'localCandidate: ' + localIp + ' (' + (localCand?.candidateType || 'n/a') + ', ' + (localCand?.networkType || 'n/a') + ')',
      'remoteCandidate: ' + remoteIp + ' (' + (remoteCand?.candidateType || 'n/a') + ')',
      'localIPv6? ' + String(localIp.includes(':')),
      'peerIPv6? ' + String(remoteIp.includes(':')),
      'audioOutPackets: ' + (audioOut?.packetsSent ?? 'n/a'),
      'audioInPackets: ' + (audioIn?.packetsReceived ?? 'n/a'),
      'audioInLost: ' + (audioIn?.packetsLost ?? 'n/a'),
    ].join('\n');
  }

  function startStatsLoop() {
    if (statsTimer) return;
    statsTimer = setInterval(() => {
      renderStats().catch(() => {});
    }, 1000);
  }

  function ensurePeer() {
    if (pc) return pc;
    pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
    startStatsLoop();

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

  async function startQrScan() {
    if (!('BarcodeDetector' in window)) {
      status('QR scan not supported in this browser; paste npub manually');
      return;
    }

    const detector = new BarcodeDetector({ formats: ['qr_code'] });
    scanStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
    scanVideo.srcObject = scanStream;
    scanWrap.style.display = 'flex';
    status('scanning QR...');

    scanTimer = setInterval(async () => {
      try {
        const codes = await detector.detect(scanVideo);
        if (!codes?.length) return;
        const value = (codes[0].rawValue || '').trim();
        if (value.startsWith('npub')) {
          peerNpubEl.value = value;
          stopQrScan();
          status('QR scanned');
        }
      } catch {
        // ignore transient detection errors
      }
    }, 300);
  }

  function stopQrScan() {
    if (scanTimer) { clearInterval(scanTimer); scanTimer = null; }
    if (scanStream) {
      for (const t of scanStream.getTracks()) t.stop();
      scanStream = null;
    }
    scanVideo.srcObject = null;
    scanWrap.style.display = 'none';
  }

  function connectSignal() {
    peerNpub = peerNpubEl.value.trim() || null;
    if (peerNpub && !peerNpub.startsWith('npub')) return status('invalid peer npub');

    ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws');

    ws.onopen = () => {
      send({ type: 'hello', npub: myNpub });
      if (peerNpub) {
        allowedPeers.add(peerNpub);
        send({ type: 'probe', to: peerNpub });
        status('signaling connected; probing peer...');
      } else {
        status('signaling connected; waiting for incoming request');
      }
    };

    ws.onmessage = async (ev) => {
      const msg = JSON.parse(ev.data);
      if (!msg) return;

      if (msg.type === 'peer-online' && peerNpub && msg.npub === peerNpub) {
        status('peer is online');
      }

      if (msg.type === 'probe') {
        if (!allowedPeers.has(msg.from)) {
          pendingRequests.set(msg.from, true);
          renderIncoming();
          status('incoming request from ' + msg.from.slice(0, 16) + '...');
        } else {
          send({ type: 'probe_ack', to: msg.from });
        }
      }

      if (msg.type === 'probe_ack' && (!peerNpub || msg.from === peerNpub)) {
        peerNpub = msg.from;
        peerNpubEl.value = msg.from;
        allowedPeers.add(msg.from);
        peerReachable = true;
        status('peer reachable: ' + msg.from.slice(0, 16) + '...');
      }

      if (msg.type === 'offer' && allowedPeers.has(msg.from)) {
        const p = ensurePeer();
        await p.setRemoteDescription(new RTCSessionDescription(msg.sdp));
        const answer = await p.createAnswer();
        await p.setLocalDescription(answer);
        send({ type: 'answer', to: peerNpub, sdp: answer });
        status('answer sent');
      }

      if (msg.type === 'answer' && allowedPeers.has(msg.from)) {
        const p = ensurePeer();
        await p.setRemoteDescription(new RTCSessionDescription(msg.sdp));
        status('call established');
      }

      if (msg.type === 'ice' && allowedPeers.has(msg.from) && msg.candidate) {
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

  document.getElementById('scan').onclick = () => {
    if (scanStream) stopQrScan();
    else startQrScan().catch(e => status('scan error: ' + e.message));
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
