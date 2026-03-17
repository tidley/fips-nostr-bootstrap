#!/usr/bin/env node
import 'dotenv/config';
import http from 'node:http';

function arg(name, fallback = '') {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

const port = Number(arg('--port', '8088'));
const relayList = (process.env.NOSTR_RELAYS || 'wss://nos.lol,wss://relay.damus.io,wss://relay.primal.net,wss://nip17.tomdwyer.uk')
  .split(',').map((s) => s.trim()).filter(Boolean);

const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>FIPS Video Chat</title>
  <style>
    :root { color-scheme: dark; }
    body { margin:0; background:#202124; color:#e8eaed; font-family: Roboto, system-ui, sans-serif; }
    .app { max-width:1200px; margin:0 auto; min-height:100vh; display:flex; flex-direction:column; }
    .topbar { display:flex; justify-content:space-between; align-items:center; padding:12px 16px; }
    .title { font-size:18px; font-weight:600; }
    .badge { font-size:12px; padding:6px 10px; border-radius:999px; background:#2d2f31; color:#9aa0a6; }
    .badge.ok { color:#8ee4a1; }
    .badge.warn { color:#f9ab00; }
    .badge.err { color:#f28b82; }

    .precall { padding:16px; display:grid; gap:12px; grid-template-columns: 1fr 280px; }
    .card { background:#2b2c2f; border:1px solid #3c4043; border-radius:16px; padding:14px; }
    .row { display:flex; gap:8px; align-items:center; }
    input, button { background:#1f232a; color:#e8eaed; border:1px solid #3c4043; border-radius:12px; padding:10px 12px; font-size:14px; }
    input { width:100%; }
    button { cursor:pointer; }
    .primary { background:#1a73e8; border-color:#1a73e8; }
    .danger { background:#d93025; border-color:#d93025; }
    .muted { color:#9aa0a6; font-size:12px; }
    #myNpub { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size:12px; word-break:break-all; }
    #qr { width:240px; max-width:100%; border-radius:12px; background:#fff; }

    .scanWrap { display:none; margin-top:8px; }
    #scanVideo { width:100%; max-width:320px; border-radius:12px; border:1px solid #3c4043; }

    .stage { flex:1; padding:10px 16px 6px; display:none; }
    .videoStage { position:relative; border-radius:22px; overflow:hidden; background:#111; min-height:56vh; border:1px solid #3c4043; }
    #remoteVideo { width:100%; height:100%; object-fit:contain; background:#111; }
    .remote-landscape #remoteVideo { object-fit:contain; }
    .remote-portrait #remoteVideo { object-fit:contain; }
    #localVideo { position:absolute; right:16px; top:16px; width:22%; min-width:160px; max-width:280px; border-radius:12px; border:1px solid #3c4043; background:#000; object-fit:cover; }
    .overlayStatus { position:absolute; left:14px; top:14px; padding:8px 10px; border-radius:12px; background:rgba(32,33,36,.72); font-size:12px; color:#d2d7dc; backdrop-filter: blur(6px); }

    .controls { position:sticky; bottom:10px; display:flex; justify-content:center; gap:10px; padding:12px; }
    .ctrl { width:44px; height:44px; border-radius:50%; border:1px solid #3c4043; background:#2d2f31; color:#e8eaed; display:flex; align-items:center; justify-content:center; }
    .ctrl svg { width:20px; height:20px; stroke: currentColor; fill:none; stroke-width:1.8; stroke-linecap:round; stroke-linejoin:round; }
    .ctrl.off { color:#f28b82; border-color:#5b2a2a; }
    .ctrl.wide { width:auto; padding:0 16px; border-radius:999px; font-size:14px; }

    .debug { margin:8px 16px 16px; }
    details { background:#2b2c2f; border:1px solid #3c4043; border-radius:12px; padding:10px 12px; }
    #stats { margin-top:8px; white-space:pre-wrap; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size:12px; color:#8ab4f8; }

    #incomingWrap { display:none; margin-top:8px; }
    #incomingList > div { margin-top:8px; }

    dialog { border:1px solid #3c4043; border-radius:14px; background:#2b2c2f; color:#e8eaed; max-width:520px; width:92vw; }
    @media (max-width: 860px) {
      .precall { grid-template-columns: 1fr; }
      #localVideo { width:15%; min-width:96px; right:8px; top:8px; }
      .controls { padding-bottom: max(12px, env(safe-area-inset-bottom)); }
    }
  </style>
</head>
<body>
  <div class="app">
    <div class="topbar">
      <div class="title">Video Chat</div>
      <div id="connBadge" class="badge">Waiting</div>
      <div class="row">
        <button id="openInfo">Info</button>
      </div>
    </div>

    <section id="preCall" class="precall">
      <div class="card">
        <div class="muted">Peer identity (initiator)</div>
      <div class="row" style="margin-top:6px">
        <button id="useNsec">Use nsec</button>
        <button id="clearNsec">Use ephemeral</button>
        <span id="idMode" class="muted"></span>
      </div>
        <div class="row" style="margin-top:6px">
          <input id="peerNpub" placeholder="Paste peer npub" />
        </div>
        <div class="row" style="margin-top:8px">
          <button id="scan">Scan QR</button>
          <button id="request" class="primary">Send Request</button>
        </div>
        <div id="scanWrap" class="scanWrap"><video id="scanVideo" autoplay playsinline></video></div>

        <div id="incomingWrap" class="card" style="margin-top:12px;padding:10px">
          <strong>Incoming requests</strong>
          <div id="incomingList"></div>
        </div>

        <div class="muted" style="margin-top:10px">Relay signaling only. Media is P2P WebRTC.</div>
      </div>

      <div class="card" style="text-align:center">
        <img id="qr" alt="npub QR" />
        <div class="muted" style="margin-top:8px">Your ephemeral npub</div>
        <div id="myNpub"></div>
        <button id="copyNpub" style="margin-top:8px">Copy npub</button>
      </div>
    </section>

    <section id="inCall" class="stage">
      <div class="videoStage">
        <video id="remoteVideo" autoplay playsinline></video>
        <video id="localVideo" autoplay playsinline muted></video>
        <div id="overlayStatus" class="overlayStatus">Waiting for peer…</div>
      </div>
      <div class="controls">
        <button id="toggleMic" class="ctrl" title="Mic" aria-label="Mic">
          <svg viewBox="0 0 24 24"><path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 1 0 6 0V6a3 3 0 0 0-3-3Z"/><path d="M19 11a7 7 0 0 1-14 0"/><path d="M12 18v3"/><path d="M8 21h8"/></svg>
        </button>
        <button id="toggleCam" class="ctrl" title="Camera" aria-label="Camera">
          <svg viewBox="0 0 24 24"><rect x="3" y="7" width="13" height="10" rx="2"/><path d="m16 10 5-3v10l-5-3z"/></svg>
        </button>
        <button id="toggleSpeaker" class="ctrl" title="Speaker" aria-label="Speaker">
          <svg viewBox="0 0 24 24"><path d="M11 5 6 9H3v6h3l5 4V5Z"/><path d="M15.5 9.5a4.5 4.5 0 0 1 0 5"/><path d="M18.5 7a8 8 0 0 1 0 10"/></svg>
        </button>
        <button id="joinEnd" class="ctrl wide primary">Join call</button>
      </div>
    </section>

    <div class="debug">
      <details>
        <summary>Diagnostics</summary>
        <div id="stats">collecting...</div>
      </details>
    </div>
  </div>

  <dialog id="infoModal">
    <h3 style="margin-top:0">Session info</h3>
    <p class="muted">Temporary identity for this page session:</p>
    <p id="infoNpub" style="font-family: ui-monospace, SFMono-Regular, Menlo, monospace; word-break:break-all"></p>
    <div class="row" style="justify-content:flex-end;margin-top:12px">
      <button id="closeInfo">Close</button>
    </div>
  </dialog>

<script type="module">
import { SimplePool, generateSecretKey, getPublicKey, nip19, finalizeEvent } from 'https://esm.sh/nostr-tools@2.17.0';
import { unwrapEvent } from 'https://esm.sh/nostr-tools@2.17.0/nip17';
import jsQR from 'https://esm.sh/jsqr@1.4.0';
import QRCode from 'https://esm.sh/qrcode@1.5.3';

(() => {
  const RELAYS = ${JSON.stringify(relayList)};
  const APP = 'fips.video.v1';
  const STUN_URL = ${JSON.stringify(process.env.FIPS_STUN_URL || 'stun:nip17.tomdwyer.uk:3478')};
  const SIGNAL_KIND = Number(${JSON.stringify(process.env.FIPS_SIGNAL_KIND || '1059')});

  const dbg = (stage, message, extra) => {
    const ts = new Date().toISOString();
    if (extra !== undefined) console.info('[fips-video][' + ts + '][' + stage + '] ' + message, extra);
    else console.info('[fips-video][' + ts + '][' + stage + '] ' + message);
  };
  const dErr = (stage, message, err, extra) => {
    if (extra !== undefined) console.error('[fips-video][' + stage + '] ' + message, { err, extra });
    else console.error('[fips-video][' + stage + '] ' + message, err);
  };

  const connBadge = document.getElementById('connBadge');
  const overlayStatus = document.getElementById('overlayStatus');
  const preCall = document.getElementById('preCall');
  const inCall = document.getElementById('inCall');

  const peerNpubEl = document.getElementById('peerNpub');
  const localVideo = document.getElementById('localVideo');
  const remoteVideo = document.getElementById('remoteVideo');
  const myNpubEl = document.getElementById('myNpub');
  const infoNpubEl = document.getElementById('infoNpub');
  const idModeEl = document.getElementById('idMode');
  const qrEl = document.getElementById('qr');

  const scanWrap = document.getElementById('scanWrap');
  const scanVideo = document.getElementById('scanVideo');
  const incomingWrap = document.getElementById('incomingWrap');
  const incomingList = document.getElementById('incomingList');

  const statsEl = document.getElementById('stats');
  const joinEndBtn = document.getElementById('joinEnd');
  const micBtn = document.getElementById('toggleMic');
  const camBtn = document.getElementById('toggleCam');
  const speakerBtn = document.getElementById('toggleSpeaker');

  const infoModal = document.getElementById('infoModal');

  const resolveIdentity = () => {
    const saved = sessionStorage.getItem('fips_video_nsec');
    if (saved) {
      try {
        const dec = nip19.decode(saved);
        if (dec.type === 'nsec') {
          const sk = dec.data;
          const pub = getPublicKey(sk);
          return { sk, pub, npub: nip19.npubEncode(pub), mode: 'nsec' };
        }
      } catch (err) {
        dErr('identity', 'saved nsec invalid, falling back to ephemeral', err);
        sessionStorage.removeItem('fips_video_nsec');
      }
    }

    const sk = generateSecretKey();
    const pub = getPublicKey(sk);
    return { sk, pub, npub: nip19.npubEncode(pub), mode: 'ephemeral' };
  };

  const ident = resolveIdentity();
  dbg('init', 'identity resolved', { mode: ident.mode, npub: ident.npub });
  const sk = ident.sk;
  const pub = ident.pub;
  const myNpub = ident.npub;
  const pool = new SimplePool();

  myNpubEl.textContent = myNpub;
  infoNpubEl.textContent = myNpub;
  idModeEl.textContent = ident.mode === 'nsec' ? 'Identity: nsec' : 'Identity: ephemeral';
  QRCode.toDataURL(myNpub, { width: 240, margin: 1 }).then((url) => (qrEl.src = url));

  let localStream = null;
  let pc = null;
  let peerNpub = null;
  let peerPubkey = null;
  let peerReachable = false;
  let callActive = false;
  let callStartedAt = 0;
  let reconnectAttempts = 0;
  let reconnectTimer = null;
  const MAX_RECONNECT_ATTEMPTS = 3;

  let micMuted = true;
  let camEnabled = false;
  let speakerMuted = false;

  let scanStream = null;
  let scanTimer = null;
  let statsTimer = null;
  let lastBytes = { sent: 0, recv: 0, ts: Date.now() };

  let pendingRemoteOffer = null;
  let selectedPathReason = 'n/a';
  let sessionId = (globalThis.crypto?.randomUUID?.() || ('sess-' + Math.random().toString(36).slice(2)));
  const pendingRemoteIce = [];
  const localCandidates = [];
  const remoteCandidates = [];
  const pendingRequests = new Map();
  const allowedPeers = new Set();

  const setState = (state, detail = '') => {
    dbg('state', state + (detail ? ' :: ' + detail : ''));
    const m = {
      waiting: ['Waiting', 'badge'],
      ringing: ['Incoming request', 'badge warn'],
      connecting: ['Connecting…', 'badge warn'],
      connected: ['Connected', 'badge ok'],
      failed: ['Failed', 'badge err'],
      direct: ['Direct P2P', 'badge ok'],
      relayed: ['Relayed', 'badge warn'],
    };
    const [txt, cls] = m[state] || ['Waiting', 'badge'];
    connBadge.className = cls;
    connBadge.textContent = txt;
    overlayStatus.textContent = detail || txt;
  };

  setState('waiting', 'Waiting for peer…');

  const npubToPubkey = (npub) => {
    const d = nip19.decode(npub);
    if (d.type !== 'npub') throw new Error('invalid npub');
    return d.data;
  };

  const isPrivateIPv4 = (ip) => /^10\./.test(ip) || /^192\.168\./.test(ip) || /^172\.(1[6-9]|2\d|3[0-1])\./.test(ip);
  const isLocalIPv6 = (ip) => ip.startsWith('fd') || ip.startsWith('fc') || ip.startsWith('fe80:');
  const sameLan = (a, b) => {
    if (!a || !b) return false;
    if (a.includes(':') || b.includes(':')) return isLocalIPv6(a) && isLocalIPv6(b);
    const aa = a.split('.'); const bb = b.split('.');
    return aa.length===4 && bb.length===4 && aa[0]===bb[0] && aa[1]===bb[1] && aa[2]===bb[2];
  };

  const parseCandidate = (raw) => {
    const p = String(raw || '').split(' ');
    if (p.length < 8) return null;
    return { protocol: p[2], ip: p[4], port: Number(p[5]), type: p[7] };
  };

  const candidateScore = (c) => {
    if (!c) return 0;
    if (c.ip.includes(':') && isLocalIPv6(c.ip)) return 500;
    if (!c.ip.includes(':') && isPrivateIPv4(c.ip)) return 400;
    if (c.type === 'host') return 300;
    if (c.type === 'srflx') return 200;
    if (c.type === 'relay') return 100;
    return 50;
  };

  const bloomHex = (list) => {
    let bits = 0n;
    for (const c of list) {
      const s = String(c.ip) + ':' + String(c.port) + ':' + String(c.type);
      let h = 0;
      for (let i=0;i<s.length;i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
      bits |= 1n << BigInt(h % 64);
    }
    return bits.toString(16).padStart(16, '0');
  };

  const extractUfrag = (sdp) => {
    const m = String(sdp?.sdp || sdp || '').match(/a=ice-ufrag:([^\r\n]+)/);
    return m ? m[1].trim() : '';
  };

  const signalTagsFor = (body, toPubkey) => {
    const t = String(body?.type || 'signal');
    const tags = [
      ['p', toPubkey],
      ['session', sessionId],
      ['stun', 'forward'],
      ['t', 'webrtc'],
      ['t', t],
      ['t', 'call-signal'],
    ];
    if (t === 'offer' || t === 'answer') {
      tags.push(['webrtc', t]);
      const ufrag = extractUfrag(body?.sdp);
      if (ufrag) tags.push(['ufrag', ufrag]);
    } else if (t === 'ice') {
      tags.push(['webrtc', 'ice']);
      const c = body?.candidate;
      const candStr = c?.candidate || '';
      if (candStr) tags.push(['candidate', candStr]);
      if (c?.sdpMid != null) tags.push(['mid', String(c.sdpMid)]);
      if (c?.sdpMLineIndex != null) tags.push(['mline', String(c.sdpMLineIndex)]);
      const parsed = parseCandidate(candStr);
      if (parsed?.type) tags.push(['candidate_type', String(parsed.type)]);
    } else {
      tags.push(['webrtc', t]);
    }
    return tags;
  };

  const sendNip17 = (toPubkey, body) => {
    dbg('signal:send', body?.type || 'unknown', { to: toPubkey, body });
    const payload = { app: APP, session: sessionId, ...body };
    const event = finalizeEvent({
      kind: SIGNAL_KIND,
      created_at: Math.floor(Date.now() / 1000),
      tags: signalTagsFor(body, toPubkey),
      content: JSON.stringify(payload)
    }, sk);
    Promise.allSettled(pool.publish(RELAYS, event)).catch((err) => dErr('signal:send', 'publish failed', err, { to: toPubkey, body }));
  };

  const sendCandidateSnapshot = () => {
    if (!peerPubkey) return;
    sendNip17(peerPubkey, { type: 'fips_candidates', candidates: localCandidates, bloom: bloomHex(localCandidates), ts: Date.now() });
  };

  const renderIncoming = () => {
    const entries = Array.from(pendingRequests.entries());
    incomingWrap.style.display = entries.length ? 'block' : 'none';
    incomingList.innerHTML = '';

    for (const [fromNpub, meta] of entries) {
      const row = document.createElement('div');
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
        preCall.style.display = 'none';
        inCall.style.display = 'block';
        joinEndBtn.style.display = 'inline-flex';
        joinEndBtn.textContent = 'Join call';

        sendNip17(peerPubkey, { type: 'request_accept', ts: Date.now() });
        setState('connected', 'Peer accepted. Ready to join call');
      };
    });
  };

  const startStatsLoop = () => {
    if (statsTimer) return;
    statsTimer = setInterval(async () => {
      if (!pc) { statsEl.textContent = 'pc: not created'; return; }
      const stats = await pc.getStats();
      let selectedPair = null, localCand = null, remoteCand = null, rttMs = null;
      let bytesSent = 0, bytesReceived = 0;

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
        if (sameLan(localIp, remoteIp)) selectedPathReason = 'LAN match via bloom hit';
        else if (localIp.includes(':') && remoteIp.includes(':')) selectedPathReason = 'IPv6 preferred path';
        else selectedPathReason = 'broader-path fallback';
      }

      const hint = iceFailureHint();
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
        'hint: ' + hint,
      ].join('\\n');

      if (pc.connectionState === 'connected') setState('direct', 'Connected (P2P)');
      else if (pc.connectionState === 'connecting') setState('connecting', 'Establishing P2P...');
      else if (['failed', 'disconnected'].includes(pc.connectionState)) setState('failed', 'ICE failed. ' + hint + ' See about:webrtc for details.');
    }, 1000);
  };

  const ensurePeer = () => {
    if (pc) return pc;
    dbg('webrtc:peer', 'creating RTCPeerConnection', { stun: STUN_URL });
    pc = new RTCPeerConnection({ iceServers: [{ urls: STUN_URL }] });
    startStatsLoop();

    pc.onicecandidate = (e) => {
      if (!e.candidate || !peerPubkey) return;
      const parsed = parseCandidate(e.candidate.candidate);
      if (parsed) {
        const exists = localCandidates.some((c) => c.ip===parsed.ip && c.port===parsed.port && c.type===parsed.type);
        if (!exists) {
          localCandidates.push(parsed);
          localCandidates.sort((a,b) => candidateScore(b)-candidateScore(a));
          sendCandidateSnapshot();
        }
      }

      // Reliability-first: forward every candidate immediately.
      dbg('webrtc:ice-local', 'candidate emitted', parsed || e.candidate);
      sendNip17(peerPubkey, { type:'ice', candidate: e.candidate });
    };

    pc.ontrack = (e) => {
      dbg('webrtc:track', 'remote track received', { streams: e.streams?.length || 0, kind: e.track?.kind });
      remoteVideo.srcObject = e.streams[0];
      const stage = document.querySelector('.videoStage');
      const applyRatioClass = () => {
        const vw = remoteVideo.videoWidth || 0;
        const vh = remoteVideo.videoHeight || 0;
        if (!vw || !vh || !stage) return;
        stage.classList.remove('remote-landscape', 'remote-portrait');
        if (vw >= vh) stage.classList.add('remote-landscape');
        else stage.classList.add('remote-portrait');
      };
      remoteVideo.onloadedmetadata = applyRatioClass;
      remoteVideo.onresize = applyRatioClass;
      applyRatioClass();
      setState('connected', 'Remote media connected');
    };

    pc.onconnectionstatechange = () => {
      dbg('webrtc:conn', 'connection state changed', { connectionState: pc.connectionState, iceConnectionState: pc.iceConnectionState });
      if (pc.connectionState === 'connected') {
        reconnectAttempts = 0;
        if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
      }
      if ((pc.connectionState === 'failed' || pc.connectionState === 'disconnected') && callActive) {
        scheduleReconnect();
      }
    };

    if (localStream) {
      for (const t of localStream.getTracks()) pc.addTrack(t, localStream);
    }

    return pc;
  };

  const startCamera = async () => {
    dbg('media:getUserMedia', 'requesting local camera/mic');
    localStream = await navigator.mediaDevices.getUserMedia({
      video: true,
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
    });
    localVideo.srcObject = localStream;
    for (const t of localStream.getVideoTracks()) t.enabled = camEnabled;
    for (const t of localStream.getAudioTracks()) t.enabled = !micMuted;
    if (pc) for (const t of localStream.getTracks()) pc.addTrack(t, localStream);
    dbg('media:getUserMedia', 'local media ready', { audioTracks: localStream.getAudioTracks().length, videoTracks: localStream.getVideoTracks().length });
  };

  const iceFailureHint = () => {
    const localTypes = new Set(localCandidates.map((c) => c?.type).filter(Boolean));
    const remoteTypes = new Set(remoteCandidates.map((c) => c?.type).filter(Boolean));
    if (!localCandidates.length || !remoteCandidates.length) return 'No viable ICE candidates yet; check STUN reachability and firewall UDP rules.';
    if (localTypes.has('relay') || remoteTypes.has('relay')) return 'Relay candidate seen but STUN-only mode is active; peer NAT may be too strict for direct P2P.';
    if (!localTypes.has('srflx') || !remoteTypes.has('srflx')) return 'Missing server-reflexive candidates; one peer may be behind restrictive NAT.';
    return 'Direct path negotiation failed; likely incompatible NAT pair for STUN-only mode.';
  };

  const waitForIceGathering = async (peer, timeoutMs = 1400) => {
    if (peer.iceGatheringState === 'complete') {
      dbg('webrtc:ice-gather', 'already complete', { timeoutMs });
      return;
    }
    dbg('webrtc:ice-gather', 'waiting for completion', { timeoutMs, state: peer.iceGatheringState });
    await new Promise((resolve) => {
      const timer = setTimeout(() => {
        peer.removeEventListener('icegatheringstatechange', onChange);
        dbg('webrtc:ice-gather', 'timeout, proceeding with partial candidates', { timeoutMs, state: peer.iceGatheringState });
        resolve(undefined);
      }, timeoutMs);
      const onChange = () => {
        dbg('webrtc:ice-gather', 'state change', { state: peer.iceGatheringState });
        if (peer.iceGatheringState !== 'complete') return;
        clearTimeout(timer);
        peer.removeEventListener('icegatheringstatechange', onChange);
        dbg('webrtc:ice-gather', 'complete');
        resolve(undefined);
      };
      peer.addEventListener('icegatheringstatechange', onChange);
    });
  };

  const flushPendingRemoteIce = async (p) => {
    if (!pendingRemoteIce.length) return;
    dbg('webrtc:ice-remote', 'flushing queued candidates', { count: pendingRemoteIce.length });
    while (pendingRemoteIce.length) {
      const c = pendingRemoteIce.shift();
      try { await p.addIceCandidate(c); }
      catch (err) { dErr('webrtc:ice-remote', 'queued candidate rejected', err, c); }
    }
  };

  const startOrJoin = async () => {
    dbg('call:start', 'startOrJoin invoked', { hasPeerPubkey: Boolean(peerPubkey), peerReachable, hasPendingOffer: Boolean(pendingRemoteOffer) });
    if (!peerPubkey || !peerReachable) {
      dbg('call:start', 'blocked: peer not ready', { peerPubkey, peerReachable });
      return;
    }
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
    if (!localStream) await startCamera();
    const p = ensurePeer();
    callStartedAt = Date.now();

    if (pendingRemoteOffer && pendingRemoteOffer.fromPubkey === peerPubkey) {
      dbg('call:start', 'applying pending remote offer + creating answer');
      await p.setRemoteDescription(new RTCSessionDescription(pendingRemoteOffer.sdp));
      await flushPendingRemoteIce(p);
      const answer = await p.createAnswer();
      await p.setLocalDescription(answer);
      await waitForIceGathering(p, 900);
      sendNip17(peerPubkey, { type: 'answer', sdp: p.localDescription || answer });
      pendingRemoteOffer = null;
    } else {
      dbg('call:start', 'creating fresh local offer');
      const offer = await p.createOffer();
      await p.setLocalDescription(offer);
      await waitForIceGathering(p, 1400);
      sendNip17(peerPubkey, { type: 'offer', sdp: p.localDescription || offer });
    }

    callActive = true;
    reconnectAttempts = 0;
    joinEndBtn.textContent = 'End call';
    joinEndBtn.classList.remove('primary');
    joinEndBtn.classList.add('danger');
    setState('connecting', 'Establishing P2P...');
  };

  const scheduleReconnect = () => {
    dbg('call:reconnect', 'schedule reconnect called', { callActive, hasPeer: Boolean(peerPubkey), reconnectAttempts });
    if (!callActive || !peerPubkey) return;
    if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      setState('failed', 'Connection failed (max retries reached)');
      joinEndBtn.textContent = 'Retry call';
      joinEndBtn.classList.remove('danger');
      joinEndBtn.classList.add('primary');
      callActive = false;
      return;
    }

    reconnectAttempts += 1;
    const delay = Math.min(4000, 800 * reconnectAttempts);
    setState('connecting', 'Reconnecting… (' + reconnectAttempts + '/' + MAX_RECONNECT_ATTEMPTS + ')');

    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(async () => {
      try {
        if (pc) {
          pc.close();
          pc = null;
        }
        pendingRemoteOffer = null;
        await startOrJoin();
      } catch (err) {
        dErr('call:reconnect', 'reconnect attempt failed', err);
        scheduleReconnect();
      }
    }, delay);
  };

  const endCall = (notifyPeer = true) => {
    dbg('call:end', 'ending call', { notifyPeer, peerPubkey, callActive });
    if (notifyPeer && peerPubkey) sendNip17(peerPubkey, { type: 'call_end', ts: Date.now() });
    if (pc) {
      pc.getSenders().forEach((s) => { try { pc.removeTrack(s); } catch {} });
      pc.close();
      pc = null;
    }
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
    reconnectAttempts = 0;
    pendingRemoteOffer = null;
    remoteVideo.srcObject = null;
    callActive = false;
    selectedPathReason = 'n/a';
    localCandidates.length = 0;
    remoteCandidates.length = 0;
    if (statsTimer) { clearInterval(statsTimer); statsTimer = null; }
    statsEl.textContent = 'call ended';

    joinEndBtn.textContent = 'Join call';
    joinEndBtn.classList.remove('danger');
    joinEndBtn.classList.add('primary');
    setState('waiting', 'Call ended');
  };

  const startQrScan = async () => {
    scanStream = await navigator.mediaDevices.getUserMedia({ video:{ facingMode:'environment' }, audio:false });
    scanVideo.srcObject = scanStream;
    scanWrap.style.display = 'block';

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const hasNative = 'BarcodeDetector' in window;
    const detector = hasNative ? new BarcodeDetector({ formats:['qr_code'] }) : null;

    scanTimer = setInterval(async () => {
      try {
        if (scanVideo.videoWidth < 20 || scanVideo.videoHeight < 20) return;
        let value = '';
        if (detector) {
          const codes = await detector.detect(scanVideo);
          if (codes?.length) value = String(codes[0].rawValue || '').trim();
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
        }
      } catch (err) {
        dErr('qr:scan', 'scan frame failed', err);
      }
    }, 250);
  };

  const stopQrScan = () => {
    if (scanTimer) { clearInterval(scanTimer); scanTimer = null; }
    if (scanStream) { for (const t of scanStream.getTracks()) t.stop(); scanStream = null; }
    scanVideo.srcObject = null;
    scanWrap.style.display = 'none';
  };

  const sendRequest = () => {
    const npub = peerNpubEl.value.trim();
    dbg('request', 'send request clicked', { npub });
    if (!npub.startsWith('npub')) return setState('failed', 'Invalid peer npub');
    try {
      sessionId = (globalThis.crypto?.randomUUID?.() || ('sess-' + Math.random().toString(36).slice(2)));
      peerNpub = npub;
      peerPubkey = npubToPubkey(npub);
      sendNip17(peerPubkey, { type:'request_connect', ts: Date.now() });
      setState('connecting', 'Request sent. Waiting for accept...');
    } catch (err) {
      dErr('request', 'failed to decode npub or send request', err, { npub });
      setState('failed', 'Request failed: ' + (err?.message || err));
    }
  };

  const listen = () => {
    dbg('signal:listen', 'subscribing to relays', { relays: RELAYS, pub, kind: SIGNAL_KIND });
    pool.subscribeMany(RELAYS, { kinds:[SIGNAL_KIND], '#p':[pub], since: Math.floor(Date.now()/1000) - 3*24*60*60 }, {
      onevent: async (evt) => {
        try {
          let msg = null;
          let fromPubkey = '';
          try {
            const rumor = unwrapEvent(evt, sk);
            msg = JSON.parse(rumor.content);
            fromPubkey = rumor.pubkey;
          } catch {
            msg = JSON.parse(evt.content);
            fromPubkey = evt.pubkey;
          }

          if (!msg || msg.app !== APP) return;
          const fromNpub = nip19.npubEncode(fromPubkey);
          dbg('signal:recv', msg.type || 'unknown', { fromNpub, fromPubkey, msg });

          if (msg.type === 'request_connect') {
            pendingRequests.set(fromNpub, { fromPubkey, ts: msg.ts || Date.now() });
            renderIncoming();
            setState('ringing', 'Incoming request from ' + fromNpub.slice(0,16) + '...');
            return;
          }

          if (msg.type === 'request_accept') {
            if (peerPubkey && fromPubkey !== peerPubkey) return;
            if (msg.session) sessionId = msg.session;
            peerPubkey = fromPubkey;
            peerNpub = fromNpub;
            allowedPeers.add(fromPubkey);
            peerReachable = true;
            preCall.style.display = 'none';
            inCall.style.display = 'block';
            joinEndBtn.style.display = 'inline-flex';
            joinEndBtn.textContent = 'Join call';
            setState('connected', 'Peer accepted request');
            return;
          }

          if (!allowedPeers.has(fromPubkey)) {
            dbg('signal:recv', 'ignored message from non-allowed peer', { fromNpub, type: msg.type });
            return;
          }

          if (msg.type === 'fips_candidates') {
            remoteCandidates.length = 0;
            if (Array.isArray(msg.candidates)) msg.candidates.forEach((c) => remoteCandidates.push(c));
            return;
          }

          if (msg.type === 'offer') {
            if (msg.session) sessionId = msg.session;
            pendingRemoteOffer = { fromPubkey, sdp: msg.sdp };
            preCall.style.display = 'none';
            inCall.style.display = 'block';
            joinEndBtn.style.display = 'inline-flex';
            joinEndBtn.textContent = 'Join call';
            joinEndBtn.classList.remove('danger');
            joinEndBtn.classList.add('primary');
            setState('ringing', 'Incoming call… click Join call');
            return;
          }

          if (msg.type === 'answer') {
            const p = ensurePeer();
            dbg('webrtc:answer', 'applying remote answer');
            await p.setRemoteDescription(new RTCSessionDescription(msg.sdp));
            callActive = true;
            joinEndBtn.textContent = 'End call';
            joinEndBtn.classList.remove('primary');
            joinEndBtn.classList.add('danger');
            setState('connected', 'Call established');
            return;
          }

          if (msg.type === 'call_end') {
            endCall(false);
            setState('waiting', 'Peer ended call');
            return;
          }

          if (msg.type === 'ice' && msg.candidate) {
            const p = ensurePeer();
            if (!p.remoteDescription) {
              pendingRemoteIce.push(msg.candidate);
              dbg('webrtc:ice-remote', 'queued (no remoteDescription yet)', { queued: pendingRemoteIce.length });
              return;
            }
            try {
              await p.addIceCandidate(msg.candidate);
              dbg('webrtc:ice-remote', 'candidate accepted');
            } catch (err) {
              dErr('webrtc:ice-remote', 'addIceCandidate failed', err, msg.candidate);
            }
          }
        } catch (err) {
          dErr('signal:recv', 'failed to process incoming message', err, evt);
        }
      }
    });

    setState('waiting', 'Listening on relays');
  };

  document.getElementById('openInfo').onclick = () => infoModal.showModal();
  document.getElementById('closeInfo').onclick = () => infoModal.close();
  document.getElementById('copyNpub').onclick = async () => navigator.clipboard.writeText(myNpub);

  document.getElementById('useNsec').onclick = () => {
    const nsec = prompt('Paste nsec (kept in sessionStorage for this browser session):');
    if (!nsec) return;
    try {
      const dec = nip19.decode(nsec.trim());
      if (dec.type !== 'nsec') throw new Error('not an nsec');
      sessionStorage.setItem('fips_video_nsec', nsec.trim());
      location.reload();
    } catch (e) {
      setState('failed', 'Invalid nsec');
    }
  };

  document.getElementById('clearNsec').onclick = () => {
    sessionStorage.removeItem('fips_video_nsec');
    location.reload();
  };

  document.getElementById('scan').onclick = () => {
    if (scanStream) stopQrScan();
    else startQrScan().catch((err) => { dErr('qr:scan', 'failed to start scanner', err); setState('failed', 'QR scan failed'); });
  };

  document.getElementById('request').onclick = sendRequest;

  joinEndBtn.onclick = () => {
    if (callActive) endCall();
    else startOrJoin().catch((e) => {
      dErr('call:start', 'Join failed', e);
      setState('failed', 'Join failed: ' + e.message);
    });
  };

  camBtn.onclick = async () => {
    if (!localStream) {
      try { await startCamera(); } catch (e) { dErr('media:camera', 'camera toggle failed', e); setState('failed', 'Camera error: ' + e.message); return; }
    }
    camEnabled = !camEnabled;
    localStream.getVideoTracks().forEach((t) => (t.enabled = camEnabled));
    camBtn.classList.toggle('off', !camEnabled);
  };

  micBtn.onclick = async () => {
    if (!localStream) {
      try { await startCamera(); } catch (e) { dErr('media:mic', 'mic toggle failed', e); setState('failed', 'Mic error: ' + e.message); return; }
    }
    micMuted = !micMuted;
    localStream.getAudioTracks().forEach((t) => (t.enabled = !micMuted));
    micBtn.classList.toggle('off', micMuted);
  };

  speakerBtn.onclick = () => {
    speakerMuted = !speakerMuted;
    remoteVideo.muted = speakerMuted;
    speakerBtn.classList.toggle('off', speakerMuted);
  };

  micBtn.classList.toggle('off', micMuted);
  camBtn.classList.toggle('off', !camEnabled);
  speakerBtn.classList.toggle('off', speakerMuted);

  listen();
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
;
});
