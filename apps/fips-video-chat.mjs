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
    body { font-family: system-ui, sans-serif; max-width: 900px; margin: 24px auto; padding: 0 12px; }
    .row { display: flex; gap: 8px; margin-bottom: 10px; }
    input, button { padding: 8px; font-size: 14px; }
    input { flex: 1; }
    video { width: 48%; background: #111; border-radius: 8px; }
    #status { color: #555; font-size: 13px; }
  </style>
</head>
<body>
  <h2>Simple 1:1 Video Chat</h2>
  <div class="row">
    <input id="room" placeholder="room id (e.g. demo123)" />
    <button id="join">Join</button>
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

<script>
(() => {
  const statusEl = document.getElementById('status');
  const roomEl = document.getElementById('room');
  const localVideo = document.getElementById('localVideo');
  const remoteVideo = document.getElementById('remoteVideo');

  let ws = null;
  let room = null;
  let localStream = null;
  let pc = null;
  let micMuted = false;
  let speakerMuted = false;

  function status(s) { statusEl.textContent = 'Status: ' + s; }

  function send(obj) {
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
  }

  function ensurePeer() {
    if (pc) return pc;
    pc = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
    });

    pc.onicecandidate = (e) => {
      if (e.candidate) send({ type: 'ice', room, candidate: e.candidate });
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
    const p = ensurePeer();
    const offer = await p.createOffer();
    await p.setLocalDescription(offer);
    send({ type: 'offer', room, sdp: offer });
    status('offer sent');
  }

  function joinRoom() {
    room = roomEl.value.trim();
    if (!room) return status('enter room id');

    ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws');

    ws.onopen = () => {
      send({ type: 'join', room });
      status('joined room ' + room);
    };

    ws.onmessage = async (ev) => {
      const msg = JSON.parse(ev.data);
      if (!msg || msg.room !== room) return;

      if (msg.type === 'peer-joined') {
        status('peer joined');
      }

      if (msg.type === 'offer') {
        const p = ensurePeer();
        await p.setRemoteDescription(new RTCSessionDescription(msg.sdp));
        const answer = await p.createAnswer();
        await p.setLocalDescription(answer);
        send({ type: 'answer', room, sdp: answer });
        status('answer sent');
      }

      if (msg.type === 'answer') {
        const p = ensurePeer();
        await p.setRemoteDescription(new RTCSessionDescription(msg.sdp));
        status('call established');
      }

      if (msg.type === 'ice' && msg.candidate) {
        const p = ensurePeer();
        try { await p.addIceCandidate(msg.candidate); } catch (_) {}
      }
    };

    ws.onclose = () => status('disconnected');
  }

  document.getElementById('join').onclick = joinRoom;
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
const rooms = new Map(); // room -> Set<ws>

function broadcast(room, payload, sender) {
  const peers = rooms.get(room);
  if (!peers) return;
  const data = JSON.stringify(payload);
  for (const ws of peers) {
    if (ws !== sender && ws.readyState === ws.OPEN) ws.send(data);
  }
}

wss.on('connection', (ws) => {
  let joinedRoom = null;

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(String(raw));
      if (msg.type === 'join' && msg.room) {
        joinedRoom = msg.room;
        if (!rooms.has(joinedRoom)) rooms.set(joinedRoom, new Set());
        rooms.get(joinedRoom).add(ws);
        broadcast(joinedRoom, { type: 'peer-joined', room: joinedRoom }, ws);
        return;
      }

      if (!joinedRoom) return;
      if (['offer', 'answer', 'ice'].includes(msg.type)) {
        broadcast(joinedRoom, { ...msg, room: joinedRoom }, ws);
      }
    } catch {
      // ignore malformed messages
    }
  });

  ws.on('close', () => {
    if (!joinedRoom) return;
    const peers = rooms.get(joinedRoom);
    if (!peers) return;
    peers.delete(ws);
    if (peers.size === 0) rooms.delete(joinedRoom);
  });
});

server.listen(port, () => {
  console.log(JSON.stringify({ app: 'fips-video-chat', url: `http://0.0.0.0:${port}` }, null, 2));
});
