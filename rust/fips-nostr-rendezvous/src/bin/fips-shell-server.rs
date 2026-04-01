use std::collections::{HashMap, HashSet};
use std::env;
use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::path::PathBuf;
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use anyhow::{Context, Result};
use clap::Parser;
use fips_nostr_rendezvous::{
    build_punch_packet, decode_session_frame, encode_session_frame, parse_punch_packet,
    parse_stun_url, EndpointHint, LegacyEndpoint, LegacyHelloMessage, LegacyPunch,
    LegacyServerInfoMessage, LegacyStunInfo, PunchPacketKind, SessionFrame, TraversalAdvert,
    ADVERT_KIND, DEFAULT_ADVERT_RELAYS, DEFAULT_DM_RELAYS, DEFAULT_STUN_SERVERS,
};
use nostr::nips::nip59;
use nostr::nips::nip19::ToBech32;
use nostr::{EventBuilder, Filter, Kind, Keys, PublicKey, RelayUrl, Tag, TagKind, Timestamp};
use nostr_sdk::prelude::{Client, Options, RelayPoolNotification};
use rand::random;
use serde_json::{json, Value};
use tokio::io::AsyncReadExt;
use tokio::net::UdpSocket;
use tokio::process::Command;
use tokio::signal;
use tokio::sync::{oneshot, Mutex, RwLock};
use tokio::time::{sleep, timeout, Instant};

#[derive(Debug, Parser)]
#[command(name = "fips-shell-server-rs", about = "Rust FIPS shell server over Nostr rendezvous")]
struct Args {
    #[arg(long)]
    nsec: String,

    #[arg(long, default_value_t = 9999)]
    udp_port: u16,

    #[arg(long, value_delimiter = ',', num_args = 1.., default_values_t = default_advert_relays())]
    advert_relays: Vec<String>,

    #[arg(long, value_delimiter = ',', num_args = 1.., default_values_t = default_dm_relays())]
    dm_relays: Vec<String>,

    #[arg(long, value_delimiter = ',', num_args = 0.., default_values_t = default_stun_servers())]
    stun_servers: Vec<String>,

    #[arg(long, value_delimiter = ',', default_value = "")]
    trusted_npubs: Vec<String>,

    #[arg(long)]
    public_host: Option<String>,
}

fn default_advert_relays() -> Vec<String> {
    DEFAULT_ADVERT_RELAYS.iter().map(|relay| relay.to_string()).collect()
}

fn default_dm_relays() -> Vec<String> {
    DEFAULT_DM_RELAYS.iter().map(|relay| relay.to_string()).collect()
}

fn default_stun_servers() -> Vec<String> {
    DEFAULT_STUN_SERVERS.iter().map(|server| server.to_string()).collect()
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn local_ipv4_hint() -> Option<Ipv4Addr> {
    let socket = std::net::UdpSocket::bind("0.0.0.0:0").ok()?;
    socket.connect("8.8.8.8:80").ok()?;
    match socket.local_addr().ok()?.ip() {
        IpAddr::V4(ip) => Some(ip),
        _ => None,
    }
}

fn create_stun_binding_request(txn_id: [u8; 12]) -> [u8; 20] {
    const STUN_BINDING_REQUEST: u16 = 0x0001;
    const STUN_MAGIC_COOKIE: u32 = 0x2112_a442;
    let mut packet = [0_u8; 20];
    packet[..2].copy_from_slice(&STUN_BINDING_REQUEST.to_be_bytes());
    packet[2..4].copy_from_slice(&0_u16.to_be_bytes());
    packet[4..8].copy_from_slice(&STUN_MAGIC_COOKIE.to_be_bytes());
    packet[8..20].copy_from_slice(&txn_id);
    packet
}

fn parse_stun_binding_success(packet: &[u8], txn_id: &[u8; 12]) -> Option<LegacyEndpoint> {
    const STUN_BINDING_SUCCESS: u16 = 0x0101;
    const STUN_MAGIC_COOKIE: u32 = 0x2112_a442;
    const STUN_ATTR_MAPPED_ADDRESS: u16 = 0x0001;
    const STUN_ATTR_XOR_MAPPED_ADDRESS: u16 = 0x0020;

    if packet.len() < 20 {
        return None;
    }
    if u16::from_be_bytes(packet[..2].try_into().ok()?) != STUN_BINDING_SUCCESS {
        return None;
    }
    if u32::from_be_bytes(packet[4..8].try_into().ok()?) != STUN_MAGIC_COOKIE {
        return None;
    }
    if &packet[8..20] != txn_id {
        return None;
    }

    let message_length = u16::from_be_bytes(packet[2..4].try_into().ok()?) as usize;
    let mut offset = 20usize;
    let max_offset = packet.len().min(20 + message_length);

    while offset + 4 <= max_offset {
        let attr_type = u16::from_be_bytes(packet[offset..offset + 2].try_into().ok()?);
        let attr_len = u16::from_be_bytes(packet[offset + 2..offset + 4].try_into().ok()?) as usize;
        let value_start = offset + 4;
        let value_end = value_start + attr_len;
        if value_end > packet.len() {
            break;
        }
        let value = &packet[value_start..value_end];
        let mapped = match attr_type {
            STUN_ATTR_XOR_MAPPED_ADDRESS => parse_xor_mapped_address(value),
            STUN_ATTR_MAPPED_ADDRESS => parse_mapped_address(value),
            _ => None,
        };
        if mapped.is_some() {
            return mapped;
        }
        offset = value_end + ((4 - (attr_len % 4)) % 4);
    }
    None
}

fn parse_mapped_address(value: &[u8]) -> Option<LegacyEndpoint> {
    if value.len() < 8 || value[1] != 0x01 {
        return None;
    }
    Some(LegacyEndpoint {
        host: Ipv4Addr::new(value[4], value[5], value[6], value[7]).to_string(),
        port: u16::from_be_bytes([value[2], value[3]]),
    })
}

fn parse_xor_mapped_address(value: &[u8]) -> Option<LegacyEndpoint> {
    const STUN_MAGIC_COOKIE: u32 = 0x2112_a442;
    if value.len() < 8 || value[1] != 0x01 {
        return None;
    }
    let cookie = STUN_MAGIC_COOKIE.to_be_bytes();
    let ip = Ipv4Addr::new(
        value[4] ^ cookie[0],
        value[5] ^ cookie[1],
        value[6] ^ cookie[2],
        value[7] ^ cookie[3],
    );
    Some(LegacyEndpoint {
        host: ip.to_string(),
        port: u16::from_be_bytes([value[2], value[3]]) ^ ((STUN_MAGIC_COOKIE >> 16) as u16),
    })
}

#[derive(Debug, Clone)]
struct StunObservation {
    server: String,
    reflexive_address: Option<LegacyEndpoint>,
    local_port: u16,
    local_interface_addresses: Vec<String>,
}

struct SessionState {
    remote: SocketAddr,
    cwd: PathBuf,
    running: Option<oneshot::Sender<()>>,
}

struct ServerState {
    client: Client,
    udp_socket: Arc<UdpSocket>,
    keys: Keys,
    npub: String,
    pubkey: PublicKey,
    advert_relays: Vec<String>,
    dm_relays: Vec<String>,
    trusted_npubs: HashSet<String>,
    stun_servers: Vec<String>,
    public_host: Option<String>,
    punch_interval_ms: u64,
    punch_duration_ms: u64,
    punch_start_delay_ms: u64,
    advertise_ttl_ms: u64,
    advertise_interval_ms: u64,
    stun_timeout_ms: u64,
    stun_refresh_ms: u64,
    pending_stun: Mutex<HashMap<[u8; 12], oneshot::Sender<LegacyEndpoint>>>,
    stun_observation: RwLock<Option<StunObservation>>,
    stun_observed_at: Mutex<Option<Instant>>,
    sessions: Mutex<HashMap<String, Arc<Mutex<SessionState>>>>,
    session_hashes: Mutex<HashMap<[u8; 16], String>>,
}

impl ServerState {
    async fn refresh_traversal_observation(&self, force: bool) -> Result<Option<StunObservation>> {
        if self.stun_servers.is_empty() {
            return Ok(self.stun_observation.read().await.clone());
        }

        if !force {
            let observed_at = *self.stun_observed_at.lock().await;
            if let Some(observed_at) = observed_at {
                if observed_at.elapsed() < Duration::from_millis(self.stun_refresh_ms) {
                    return Ok(self.stun_observation.read().await.clone());
                }
            }
        }

        let local_port = self.udp_socket.local_addr()?.port();
        let mut local_addresses = Vec::new();
        if let Some(ip) = local_ipv4_hint() {
            local_addresses.push(ip.to_string());
        }

        for server in &self.stun_servers {
            if let Ok(reflexive) = self.probe_stun_server(server).await {
                let obs = StunObservation {
                    server: server.clone(),
                    reflexive_address: Some(reflexive),
                    local_port,
                    local_interface_addresses: local_addresses.clone(),
                };
                *self.stun_observation.write().await = Some(obs.clone());
                *self.stun_observed_at.lock().await = Some(Instant::now());
                return Ok(Some(obs));
            }
        }

        let obs = StunObservation {
            server: self.stun_servers[0].clone(),
            reflexive_address: None,
            local_port,
            local_interface_addresses: local_addresses,
        };
        *self.stun_observation.write().await = Some(obs.clone());
        *self.stun_observed_at.lock().await = Some(Instant::now());
        Ok(Some(obs))
    }

    async fn probe_stun_server(&self, stun_url: &str) -> Result<LegacyEndpoint> {
        let endpoint = parse_stun_url(stun_url)?;
        let txn_id: [u8; 12] = random();
        let request = create_stun_binding_request(txn_id);
        let (tx, rx) = oneshot::channel();
        self.pending_stun.lock().await.insert(txn_id, tx);
        self.udp_socket
            .send_to(&request, format!("{}:{}", endpoint.host, endpoint.port))
            .await
            .with_context(|| format!("failed to send STUN request to {}:{}", endpoint.host, endpoint.port))?;

        let mapped = timeout(Duration::from_millis(self.stun_timeout_ms), rx)
            .await
            .with_context(|| format!("STUN timeout waiting for {stun_url}"))?
            .context("STUN channel dropped")?;
        Ok(mapped)
    }

    async fn resolve_traversal_endpoint(&self) -> Result<LegacyEndpoint> {
        let obs = self.refresh_traversal_observation(false).await?;
        if let Some(obs) = obs {
            if let Some(reflexive) = obs.reflexive_address {
                return Ok(reflexive);
            }
            if let Some(first) = obs.local_interface_addresses.first() {
                return Ok(LegacyEndpoint {
                    host: first.clone(),
                    port: obs.local_port,
                });
            }
        }

        if let Some(host) = &self.public_host {
            return Ok(LegacyEndpoint {
                host: host.clone(),
                port: self.udp_socket.local_addr()?.port(),
            });
        }

        Ok(LegacyEndpoint {
            host: local_ipv4_hint()
                .unwrap_or(Ipv4Addr::new(127, 0, 0, 1))
                .to_string(),
            port: self.udp_socket.local_addr()?.port(),
        })
    }

    async fn publish_advert(&self) -> Result<()> {
        let endpoint = self.resolve_traversal_endpoint().await?;
        let now = now_ms();
        let advert = TraversalAdvert {
            app: "fips.nat.traversal.v1".to_owned(),
            event_kind: ADVERT_KIND,
            protocol: "fips.nat.traversal.v1".to_owned(),
            publisher_npub: self.npub.clone(),
            published_at: now,
            expires_at: now + self.advertise_ttl_ms,
            sequence: now,
            relays: self.dm_relays.clone(),
            stun_servers: self.stun_servers.clone(),
            transports: vec!["udp".to_owned()],
            endpoint_hint: Some(EndpointHint {
                host: endpoint.host,
                port: endpoint.port,
            }),
        };

        let event = EventBuilder::new(Kind::Custom(ADVERT_KIND), serde_json::to_string(&advert)?)
            .tags([
                Tag::identifier(format!("fips-traversal:{}", self.npub)),
                Tag::hashtag("fips"),
                Tag::hashtag("traversal"),
                Tag::expiration(Timestamp::from((now + self.advertise_ttl_ms) / 1000)),
            ])
            .sign_with_keys(&self.keys)?;

        let output = self
            .client
            .send_event_to(self.advert_relays.clone(), event)
            .await?;
        log_publish_outcome("advert", &self.npub, &output.success, &output.failed);
        Ok(())
    }

    async fn publish_inbox_relays(&self) -> Result<()> {
        let relay_tags = self
            .dm_relays
            .iter()
            .filter_map(|relay| RelayUrl::parse(relay).ok())
            .map(|relay| Tag::custom(TagKind::SingleLetter(nostr::SingleLetterTag::lowercase(nostr::Alphabet::R)), [relay.to_string()]))
            .collect::<Vec<_>>();
        let event = EventBuilder::new(Kind::InboxRelays, "").tags(relay_tags).sign_with_keys(&self.keys)?;
        let output = self
            .client
            .send_event_to(self.dm_relays.clone(), event)
            .await?;
        log_publish_outcome("inbox-relays", &self.npub, &output.success, &output.failed);
        Ok(())
    }

    async fn send_dm_to(&self, relays: Vec<String>, receiver: PublicKey, obj: &impl serde::Serialize, kind: &str) -> Result<()> {
        let content = serde_json::to_string(obj)?;
        let event = EventBuilder::private_msg(&self.keys, receiver, content, []).await?;
        let output = self.client.send_event_to(relays, event).await?;
        log_publish_outcome(kind, &receiver.to_hex(), &output.success, &output.failed);
        Ok(())
    }

    async fn start_punch(&self, session_id: String, remote: LegacyEndpoint, punch: LegacyPunch) -> Result<()> {
        let socket = self.udp_socket.clone();
        let target = SocketAddr::new(remote.host.parse()?, remote.port);
        self.session_hashes
            .lock()
            .await
            .insert(fips_nostr_rendezvous::session_hash(&session_id), session_id.clone());
        let interval_ms = punch.interval_ms;
        let duration_ms = punch.duration_ms;
        let delay_ms = punch.start_at_ms.saturating_sub(now_ms());
        tokio::spawn(async move {
            sleep(Duration::from_millis(delay_ms)).await;
            let started = Instant::now();
            while started.elapsed() < Duration::from_millis(duration_ms) {
                let packet = build_punch_packet(PunchPacketKind::Probe, &session_id);
                let _ = socket.send_to(&packet, target).await;
                sleep(Duration::from_millis(interval_ms)).await;
            }
        });
        Ok(())
    }

    async fn ensure_session(&self, session_id: &str, remote: SocketAddr) -> Arc<Mutex<SessionState>> {
        let mut sessions = self.sessions.lock().await;
        if let Some(session) = sessions.get(session_id) {
            return session.clone();
        }
        let session = Arc::new(Mutex::new(SessionState {
            remote,
            cwd: env::current_dir().unwrap_or_else(|_| PathBuf::from(".")),
            running: None,
        }));
        sessions.insert(session_id.to_owned(), session.clone());
        println!(
            "[session] {} {{\"host\":\"{}\",\"port\":{}}}",
            session_id,
            remote.ip(),
            remote.port()
        );
        session
    }

    async fn send_shell_result(
        &self,
        session_id: &str,
        remote: SocketAddr,
        payload: Value,
    ) -> Result<()> {
        let frame = SessionFrame {
            session_id: session_id.to_owned(),
            frame_type: "response".to_owned(),
            channel: Some("shell_result".to_owned()),
            payload,
            at: now_ms(),
        };
        let bytes = encode_session_frame(&frame)?;
        self.udp_socket.send_to(&bytes, remote).await?;
        Ok(())
    }

    async fn handle_shell_command(
        self: Arc<Self>,
        session_id: String,
        session: Arc<Mutex<SessionState>>,
        command_id: Option<String>,
        command: String,
    ) -> Result<()> {
        let mut guard = session.lock().await;
        let remote = guard.remote;
        if command.is_empty() {
            let cwd = guard.cwd.display().to_string();
            drop(guard);
            self.send_shell_result(
                &session_id,
                remote,
                json!({"id": command_id, "command": command, "ok": true, "code": 0, "stdout": "", "stderr": "", "cwd": cwd, "ts": now_ms()}),
            )
            .await?;
            return Ok(());
        }

        if command == "cd" || command.starts_with("cd ") {
            let target = if command == "cd" {
                env::var("HOME").unwrap_or_else(|_| guard.cwd.display().to_string())
            } else {
                command[3..].trim().to_owned()
            };
            let resolved = if PathBuf::from(&target).is_absolute() {
                PathBuf::from(&target)
            } else {
                guard.cwd.join(&target)
            };
            if resolved.is_dir() {
                guard.cwd = resolved;
                let cwd = guard.cwd.display().to_string();
                drop(guard);
                self.send_shell_result(
                    &session_id,
                    remote,
                    json!({"id": command_id, "command": command, "ok": true, "code": 0, "stdout": "", "stderr": "", "cwd": cwd, "ts": now_ms()}),
                )
                .await?;
            } else {
                let cwd = guard.cwd.display().to_string();
                drop(guard);
                self.send_shell_result(
                    &session_id,
                    remote,
                    json!({"id": command_id, "command": command, "ok": false, "code": 1, "stdout": "", "stderr": format!("cd: no such directory: {target}"), "cwd": cwd, "ts": now_ms()}),
                )
                .await?;
            }
            return Ok(());
        }

        if guard.running.is_some() {
            let cwd = guard.cwd.display().to_string();
            drop(guard);
            self.send_shell_result(
                &session_id,
                remote,
                json!({"id": command_id, "command": command, "ok": false, "code": 1, "stdout": "", "stderr": "another command is still running; press Ctrl-C first", "cwd": cwd, "ts": now_ms()}),
            )
            .await?;
            return Ok(());
        }

        let cwd = guard.cwd.clone();
        let (cancel_tx, mut cancel_rx) = oneshot::channel();
        guard.running = Some(cancel_tx);
        drop(guard);

        let state = self.clone();
        tokio::spawn(async move {
            let mut child = match Command::new("sh")
                .arg("-lc")
                .arg(&command)
                .current_dir(&cwd)
                .stdout(std::process::Stdio::piped())
                .stderr(std::process::Stdio::piped())
                .spawn()
            {
                Ok(child) => child,
                Err(err) => {
                    let _ = state
                        .send_shell_result(
                            &session_id,
                            remote,
                            json!({"id": command_id, "command": command, "ok": false, "code": 1, "stdout": "", "stderr": err.to_string(), "cwd": cwd.display().to_string(), "ts": now_ms()}),
                        )
                        .await;
                    if let Some(session) = state.sessions.lock().await.get(&session_id).cloned() {
                        session.lock().await.running = None;
                    }
                    return;
                }
            };

            let stdout = child.stdout.take();
            let stderr = child.stderr.take();

            let stdout_task = tokio::spawn(async move {
                let mut buf = Vec::new();
                if let Some(mut stdout) = stdout {
                    let _ = stdout.read_to_end(&mut buf).await;
                }
                buf
            });
            let stderr_task = tokio::spawn(async move {
                let mut buf = Vec::new();
                if let Some(mut stderr) = stderr {
                    let _ = stderr.read_to_end(&mut buf).await;
                }
                buf
            });

            let interrupted = tokio::select! {
                _ = &mut cancel_rx => {
                    let _ = child.kill().await;
                    let _ = child.wait().await;
                    true
                }
                _ = child.wait() => false,
            };

            let stdout = String::from_utf8_lossy(&stdout_task.await.unwrap_or_default()).to_string();
            let stderr = String::from_utf8_lossy(&stderr_task.await.unwrap_or_default()).to_string();
            if let Some(session) = state.sessions.lock().await.get(&session_id).cloned() {
                session.lock().await.running = None;
            }

            let payload = if interrupted {
                json!({"id": command_id, "command": command, "ok": false, "code": 130, "stdout": stdout, "stderr": if stderr.is_empty() { "Interrupted (SIGINT)" } else { stderr.as_str() }, "cwd": cwd.display().to_string(), "ts": now_ms()})
            } else {
                json!({"id": command_id, "command": command, "ok": true, "code": 0, "stdout": stdout, "stderr": stderr, "cwd": cwd.display().to_string(), "ts": now_ms()})
            };

            let _ = state.send_shell_result(&session_id, remote, payload).await;
        });

        Ok(())
    }

    async fn handle_shell_interrupt(&self, session_id: &str, session: Arc<Mutex<SessionState>>) -> Result<()> {
        let mut guard = session.lock().await;
        if let Some(cancel) = guard.running.take() {
            let _ = cancel.send(());
        }
        let remote = guard.remote;
        let cwd = guard.cwd.display().to_string();
        drop(guard);
        self.send_shell_result(
            session_id,
            remote,
            json!({"id": format!("interrupt-{}", now_ms()), "command": "^C", "ok": false, "code": 130, "stdout": "", "stderr": "Interrupted (SIGINT)", "cwd": cwd, "ts": now_ms()}),
        )
        .await?;
        Ok(())
    }
}

fn log_publish_outcome(
    kind: &str,
    target: &str,
    success: &std::collections::HashSet<RelayUrl>,
    failed: &std::collections::HashMap<RelayUrl, String>,
) {
    println!(
        "[rendezvous] publish outcomes {}",
        serde_json::to_string(&json!({
            "logContext": {"kind": kind, "target": target},
            "summary": success
                .iter()
                .map(|relay| json!({"relay": relay.to_string(), "status": "fulfilled"}))
                .chain(failed.iter().map(|(relay, reason)| json!({"relay": relay.to_string(), "status": "rejected", "reason": reason})))
                .collect::<Vec<_>>(),
        }))
        .unwrap_or_else(|_| "{\"kind\":\"log-error\"}".to_owned())
    );
}

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .with_target(false)
        .init();

    let mut args = Args::parse();
    if args.nsec.is_empty() {
        args.nsec = env::var("NOSTR_NSEC").context("missing --nsec or NOSTR_NSEC")?;
    }
    if args.public_host.is_none() {
        args.public_host = env::var("FIPS_UDP_PUBLIC_HOST").ok().filter(|v| !v.is_empty());
    }
    args.advert_relays.retain(|v| !v.trim().is_empty());
    args.dm_relays.retain(|v| !v.trim().is_empty());
    args.stun_servers.retain(|v| !v.trim().is_empty());
    let keys = Keys::parse(&args.nsec).context("invalid NOSTR_NSEC/--nsec")?;
    let client = Client::builder()
        .signer(keys.clone())
        .opts(Options::new().autoconnect(false).gossip(false))
        .build();

    let mut relay_union = HashSet::new();
    relay_union.extend(args.advert_relays.iter().cloned());
    relay_union.extend(args.dm_relays.iter().cloned());
    for relay in relay_union {
        client.add_relay(relay).await?;
    }
    client.connect().await;

    let udp_socket = Arc::new(UdpSocket::bind(("0.0.0.0", args.udp_port)).await?);
    let pubkey = keys.public_key();
    let npub = pubkey.to_bech32()?;
    let state = Arc::new(ServerState {
        client,
        udp_socket: udp_socket.clone(),
        keys,
        npub: npub.clone(),
        pubkey,
        advert_relays: args.advert_relays.clone(),
        dm_relays: args.dm_relays.clone(),
        trusted_npubs: args.trusted_npubs.into_iter().filter(|v| !v.is_empty()).collect(),
        stun_servers: args.stun_servers.clone(),
        public_host: args.public_host.clone(),
        punch_interval_ms: 300,
        punch_duration_ms: 30_000,
        punch_start_delay_ms: 3_000,
        advertise_ttl_ms: 10 * 60 * 1000,
        advertise_interval_ms: 5 * 60 * 1000,
        stun_timeout_ms: 2_000,
        stun_refresh_ms: 60 * 1000,
        pending_stun: Mutex::new(HashMap::new()),
        stun_observation: RwLock::new(None),
        stun_observed_at: Mutex::new(None),
        sessions: Mutex::new(HashMap::new()),
        session_hashes: Mutex::new(HashMap::new()),
    });

    state.refresh_traversal_observation(true).await?;
    state.publish_inbox_relays().await?;
    state.publish_advert().await?;

    let advertise_state = state.clone();
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_millis(advertise_state.advertise_interval_ms));
        loop {
            interval.tick().await;
            let _ = advertise_state.publish_advert().await;
        }
    });

    state
        .client
        .subscribe_to(
            state.dm_relays.clone(),
            Filter::new().kind(Kind::GiftWrap).pubkey(state.pubkey).limit(0),
            None,
        )
        .await?;

    println!(
        "{}",
        serde_json::to_string_pretty(&json!({
            "app": "fips-shell-server-rs",
            "npub": npub,
            "udpPort": udp_socket.local_addr()?.port(),
            "advertRelays": state.advert_relays,
            "dmRelays": state.dm_relays,
            "relaySource": "embedded-defaults",
            "trustedCount": state.trusted_npubs.len(),
        }))?
    );

    let udp_state = state.clone();
    let udp_task = tokio::spawn(async move {
        let mut buf = vec![0_u8; 64 * 1024];
        loop {
            let (len, remote) = udp_state.udp_socket.recv_from(&mut buf).await?;
            let packet = &buf[..len];

            if packet.len() >= 20 {
                let maybe_txn = &packet[8..20];
                if let Ok(txn_id) = <[u8; 12]>::try_from(maybe_txn) {
                    if let Some(mapped) = parse_stun_binding_success(packet, &txn_id) {
                        if let Some(tx) = udp_state.pending_stun.lock().await.remove(&txn_id) {
                            let _ = tx.send(mapped);
                            continue;
                        }
                    }
                }
            }

            if let Ok(punch) = parse_punch_packet(packet) {
                let session_id = {
                    let hashes = udp_state.session_hashes.lock().await;
                    hashes.get(&punch.session_hash).cloned()
                };
                if let Some(session_id) = session_id {
                    if punch.kind == PunchPacketKind::Probe {
                        let ack = build_punch_packet(PunchPacketKind::Ack, &session_id);
                        let _ = udp_state.udp_socket.send_to(&ack, remote).await;
                    }
                    let _ = udp_state.ensure_session(&session_id, remote).await;
                    continue;
                }
            }

            if let Ok(frame) = decode_session_frame(packet) {
                let session = udp_state.ensure_session(&frame.session_id, remote).await;
                match frame.channel.as_deref() {
                    Some("shell") => {
                        let command = frame
                            .payload
                            .get("cmd")
                            .and_then(Value::as_str)
                            .unwrap_or_default()
                            .trim()
                            .to_owned();
                        let command_id = frame.payload.get("id").and_then(Value::as_str).map(str::to_owned);
                        let state = udp_state.clone();
                        tokio::spawn(async move {
                            let _ = state
                                .handle_shell_command(frame.session_id, session, command_id, command)
                                .await;
                        });
                    }
                    Some("shell_interrupt") => {
                        let _ = udp_state.handle_shell_interrupt(&frame.session_id, session).await;
                    }
                    _ => {}
                }
            }
        }
        #[allow(unreachable_code)]
        Ok::<(), anyhow::Error>(())
    });

    let notify_state = state.clone();
    let notify_task = tokio::spawn(async move {
        let mut notifications = notify_state.client.notifications();
        while let Ok(notification) = notifications.recv().await {
            if let RelayPoolNotification::Event { event, .. } = notification {
                if event.kind != Kind::GiftWrap {
                    continue;
                }

                let unwrapped = match nip59::extract_rumor(&notify_state.keys, &event).await {
                    Ok(unwrapped) => unwrapped,
                    Err(_) => continue,
                };
                let rumor = unwrapped.rumor;
                let sender = unwrapped.sender;
                if rumor.kind != Kind::PrivateDirectMessage {
                    continue;
                }

                let from_npub = sender.to_bech32()?;
                if !notify_state.trusted_npubs.is_empty() && !notify_state.trusted_npubs.contains(&from_npub) {
                    println!(
                        "[reject] {}",
                        serde_json::to_string(&json!({"reason":"untrusted-npub","fromNpub":from_npub}))?
                    );
                    continue;
                }

                let hello: LegacyHelloMessage = match serde_json::from_str(&rumor.content) {
                    Ok(msg) => msg,
                    Err(_) => continue,
                };
                if hello.message_type != "fips.rendezvous.hello" || hello.nonce.is_empty() {
                    continue;
                }

                let endpoint = notify_state.resolve_traversal_endpoint().await?;
                let now = now_ms();
                let wants = hello.wants.clone();
                let punch = LegacyPunch {
                    start_at_ms: now + notify_state.punch_start_delay_ms,
                    interval_ms: notify_state.punch_interval_ms,
                    duration_ms: notify_state.punch_duration_ms,
                };
                let stun_uri = if wants.stun_info {
                    notify_state
                        .stun_observation
                        .read()
                        .await
                        .as_ref()
                        .map(|obs| obs.server.clone())
                        .or_else(|| notify_state.stun_servers.first().cloned())
                        .unwrap_or_else(|| "stun:fips.tomdwyer.uk:3478".to_owned())
                } else {
                    String::new()
                };

                let reply = LegacyServerInfoMessage {
                    message_type: "fips.rendezvous.server-info".to_owned(),
                    version: "1.0".to_owned(),
                    session_id: hello.session_id.clone(),
                    nonce: hello.nonce.clone(),
                    issued_at: now,
                    endpoint: endpoint.clone(),
                    punch: wants.fips_connect.then_some(punch.clone()),
                    stun: wants.stun_info.then(|| LegacyStunInfo {
                        uri: stun_uri,
                        metadata_tag: Some("stun".to_owned()),
                    }),
                };

                println!(
                    "[rendezvous] hello received {}",
                    serde_json::to_string(&json!({
                        "fromNpub": from_npub,
                        "nonce": hello.nonce,
                        "sessionId": hello.session_id,
                        "wants": hello.wants,
                        "hasClientEndpoint": hello.client_endpoint.is_some(),
                    }))?
                );

                notify_state
                    .send_dm_to(notify_state.dm_relays.clone(), sender, &reply, "server-info")
                    .await?;

                println!(
                    "[rendezvous] server-info published {}",
                    serde_json::to_string(&json!({
                        "toPubkey": sender.to_hex(),
                        "nonce": reply.nonce,
                        "sessionId": reply.session_id,
                        "endpoint": reply.endpoint,
                        "hasStun": reply.stun.is_some(),
                        "hasPunch": reply.punch.is_some(),
                    }))?
                );

                if wants.fips_connect {
                    if let Some(client_endpoint) = hello.client_endpoint {
                        notify_state
                            .start_punch(hello.nonce.clone(), client_endpoint, punch)
                            .await?;
                    }
                }
            }
        }
        Ok::<(), anyhow::Error>(())
    });

    tokio::select! {
        _ = signal::ctrl_c() => {}
        res = udp_task => { res??; }
        res = notify_task => { res??; }
    }

    Ok(())
}
