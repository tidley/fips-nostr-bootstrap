#!/usr/bin/env node
import 'dotenv/config';
import http from 'node:http';

function arg(name, fallback = '') {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

const port = Number(arg('--port', '8088'));
const relayList = (process.env.NOSTR_RELAYS || 'wss://nos.lol,wss://relay.damus.io,wss://relay.primal.net,wss://nip17.tomdwyer.uk').split(',').map((s) => s.trim()).filter(Boolean);

const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>FIPS Simple Video Chat</title>
  <style>
    :root { color-scheme: dark; }
    body { font-family: Roboto, system-ui, sans-serif; max-width: 1100px; margin: 18px auto; padding: 0 12px; background:#202124; color:#e8eaed; }
    .row { display: flex; gap: 8px; margin-bottom: 10px; align-items: center; }
    input, button { padding: 10px 12px; font-size: 14px; background:#2d2f31; color:#e8eaed; border:1px solid #4a4d52; border-radius:24px; }
    input { flex: 1; border-radius:12px; }
    button { cursor:pointer; transition:all .15s ease; }
    button:hover { filter: brightness(1.1); }
    #localVideo { width: 24%; background: #111; border-radius: 12px; border:1px solid #3c4043; }
    #remoteVideo { width: 74%; background: #111; border-radius: 12px; border:1px solid #3c4043; }
    #status { color: #9aa0a6; font-size: 13px; }
    #myNpub { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; word-break: break-all; color:#c5d7ea }
    #qr { width: 170px; height: 170px; border: 1px solid #3c4043; border-radius: 12px; background:#fff; }
    .panel { border:1px solid #3c4043; background:#2b2c2f; border-radius:12px; padding:12px; margin-bottom:10px; }
    #stats { white-space: pre-wrap; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; color:#8ab4f8; }
    .controls { position: sticky; bottom: 10px; background:#2b2c2f; border:1px solid #3c4043; border-radius:32px; padding:10px; justify-content:center; }
    .danger { background:#d93025; border-color:#d93025; }
    .primary { background:#1a73e8; border-color:#1a73e8; }
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
    <input id="peerNpub" placeholder="Peer npub (initiator only)" />
    <button id="scan">Scan QR</button>
    <button id="request">Send Request</button>
  </div>
  <div class="row" id="scanWrap" style="display:none">
    <video id="scanVideo" autoplay playsinline style="max-width:320px;border:1px solid #ccc;border-radius:8px"></video>
  </div>
  <div id="incomingWrap" class="panel" style="display:none">
    <strong>Incoming requests</strong>
    <div id="incomingList"></div>
  </div>

  <div class="row controls">
    <button id="toggleCall" class="primary" style="display:none">Join call</button>
    <button id="toggleCam">Turn on camera</button>
    <button id="mute">Unmute mic</button>
    <button id="speaker">Mute speaker</button>
  </div>

  <p id="status">Status: idle</p>

  <div class="row">
    <video id="localVideo" autoplay playsinline muted></video>
    <video id="remoteVideo" autoplay playsinline></video>
  </div>

  <div class="panel">
    <strong>Stats</strong>
    <div id="stats">collecting...</div>
  </div>

<script type="module">
import { SimplePool, generateSecretKey, getPublicKey, nip19 } from 'https://esm.sh/nostr-tools@2.17.0';
import { wrapEvent, unwrapEvent } from 'https://esm.sh/nostr-tools@2.17.0/nip17';
import jsQR from 'https://esm.sh/jsqr@1.4.0';
import QRCode from 'https://esm.sh/qrcode@1.5.3';

(() => {
  const RELAYS = ${JSON.stringify(relayList)};
  const APP = 'fips.video.v1';

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
  const pool = new SimplePool();

  myNpubEl.textContent = myNpub;
  QRCode.toDataURL(myNpub, { width: 170, margin: 1 }).then((url) => (qrEl.src = url));

  let localStream = null;
  let pc = null;
  let peerNpub = null;
  let peerPubkey = null;
  let peerReachable = false;
  let micMuted = true;
  let speakerMuted = false;
  let camEnabled = false;
  let callActive = false;
  let pendingRemoteOffer = null;
  let scanStream = null;
  let scanTimer = null;
  let statsTimer = null;
  let lastBytes = { sent: 0, recv: 0, ts: Date.now() };
  let selectedPathReason = 'n/a';
  let callStartedAt = 0;
  const localCandidates = [];
  const remoteCandidates = [];
  const pendingRequests = new Map();
  const allowedPeers = new Set();

  function status(s) { statusEl.textContent = 'Status: ' + s; }

  function npubToPubkey(npub) {
    const d = nip19.decode(npub);
    if (d.type !== 'npub') throw new Error('invalid npub');
    return d.data;
  }

  function isPrivateIPv4(ip) {
    return /^10\./.test(ip) || /^192\.168\./.test(ip) || /^172\.(1[6-9]|2\d|3[0-1])\./.test(ip);
  }

  function isLocalIPv6(ip) {
    return ip.startsWith('fd') || ip.startsWith('fc') || ip.startsWith('fe80:');
  }

  function parseCandidate(raw) {
    const parts = String(raw || '').split(' ');
    // candidate:foundation component protocol priority ip port typ type ...
    if (parts.length < 8) return null;
    return {
      protocol: parts[2],
      ip: parts[4],
      port: Number(parts[5]),
      type: parts[7],
    };
  }

  function candidateScore(c) {
    if (!c) return 0;
    const ip = c.ip || '';
    if (ip.includes(':') && isLocalIPv6(ip)) return 500;
    if (!ip.includes(':') && isPrivateIPv4(ip)) return 400;
    if (c.type === 'host') return 300;
    if (c.type === 'srflx') return 200;
    if (c.type === 'relay') return 100;
    return 50;
  }

  function bloomHex(list) {
    let bits = 0n;
    for (const c of list) {
      const s = String(c.ip) + ':' + String(c.port) + ':' + String(c.type);
      let h = 0;
      for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
      bits |= 1n << BigInt(h % 64);
    }
    return bits.toString(16).padStart(16, '0');
  }

  function sameLan(a, b) {
    if (!a || !b) return false;
    if (a.includes(':') || b.includes(':')) return isLocalIPv6(a) && isLocalIPv6(b);
    const aa = a.split('.');
    const bb = b.split('.');
    return aa.length === 4 && bb.length === 4 && aa[0] === bb[0] && aa[1] === bb[1] && aa[2] === bb[2];
  }

  function sendNip17(toPubkey, body) {
    const event = wrapEvent(sk, { publicKey: toPubkey }, JSON.stringify({ app: APP, ...body }));
    Promise.allSettled(pool.publish(RELAYS, event)).catch(() => undefined);
  }

  function sendCandidateSnapshot() {
    if (!peerPubkey) return;
    sendNip17(peerPubkey, {
      type: 'fips_candidates',
      candidates: localCandidates,
      bloom: bloomHex(localCandidates),
      ts: Date.now(),
    });
  }

  function renderIncoming() {
    const entries = Array.from(pendingRequests.entries());
    incomingWrap.style.display = entries.length ? 'block' : 'none';
    incomingList.innerHTML = '';

    for (const [fromNpub, meta] of entries) {
      const row = document.createElement('div');
      row.style.marginTop = '8px';
      row.innerHTML = '<code style="font-size:12px">' + fromNpub + '</code> <button data-from="' + fromNpub + '">Accept</button>';
      incomingList.appendChild(row);
    }

    incomingList.querySelectorAll('button[data-from]').forEach((btn) => {
      btn.onclick = () => {
        const fromNpub = btn.getAttribute('data-from');
        const req = pendingRequests.get(fromNpub);
        if (!req) return;
        pendingRequests.delete(fromNpub);
        renderIncoming();

        peerNpub = fromNpub;
        peerPubkey = req.fromPubkey;
        peerNpubEl.value = fromNpub;
        allowedPeers.add(peerPubkey);
        peerReachable = true;
        const joinBtn = document.getElementById('toggleCall');
        joinBtn.style.display = 'inline-block';

        sendNip17(peerPubkey, { type: 'request_accept', ts: Date.now() });
        status('accepted request from ' + fromNpub.slice(0, 16) + '...');
      };
    });
  }

  function startListening() {
    pool.subscribeMany(RELAYS, { kinds: [1059], '#p': [pub], since: Math.floor(Date.now() / 1000) - 3 * 24 * 60 * 60 }, {
      onevent: async (evt) => {
        try {
          const rumor = unwrapEvent(evt, sk);
          const msg = JSON.parse(rumor.content);
          if (!msg || msg.app !== APP) return;

          const fromPubkey = rumor.pubkey;
          const fromNpub = nip19.npubEncode(fromPubkey);

          if (msg.type === 'request_connect') {
            pendingRequests.set(fromNpub, { fromPubkey, ts: msg.ts || Date.now() });
            renderIncoming();
            status('incoming request from ' + fromNpub.slice(0, 16) + '...');
            return;
          }

          if (msg.type === 'request_accept') {
            if (peerPubkey && fromPubkey !== peerPubkey) return;
            peerPubkey = fromPubkey;
            peerNpub = fromNpub;
            allowedPeers.add(fromPubkey);
            peerReachable = true;
            const joinBtn = document.getElementById('toggleCall');
            joinBtn.style.display = 'inline-block';
            status('peer accepted request: ' + fromNpub.slice(0, 16) + '...');
            return;
          }

          if (!allowedPeers.has(fromPubkey)) return;

          if (msg.type === 'fips_candidates') {
            remoteCandidates.length = 0;
            if (Array.isArray(msg.candidates)) {
              for (const c of msg.candidates) remoteCandidates.push(c);
            }
            return;
          }

          if (msg.type === 'offer') {
            pendingRemoteOffer = { fromPubkey, sdp: msg.sdp };
            const b = document.getElementById('toggleCall');
            b.style.display = 'inline-block';
            b.textContent = 'Join call';
            b.classList.add('primary');
            b.classList.remove('danger');
            status('incoming call from ' + fromNpub.slice(0, 16) + '... click Join call');
            return;
          }

          if (msg.type === 'answer') {
            const p = ensurePeer();
            await p.setRemoteDescription(new RTCSessionDescription(msg.sdp));
            callActive = true;
            const b = document.getElementById('toggleCall');
            b.textContent = 'End call';
            b.classList.remove('primary');
            b.classList.add('danger');
            status('call established');
            return;
          }

          if (msg.type === 'call_end') {
            endCall(false);
            status('peer ended call');
            return;
          }

          if (msg.type === 'ice' && msg.candidate) {
            const p = ensurePeer();
            try { await p.addIceCandidate(msg.candidate); } catch (_) {}
          }
        } catch {
          // ignore malformed messages
        }
      },
    });

    status('listening on relays: ' + RELAYS.join(', '));
  }

  async function renderStats() {
    if (!pc) { statsEl.textContent = 'pc: not created'; return; }

    const stats = await pc.getStats();
    let selectedPair = null;
    let localCand = null;
    let remoteCand = null;
    let rttMs = null;
    let bytesSent = 0;
    let bytesReceived = 0;

    stats.forEach((r) => {
      if (r.type === 'transport' && r.selectedCandidatePairId) selectedPair = stats.get(r.selectedCandidatePairId);
      if (r.type === 'candidate-pair' && r.state === 'succeeded' && !selectedPair) selectedPair = r;
      if (r.type === 'outbound-rtp' && !r.isRemote) bytesSent += r.bytesSent || 0;
      if (r.type === 'inbound-rtp' && !r.isRemote) bytesReceived += r.bytesReceived || 0;
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

    const sentMB = (bytesSent / (1024 * 1024)).toFixed(2);
    const recvMB = (bytesReceived / (1024 * 1024)).toFixed(2);

    const localIp = localCand?.address || localCand?.ip || 'n/a';
    const remoteIp = remoteCand?.address || remoteCand?.ip || 'n/a';

    if (localIp !== 'n/a' && remoteIp !== 'n/a') {
      if (sameLan(localIp, remoteIp)) {
        selectedPathReason = 'LAN match via bloom hit';
      } else if (localIp.includes(':') && remoteIp.includes(':')) {
        selectedPathReason = 'IPv6 preferred path';
      } else {
        selectedPathReason = 'broader-path fallback';
      }
    }

    statsEl.textContent = [
      'connectionState: ' + pc.connectionState,
      'iceConnectionState: ' + pc.iceConnectionState,
      'peerReachable: ' + peerReachable,
      'selectedPathReason: ' + selectedPathReason,
      'localBloom: ' + bloomHex(localCandidates),
      'remoteBloom: ' + bloomHex(remoteCandidates),
      'rttMs: ' + (rttMs ?? 'n/a'),
      'sentMB: ' + sentMB,
      'receivedMB: ' + recvMB,
      'upMbps(now): ' + upMbps,
      'downMbps(now): ' + downMbps,
      'localCandidate: ' + localIp,
      'remoteCandidate: ' + remoteIp,
      'localIPv6? ' + String(localIp.includes(':')),
      'peerIPv6? ' + String(remoteIp.includes(':')),
    ].join('\\n');
  }

  function startStatsLoop() {
    if (statsTimer) return;
    statsTimer = setInterval(() => renderStats().catch(() => {}), 1000);
  }

  function ensurePeer() {
    if (pc) return pc;
    pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
    startStatsLoop();

    pc.onicecandidate = (e) => {
      if (!e.candidate || !peerPubkey) return;

      const parsed = parseCandidate(e.candidate.candidate);
      if (parsed) {
        const exists = localCandidates.some((c) => c.ip === parsed.ip && c.port === parsed.port && c.type === parsed.type);
        if (!exists) {
          localCandidates.push(parsed);
          localCandidates.sort((a, b) => candidateScore(b) - candidateScore(a));
          sendCandidateSnapshot();
        }
      }

      const sendIce = () => sendNip17(peerPubkey, { type: 'ice', candidate: e.candidate });
      const isPreferredLocal = parsed && (isPrivateIPv4(parsed.ip) || isLocalIPv6(parsed.ip) || parsed.type === 'host');

      // Force preferred LAN/local candidates first for ~1.5s, then broaden
      if (isPreferredLocal || Date.now() - callStartedAt > 1500) sendIce();
      else setTimeout(sendIce, 1500);
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
    for (const t of localStream.getVideoTracks()) t.enabled = camEnabled;
    for (const t of localStream.getAudioTracks()) t.enabled = !micMuted;
    status('media ready');
    if (pc) for (const t of localStream.getTracks()) pc.addTrack(t, localStream);
  }

  async function startCall() {
    if (!peerPubkey) return status('no accepted peer');
    if (!peerReachable) return status('peer not accepted yet');
    if (pc && (pc.connectionState === 'closed' || pc.signalingState === 'closed')) pc = null;
    const p = ensurePeer();
    callStartedAt = Date.now();

    if (pendingRemoteOffer && pendingRemoteOffer.fromPubkey === peerPubkey) {
      await p.setRemoteDescription(new RTCSessionDescription(pendingRemoteOffer.sdp));
      const answer = await p.createAnswer();
      await p.setLocalDescription(answer);
      sendNip17(peerPubkey, { type: 'answer', sdp: answer });
      pendingRemoteOffer = null;
      status('joined call (answer sent)');
    } else {
      const offer = await p.createOffer();
      await p.setLocalDescription(offer);
      sendNip17(peerPubkey, { type: 'offer', sdp: offer });
      status('offer sent');
    }

    callActive = true;
    document.getElementById('toggleCall').textContent = 'End call';
    document.getElementById('toggleCall').classList.remove('primary');
    document.getElementById('toggleCall').classList.add('danger');
  }

  function endCall(notifyPeer = true) {
    if (notifyPeer && peerPubkey) {
      sendNip17(peerPubkey, { type: 'call_end', ts: Date.now() });
    }

    if (pc) {
      pc.getSenders().forEach((s) => { try { pc.removeTrack(s); } catch {} });
      pc.close();
      pc = null;
    }
    pendingRemoteOffer = null;
    remoteVideo.srcObject = null;
    selectedPathReason = 'n/a';
    localCandidates.length = 0;
    remoteCandidates.length = 0;
    if (statsTimer) { clearInterval(statsTimer); statsTimer = null; }
    statsEl.textContent = 'call ended';
    callActive = false;
    const b = document.getElementById('toggleCall');
    b.textContent = 'Join call';
    b.classList.remove('danger');
    b.classList.add('primary');
    status('call ended');
  }

  async function startQrScan() {
    scanStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
    scanVideo.srcObject = scanStream;
    scanWrap.style.display = 'flex';
    status('scanning QR...');

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const hasNative = 'BarcodeDetector' in window;
    const detector = hasNative ? new BarcodeDetector({ formats: ['qr_code'] }) : null;

    scanTimer = setInterval(async () => {
      try {
        if (scanVideo.videoWidth < 20 || scanVideo.videoHeight < 20) return;
        let value = '';

        if (detector) {
          const codes = await detector.detect(scanVideo);
          if (codes?.length) value = (codes[0].rawValue || '').trim();
        } else {
          canvas.width = scanVideo.videoWidth;
          canvas.height = scanVideo.videoHeight;
          ctx.drawImage(scanVideo, 0, 0, canvas.width, canvas.height);
          const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const code = jsQR(img.data, img.width, img.height);
          if (code?.data) value = String(code.data).trim();
        }

        if (value.startsWith('npub')) {
          peerNpubEl.value = value;
          stopQrScan();
          status('QR scanned');
        }
      } catch {
        // ignore transient errors
      }
    }, 250);
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

  function sendRequest() {
    const npub = peerNpubEl.value.trim();
    if (!npub.startsWith('npub')) return status('invalid peer npub');
    peerNpub = npub;
    try {
      peerPubkey = npubToPubkey(npub);
      sendNip17(peerPubkey, { type: 'request_connect', ts: Date.now() });
      status('request sent to ' + npub.slice(0, 16) + '...');
    } catch (e) {
      status('npub decode error: ' + e.message);
    }
  }

  document.getElementById('copyNpub').onclick = async () => {
    await navigator.clipboard.writeText(myNpub);
    status('npub copied');
  };

  document.getElementById('scan').onclick = () => {
    if (scanStream) stopQrScan();
    else startQrScan().catch((e) => status('scan error: ' + e.message));
  };

  document.getElementById('request').onclick = sendRequest;
  document.getElementById('toggleCall').onclick = () => {
    if (callActive) endCall();
    else startCall().catch((e) => status('call error: ' + e.message));
  };
  document.getElementById('toggleCam').onclick = async () => {
    if (!localStream) {
      try { await startCamera(); } catch (e) { status('camera error: ' + e.message); return; }
    }
    camEnabled = !camEnabled;
    for (const t of localStream.getVideoTracks()) t.enabled = camEnabled;
    document.getElementById('toggleCam').textContent = camEnabled ? 'Turn off camera' : 'Turn on camera';
    status(camEnabled ? 'camera on' : 'camera off');
  };
  document.getElementById('mute').onclick = async () => {
    if (!localStream) {
      try { await startCamera(); } catch (e) { status('mic error: ' + e.message); return; }
    }
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

  startListening();
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

server.listen(port, () => {
  console.log(JSON.stringify({ app: 'fips-video-chat', url: `http://0.0.0.0:${port}`, relays: relayList }, null, 2));
});
