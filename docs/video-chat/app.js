import { SimplePool, generateSecretKey, getPublicKey, nip19 } from 'https://esm.sh/nostr-tools@2.17.0';
import { wrapEvent, unwrapEvent } from 'https://esm.sh/nostr-tools@2.17.0/nip17';
import jsQR from 'https://esm.sh/jsqr@1.4.0';
import QRCode from 'https://esm.sh/qrcode@1.5.3';

(() => {
  const DEFAULT_RELAYS = [
    'wss://nos.lol',
    'wss://relay.damus.io',
    'wss://relay.primal.net',
    'wss://nip17.tomdwyer.uk',
  ];

  const fromQuery = (() => {
    const q = new URLSearchParams(location.search).get('relays');
    return q ? q.split(',').map((s) => s.trim()).filter(Boolean) : null;
  })();
  const fromGlobal = Array.isArray(window.FIPS_VIDEO_RELAYS) ? window.FIPS_VIDEO_RELAYS : null;
  const RELAYS = (fromGlobal && fromGlobal.length ? fromGlobal : (fromQuery && fromQuery.length ? fromQuery : DEFAULT_RELAYS));
  const APP = 'fips.video.v1';

  const DEFAULT_ICE_SERVERS = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:global.stun.twilio.com:3478' },
  ];

  const ICE_SERVERS = Array.isArray(window.FIPS_VIDEO_ICE_SERVERS) && window.FIPS_VIDEO_ICE_SERVERS.length
    ? window.FIPS_VIDEO_ICE_SERVERS
    : DEFAULT_ICE_SERVERS;

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
      } catch {
        sessionStorage.removeItem('fips_video_nsec');
      }
    }

    const sk = generateSecretKey();
    const pub = getPublicKey(sk);
    return { sk, pub, npub: nip19.npubEncode(pub), mode: 'ephemeral' };
  };

  const ident = resolveIdentity();
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
  const localCandidates = [];
  const remoteCandidates = [];
  const pendingRequests = new Map();
  const allowedPeers = new Set();

  const setState = (state, detail = '') => {
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

  const sendNip17 = (toPubkey, body) => {
    const event = wrapEvent(sk, { publicKey: toPubkey }, JSON.stringify({ app: APP, ...body }));
    Promise.allSettled(pool.publish(RELAYS, event)).catch(() => undefined);
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
      ].join('\n');

      if (pc.connectionState === 'connected') setState('direct', 'Connected (P2P)');
      else if (pc.connectionState === 'connecting') setState('connecting', 'Establishing P2P...');
      else if (['failed', 'disconnected'].includes(pc.connectionState)) {
        setState('failed', 'Connection unstable/failed (check about:webrtc)');
      }
    }, 1000);
  };

  const ensurePeer = () => {
    if (pc) return pc;
    pc = new RTCPeerConnection({
      iceServers: ICE_SERVERS,
      iceCandidatePoolSize: 10,
    });
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

      sendNip17(peerPubkey, { type:'ice', candidate: e.candidate });
    };

    pc.ontrack = (e) => {
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
    } else {
      // Allow receive-only calls when camera/mic are blocked on mobile/webview.
      try { pc.addTransceiver('video', { direction: 'recvonly' }); } catch {}
      try { pc.addTransceiver('audio', { direction: 'recvonly' }); } catch {}
    }

    return pc;
  };

  const startCamera = async () => {
    localStream = await navigator.mediaDevices.getUserMedia({
      video: true,
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
    });
    localVideo.srcObject = localStream;
    for (const t of localStream.getVideoTracks()) t.enabled = camEnabled;
    for (const t of localStream.getAudioTracks()) t.enabled = !micMuted;
    if (pc) for (const t of localStream.getTracks()) pc.addTrack(t, localStream);
  };

  const startOrJoin = async () => {
    if (!peerPubkey || !peerReachable) return;
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
    if (!localStream) {
      try {
        await startCamera();
      } catch (e) {
        const secureHint = (!window.isSecureContext || location.protocol !== 'https:')
          ? ' (requires HTTPS/secure context)'
          : '';
        setState('connecting', 'Media blocked; joining receive-only' + secureHint);
      }
    }
    const p = ensurePeer();
    callStartedAt = Date.now();

    if (pendingRemoteOffer && pendingRemoteOffer.fromPubkey === peerPubkey) {
      await p.setRemoteDescription(new RTCSessionDescription(pendingRemoteOffer.sdp));
      const answer = await p.createAnswer();
      await p.setLocalDescription(answer);
      sendNip17(peerPubkey, { type: 'answer', sdp: answer });
      pendingRemoteOffer = null;
    } else {
      const offer = await p.createOffer();
      await p.setLocalDescription(offer);
      sendNip17(peerPubkey, { type: 'offer', sdp: offer });
    }

    callActive = true;
    reconnectAttempts = 0;
    joinEndBtn.textContent = 'End call';
    joinEndBtn.classList.remove('primary');
    joinEndBtn.classList.add('danger');
    setState('connecting', 'Establishing P2P...');
  };

  const scheduleReconnect = () => {
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
      } catch {
        scheduleReconnect();
      }
    }, delay);
  };

  const endCall = (notifyPeer = true) => {
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
      } catch {}
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
    if (!npub.startsWith('npub')) return setState('failed', 'Invalid peer npub');
    peerNpub = npub;
    peerPubkey = npubToPubkey(npub);
    sendNip17(peerPubkey, { type:'request_connect', ts: Date.now() });
    setState('connecting', 'Request sent. Waiting for accept...');
  };

  const listen = () => {
    pool.subscribeMany(RELAYS, { kinds:[1059], '#p':[pub], since: Math.floor(Date.now()/1000) - 3*24*60*60 }, {
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
            setState('ringing', 'Incoming request from ' + fromNpub.slice(0,16) + '...');
            return;
          }

          if (msg.type === 'request_accept') {
            if (peerPubkey && fromPubkey !== peerPubkey) return;
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

          if (!allowedPeers.has(fromPubkey)) return;

          if (msg.type === 'fips_candidates') {
            remoteCandidates.length = 0;
            if (Array.isArray(msg.candidates)) msg.candidates.forEach((c) => remoteCandidates.push(c));
            return;
          }

          if (msg.type === 'offer') {
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
            try { await p.addIceCandidate(msg.candidate); } catch {}
          }
        } catch {}
      }
    });

    setState('waiting', 'Listening on relays');
  };

  document.getElementById('openInfo').onclick = () => infoModal.showModal();
  document.getElementById('closeInfo').onclick = () => infoModal.close();
  document.getElementById('copyNpub').onclick = async () => navigator.clipboard.writeText(myNpub);
  document.getElementById('copyNsec').onclick = async () => {
    const nsec = sessionStorage.getItem('fips_video_nsec');
    if (!nsec) return setState('failed', 'No nsec set (using ephemeral identity)');
    await navigator.clipboard.writeText(nsec);
    setState('connected', 'nsec copied to clipboard');
  };

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
    if (scanStream) stopQrScan(); else startQrScan().catch(() => setState('failed', 'QR scan failed'));
  };

  document.getElementById('request').onclick = sendRequest;

  joinEndBtn.onclick = () => {
    if (callActive) endCall();
    else startOrJoin().catch((e) => setState('failed', 'Join failed: ' + e.message));
  };

  camBtn.onclick = async () => {
    if (!localStream) {
      try { await startCamera(); } catch (e) { setState('failed', 'Camera error: ' + e.message); return; }
    }
    camEnabled = !camEnabled;
    localStream.getVideoTracks().forEach((t) => (t.enabled = camEnabled));
    camBtn.classList.toggle('off', !camEnabled);
  };

  micBtn.onclick = async () => {
    if (!localStream) {
      try { await startCamera(); } catch (e) { setState('failed', 'Mic error: ' + e.message); return; }
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
