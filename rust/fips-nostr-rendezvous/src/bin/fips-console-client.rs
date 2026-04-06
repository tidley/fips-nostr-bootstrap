use std::collections::{HashMap, HashSet};
use std::env;
use std::io::BufRead;
use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use anyhow::{anyhow, Context, Result};
use async_stream::stream;
use axum::extract::State;
use axum::response::sse::{Event as SseEvent, KeepAlive, Sse};
use axum::routing::{get, post};
use axum::{Json, Router};
use clap::Parser;
use fips::AppCommand;
use fips_nostr_rendezvous::fips_handoff::handoff_established_app_runtime;
use fips_nostr_rendezvous::{
    build_punch_packet, create_traversal_offer, parse_punch_packet, parse_stun_url,
    plan_punch_targets, validate_traversal_answer_for_offer, LegacyEndpoint, LegacyHelloMessage,
    LegacyPunch, LegacyServerInfoMessage, LegacyWants, PunchPacketKind, TraversalAddress,
    TraversalAdvert, TraversalAnswer, TraversalOffer, ADVERT_KIND, DEFAULT_ADVERT_RELAYS,
    DEFAULT_DM_RELAYS, DEFAULT_STUN_SERVERS,
};
use nostr::nips::nip17;
use nostr::nips::nip19::ToBech32;
use nostr::nips::nip59;
use nostr::{
    EventBuilder, Filter, Keys, Kind, PublicKey, RelayUrl, SingleLetterTag, Tag, TagKind, Timestamp,
};
use nostr_sdk::prelude::{Client, Options, RelayPoolNotification};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tokio::net::{TcpListener, UdpSocket};
use tokio::sync::{broadcast, oneshot, watch, Mutex, RwLock};
use tokio::time::{sleep, timeout, Instant};

#[derive(Debug, Parser)]
#[command(
    name = "fips-console-client",
    about = "Rust console client over FIPS and Nostr rendezvous"
)]
struct Args {
    #[arg(long, default_value = "")]
    nsec: String,

    #[arg(long, default_value_t = 8788)]
    http_port: u16,

    #[arg(long, default_value_t = 0)]
    udp_port: u16,

    #[arg(long, value_delimiter = ',', num_args = 1.., default_values_t = default_advert_relays())]
    advert_relays: Vec<String>,

    #[arg(long, value_delimiter = ',', num_args = 1.., default_values_t = default_dm_relays())]
    dm_relays: Vec<String>,

    #[arg(long, value_delimiter = ',', num_args = 0.., default_values_t = default_stun_servers())]
    stun_servers: Vec<String>,

    #[arg(long)]
    public_host: Option<String>,

    #[arg(long, default_value_t = false)]
    no_discover: bool,

    #[arg(long, default_value_t = false)]
    handoff_fips: bool,

    #[arg(long)]
    npub: Option<String>,
}

fn default_advert_relays() -> Vec<String> {
    DEFAULT_ADVERT_RELAYS
        .iter()
        .map(|v| v.to_string())
        .collect()
}

fn default_dm_relays() -> Vec<String> {
    DEFAULT_DM_RELAYS.iter().map(|v| v.to_string()).collect()
}

fn default_stun_servers() -> Vec<String> {
    DEFAULT_STUN_SERVERS.iter().map(|v| v.to_string()).collect()
}

fn parse_csv_env_list(name: &str) -> Option<Vec<String>> {
    let raw = env::var(name).ok()?;
    let values = raw
        .split(',')
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty())
        .collect::<Vec<_>>();
    if values.is_empty() {
        None
    } else {
        Some(values)
    }
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn nonce() -> String {
    format!("{}-{:x}", now_ms(), rand::random::<u64>())
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
        let parsed = match attr_type {
            STUN_ATTR_XOR_MAPPED_ADDRESS => parse_xor_mapped_address(value),
            STUN_ATTR_MAPPED_ADDRESS => parse_mapped_address(value),
            _ => None,
        };
        if parsed.is_some() {
            return parsed;
        }
        offset = value_end + ((4 - (attr_len % 4)) % 4);
    }
    None
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct EventEnvelope {
    event: String,
    data: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct ActiveSession {
    #[serde(rename = "sessionId")]
    session_id: String,
    remote: LegacyEndpoint,
}

const CONSOLE_APP_PORT: u16 = 4200;

#[derive(Debug, Clone)]
struct ConsoleRuntimeHandle {
    peer_npub: String,
    command_tx: tokio::sync::mpsc::Sender<AppCommand>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct MetaResponse {
    ok: bool,
    npub: String,
    #[serde(rename = "udpPort")]
    udp_port: u16,
    #[serde(rename = "advertRelays")]
    advert_relays: Vec<String>,
    #[serde(rename = "dmRelays")]
    dm_relays: Vec<String>,
    #[serde(rename = "discoveryEnabled")]
    discovery_enabled: bool,
}

#[derive(Debug, Clone)]
struct StunObservation {
    server: String,
    reflexive_address: Option<LegacyEndpoint>,
    local_port: u16,
    local_interface_addresses: Vec<String>,
}

fn log_traversal_observation(role: &str, observation: Option<&StunObservation>) {
    if let Some(observation) = observation {
        println!(
            "[traversal] observation {}",
            serde_json::to_string(&json!({
                "role": role,
                "server": observation.server,
                "reflexiveAddress": observation.reflexive_address,
                "localPort": observation.local_port,
                "localInterfaceAddresses": observation.local_interface_addresses,
            }))
            .unwrap_or_else(|_| "{\"role\":\"log-error\"}".to_owned())
        );
        if observation.reflexive_address.is_none() {
            println!(
                "[traversal] warning {}",
                serde_json::to_string(&json!({
                    "role": role,
                    "reason": "no reflexive STUN address observed; internet punching may fail and local interface fallback may be incorrect",
                    "localInterfaceAddresses": observation.local_interface_addresses,
                }))
                .unwrap_or_else(|_| "{\"role\":\"log-error\"}".to_owned())
            );
        }
    } else {
        println!(
            "[traversal] warning {}",
            serde_json::to_string(&json!({
                "role": role,
                "reason": "no traversal observation available",
            }))
            .unwrap_or_else(|_| "{\"role\":\"log-error\"}".to_owned())
        );
    }
}

fn log_stun_attempt(
    role: &str,
    stun_url: &str,
    local_port: u16,
    local_interface_addresses: &[String],
) {
    println!(
        "[traversal] stun-attempt {}",
        serde_json::to_string(&json!({
            "role": role,
            "server": stun_url,
            "localPort": local_port,
            "localInterfaceAddresses": local_interface_addresses,
        }))
        .unwrap_or_else(|_| "{\"role\":\"log-error\"}".to_owned())
    );
}

fn log_stun_result(
    role: &str,
    stun_url: &str,
    local_port: u16,
    local_interface_addresses: &[String],
    result: Result<&LegacyEndpoint, &str>,
) {
    match result {
        Ok(reflexive_address) => println!(
            "[traversal] stun-result {}",
            serde_json::to_string(&json!({
                "role": role,
                "server": stun_url,
                "localPort": local_port,
                "localInterfaceAddresses": local_interface_addresses,
                "reflexiveAddress": reflexive_address,
                "status": "ok",
            }))
            .unwrap_or_else(|_| "{\"role\":\"log-error\"}".to_owned())
        ),
        Err(error) => println!(
            "[traversal] stun-result {}",
            serde_json::to_string(&json!({
                "role": role,
                "server": stun_url,
                "localPort": local_port,
                "localInterfaceAddresses": local_interface_addresses,
                "error": error,
                "status": "error",
            }))
            .unwrap_or_else(|_| "{\"role\":\"log-error\"}".to_owned())
        ),
    }
}

struct AppState {
    client: Client,
    udp_socket: Arc<UdpSocket>,
    keys: Keys,
    resolved_nsec: String,
    npub: String,
    pubkey: PublicKey,
    advert_relays: Vec<String>,
    dm_relays: Vec<String>,
    inbox_lookup_relays: Vec<String>,
    discovery_enabled: bool,
    public_host: Option<String>,
    stun_servers: Vec<String>,
    stun_timeout_ms: u64,
    stun_refresh_ms: u64,
    punch_interval_ms: u64,
    punch_duration_ms: u64,
    punch_start_delay_ms: u64,
    pending_stun: Mutex<HashMap<[u8; 12], oneshot::Sender<LegacyEndpoint>>>,
    stun_observation: RwLock<Option<StunObservation>>,
    stun_observed_at: Mutex<Option<Instant>>,
    advert_cache: RwLock<HashMap<String, TraversalAdvert>>,
    pending_answer: Mutex<HashMap<String, oneshot::Sender<TraversalAnswer>>>,
    pending_server_info: Mutex<HashMap<String, oneshot::Sender<LegacyServerInfoMessage>>>,
    pending_punch: Mutex<HashMap<String, oneshot::Sender<LegacyEndpoint>>>,
    punch_hashes: Mutex<HashMap<[u8; 16], String>>,
    active_session: RwLock<Option<ActiveSession>>,
    handoff_fips: bool,
    console_runtime: Mutex<Option<ConsoleRuntimeHandle>>,
    handoff_socket: Mutex<Option<std::net::UdpSocket>>,
    udp_shutdown: watch::Sender<bool>,
    events: broadcast::Sender<EventEnvelope>,
}

impl AppState {
    async fn emit(&self, event: &str, data: Value) {
        let _ = self.events.send(EventEnvelope {
            event: event.to_owned(),
            data,
        });
    }

    async fn current_status_value(&self) -> Value {
        let active = self.active_session.read().await.clone();
        if let Some(active) = active {
            json!({"connected": true, "sessionId": active.session_id, "remote": active.remote})
        } else {
            json!({"connected": false, "sessionId": null, "remote": null})
        }
    }

    async fn take_handoff_socket(&self) -> Result<std::net::UdpSocket> {
        self.handoff_socket
            .lock()
            .await
            .take()
            .context("FIPS handoff socket already consumed")
    }

    async fn refresh_traversal_observation(&self, force: bool) -> Result<Option<StunObservation>> {
        if self.stun_servers.is_empty() {
            return Ok(self.stun_observation.read().await.clone());
        }
        if !force {
            if let Some(observed_at) = *self.stun_observed_at.lock().await {
                if observed_at.elapsed() < Duration::from_millis(self.stun_refresh_ms) {
                    return Ok(self.stun_observation.read().await.clone());
                }
            }
        }

        let local_port = self.udp_socket.local_addr()?.port();
        let local_interface_addresses = local_ipv4_hint()
            .map(|ip| vec![ip.to_string()])
            .unwrap_or_default();

        for server in &self.stun_servers {
            log_stun_attempt("client", server, local_port, &local_interface_addresses);
            match self.probe_stun_server(server).await {
                Ok(reflexive_address) => {
                    log_stun_result(
                        "client",
                        server,
                        local_port,
                        &local_interface_addresses,
                        Ok(&reflexive_address),
                    );
                    let obs = StunObservation {
                        server: server.clone(),
                        reflexive_address: Some(reflexive_address),
                        local_port,
                        local_interface_addresses: local_interface_addresses.clone(),
                    };
                    *self.stun_observation.write().await = Some(obs.clone());
                    *self.stun_observed_at.lock().await = Some(Instant::now());
                    return Ok(Some(obs));
                }
                Err(err) => {
                    let error = err.to_string();
                    log_stun_result(
                        "client",
                        server,
                        local_port,
                        &local_interface_addresses,
                        Err(&error),
                    );
                }
            }
        }

        let obs = StunObservation {
            server: self.stun_servers[0].clone(),
            reflexive_address: None,
            local_port,
            local_interface_addresses,
        };
        *self.stun_observation.write().await = Some(obs.clone());
        *self.stun_observed_at.lock().await = Some(Instant::now());
        Ok(Some(obs))
    }

    async fn probe_stun_server(&self, stun_url: &str) -> Result<LegacyEndpoint> {
        let endpoint = parse_stun_url(stun_url)?;
        let txn_id: [u8; 12] = rand::random();
        let request = create_stun_binding_request(txn_id);
        let (tx, rx) = oneshot::channel();
        self.pending_stun.lock().await.insert(txn_id, tx);
        self.udp_socket
            .send_to(&request, format!("{}:{}", endpoint.host, endpoint.port))
            .await?;
        timeout(Duration::from_millis(self.stun_timeout_ms), rx)
            .await
            .with_context(|| format!("stun timeout to {}", stun_url))?
            .map_err(|_| anyhow!("stun channel dropped"))
    }

    async fn local_client_endpoint(&self) -> Result<LegacyEndpoint> {
        let local_port = self.udp_socket.local_addr()?.port();
        if let Some(obs) = self.refresh_traversal_observation(false).await? {
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
                port: local_port,
            });
        }
        Ok(LegacyEndpoint {
            host: local_ipv4_hint()
                .unwrap_or(Ipv4Addr::new(127, 0, 0, 1))
                .to_string(),
            port: local_port,
        })
    }

    async fn local_traversal_addresses(
        &self,
    ) -> Result<(Option<TraversalAddress>, Vec<TraversalAddress>)> {
        let local_port = self.udp_socket.local_addr()?.port();
        let observation = self.refresh_traversal_observation(false).await?;
        let reflexive_address = observation
            .as_ref()
            .and_then(|obs| obs.reflexive_address.as_ref())
            .map(|endpoint| TraversalAddress {
                protocol: "udp".to_owned(),
                ip: endpoint.host.clone(),
                port: endpoint.port,
            })
            .or_else(|| {
                self.public_host.as_ref().map(|host| TraversalAddress {
                    protocol: "udp".to_owned(),
                    ip: host.clone(),
                    port: local_port,
                })
            });
        let local_addresses = observation
            .as_ref()
            .map(|obs| {
                obs.local_interface_addresses
                    .iter()
                    .map(|host| TraversalAddress {
                        protocol: "udp".to_owned(),
                        ip: host.clone(),
                        port: obs.local_port,
                    })
                    .collect::<Vec<_>>()
            })
            .unwrap_or_else(|| {
                local_ipv4_hint()
                    .map(|ip| {
                        vec![TraversalAddress {
                            protocol: "udp".to_owned(),
                            ip: ip.to_string(),
                            port: local_port,
                        }]
                    })
                    .unwrap_or_default()
            });
        Ok((reflexive_address, local_addresses))
    }

    async fn publish_inbox_relays(&self) -> Result<()> {
        let tags = self
            .dm_relays
            .iter()
            .filter_map(|relay| RelayUrl::parse(relay).ok())
            .map(|relay| {
                Tag::custom(
                    TagKind::SingleLetter(SingleLetterTag::lowercase(nostr::Alphabet::R)),
                    [relay.to_string()],
                )
            })
            .collect::<Vec<_>>();
        let event = EventBuilder::new(Kind::InboxRelays, "")
            .tags(tags)
            .sign_with_keys(&self.keys)?;
        let _ = self
            .client
            .send_event_to(self.dm_relays.clone(), event)
            .await?;
        Ok(())
    }

    async fn refresh_advert_cache(&self, wait_ms: u64) -> Result<()> {
        let filter = Filter::new()
            .kind(Kind::Custom(ADVERT_KIND))
            .since(Timestamp::from(
                Timestamp::now().as_u64().saturating_sub(3 * 24 * 60 * 60),
            ));
        let events = self
            .client
            .fetch_events_from(
                self.advert_relays.clone(),
                filter,
                Duration::from_millis(wait_ms),
            )
            .await?;
        let mut cache = self.advert_cache.write().await;
        for event in events.iter() {
            if let Ok(advert) = serde_json::from_str::<TraversalAdvert>(&event.content) {
                if advert.expires_at <= now_ms() {
                    continue;
                }
                let replace = cache
                    .get(&advert.publisher_npub)
                    .map(|existing| {
                        advert.published_at > existing.published_at
                            || (advert.published_at == existing.published_at
                                && advert.sequence >= existing.sequence)
                    })
                    .unwrap_or(true);
                if replace {
                    cache.insert(advert.publisher_npub.clone(), advert);
                }
            }
        }
        Ok(())
    }

    async fn list_advertised_peers(&self, max_peers: usize) -> Result<Vec<TraversalAdvert>> {
        if self.discovery_enabled {
            let _ = self.refresh_advert_cache(2_000).await;
        }
        let cache = self.advert_cache.read().await;
        let mut adverts = cache
            .values()
            .filter(|advert| advert.publisher_npub != self.npub && advert.expires_at > now_ms())
            .cloned()
            .collect::<Vec<_>>();
        adverts.sort_by(|a, b| {
            b.published_at
                .cmp(&a.published_at)
                .then_with(|| b.sequence.cmp(&a.sequence))
        });
        adverts.truncate(max_peers);
        Ok(adverts)
    }

    async fn find_advertised_peer(&self, target_npub: &str) -> Result<Option<TraversalAdvert>> {
        self.refresh_advert_cache(2_000).await.ok();
        Ok(self
            .advert_cache
            .read()
            .await
            .get(target_npub)
            .filter(|advert| advert.expires_at > now_ms())
            .cloned())
    }

    async fn find_recipient_inbox_relays(&self, target_pubkey: PublicKey) -> Result<Vec<String>> {
        let filter = Filter::new()
            .author(target_pubkey)
            .kind(Kind::InboxRelays)
            .since(Timestamp::from(
                Timestamp::now().as_u64().saturating_sub(30 * 24 * 60 * 60),
            ));
        let events = match self
            .client
            .fetch_events_from(
                self.inbox_lookup_relays.clone(),
                filter,
                Duration::from_millis(1_500),
            )
            .await
        {
            Ok(events) => events,
            Err(_) => return Ok(self.dm_relays.clone()),
        };
        let mut newest: Option<nostr::Event> = None;
        for event in events.iter() {
            if newest
                .as_ref()
                .map(|current| event.created_at >= current.created_at)
                .unwrap_or(true)
            {
                newest = Some(event.clone());
            }
        }
        if let Some(event) = newest {
            let relays = nip17::extract_relay_list(&event)
                .map(|relay| relay.to_string())
                .collect::<Vec<_>>();
            if !relays.is_empty() {
                return Ok(relays);
            }
        }
        Ok(self.dm_relays.clone())
    }

    async fn preferred_dm_relays(
        &self,
        target_pubkey: PublicKey,
        advert: Option<&TraversalAdvert>,
    ) -> Result<Vec<String>> {
        let mut merged = Vec::new();
        for relay in self.find_recipient_inbox_relays(target_pubkey).await? {
            if !merged.contains(&relay) {
                merged.push(relay);
            }
        }
        if let Some(advert) = advert {
            for relay in &advert.relays {
                if !merged.contains(relay) {
                    merged.push(relay.clone());
                }
            }
        }
        for relay in &self.dm_relays {
            if !merged.contains(relay) {
                merged.push(relay.clone());
            }
        }
        Ok(merged)
    }

    async fn send_hello(
        &self,
        relays: Vec<String>,
        target_pubkey: PublicKey,
        target_npub: String,
    ) -> Result<(LegacyServerInfoMessage, Option<TraversalAdvert>)> {
        let discovered_advert = self.find_advertised_peer(&target_npub).await?;
        let endpoint = self.local_client_endpoint().await?;
        let session_id = nonce();
        println!(
            "[rendezvous] hello prepared {}",
            serde_json::to_string(&json!({
                "targetNpub": target_npub,
                "sessionId": session_id,
                "clientEndpoint": endpoint,
                "relays": relays,
                "discoveredAdvertRelays": discovered_advert.as_ref().map(|advert| advert.relays.clone()),
            }))
            .unwrap_or_else(|_| "{\"kind\":\"log-error\"}".to_owned())
        );
        let hello = LegacyHelloMessage {
            message_type: "fips.rendezvous.hello".to_owned(),
            version: "1.0".to_owned(),
            session_id: session_id.clone(),
            nonce: session_id.clone(),
            issued_at: now_ms(),
            wants: LegacyWants {
                stun_info: true,
                fips_connect: true,
            },
            client_endpoint: Some(endpoint),
        };

        let (tx, mut rx) = oneshot::channel();
        self.pending_server_info
            .lock()
            .await
            .insert(session_id.clone(), tx);

        let start = Instant::now();
        let wait_ms = 60_000u64;
        let retry_ms = 5_000u64;
        loop {
            let event = EventBuilder::private_msg(
                &self.keys,
                target_pubkey,
                serde_json::to_string(&hello)?,
                [Tag::public_key(target_pubkey)],
            )
            .await?;
            let _ = self.client.send_event_to(relays.clone(), event).await?;
            match timeout(Duration::from_millis(retry_ms), &mut rx).await {
                Ok(Ok(reply)) => return Ok((reply, discovered_advert)),
                Ok(Err(_)) => return Err(anyhow!("pending reply channel closed")),
                Err(_) if start.elapsed() >= Duration::from_millis(wait_ms) => {
                    self.pending_server_info.lock().await.remove(&session_id);
                    return Err(anyhow!("timed out waiting for traversal answer"));
                }
                Err(_) => continue,
            }
        }
    }

    async fn send_offer(
        &self,
        relays: Vec<String>,
        target_pubkey: PublicKey,
        target_npub: String,
    ) -> Result<(TraversalOffer, TraversalAnswer, Option<TraversalAdvert>)> {
        let discovered_advert = self.find_advertised_peer(&target_npub).await?;
        let (reflexive_address, local_addresses) = self.local_traversal_addresses().await?;
        let session_id = nonce();
        let offer = create_traversal_offer(
            session_id.clone(),
            now_ms(),
            60_000,
            session_id.clone(),
            self.npub.clone(),
            target_npub.clone(),
            reflexive_address,
            local_addresses,
        );
        println!(
            "[rendezvous] offer prepared {}",
            serde_json::to_string(&json!({
                "targetNpub": target_npub,
                "sessionId": offer.session_id,
                "nonce": offer.nonce,
                "reflexiveAddress": offer.reflexive_address,
                "localAddresses": offer.local_addresses,
                "relays": relays,
                "discoveredAdvertRelays": discovered_advert.as_ref().map(|advert| advert.relays.clone()),
            }))
            .unwrap_or_else(|_| "{\"kind\":\"log-error\"}".to_owned())
        );

        let (tx, mut rx) = oneshot::channel();
        self.pending_answer
            .lock()
            .await
            .insert(offer.nonce.clone(), tx);

        let start = Instant::now();
        let wait_ms = 15_000u64;
        let retry_ms = 3_000u64;
        loop {
            let event = EventBuilder::private_msg(
                &self.keys,
                target_pubkey,
                serde_json::to_string(&offer)?,
                [Tag::public_key(target_pubkey)],
            )
            .await?;
            let _ = self.client.send_event_to(relays.clone(), event).await?;
            match timeout(Duration::from_millis(retry_ms), &mut rx).await {
                Ok(Ok(answer)) => {
                    validate_traversal_answer_for_offer(&offer, &answer, now_ms())
                        .map_err(|reason| anyhow!("invalid traversal answer: {reason}"))?;
                    return Ok((offer, answer, discovered_advert));
                }
                Ok(Err(_)) => return Err(anyhow!("pending answer channel closed")),
                Err(_) if start.elapsed() >= Duration::from_millis(wait_ms) => {
                    self.pending_answer.lock().await.remove(&offer.nonce);
                    return Err(anyhow!("timed out waiting for traversal answer"));
                }
                Err(_) => continue,
            }
        }
    }

    fn endpoint_from_traversal_address(address: &TraversalAddress) -> LegacyEndpoint {
        LegacyEndpoint {
            host: address.ip.clone(),
            port: address.port,
        }
    }

    fn select_remote_endpoint_from_answer(answer: &TraversalAnswer) -> Option<LegacyEndpoint> {
        answer
            .reflexive_address
            .as_ref()
            .map(Self::endpoint_from_traversal_address)
            .or_else(|| {
                answer
                    .local_addresses
                    .first()
                    .map(Self::endpoint_from_traversal_address)
            })
    }

    fn planned_remote_endpoints_from_offer_answer(
        offer: &TraversalOffer,
        answer: &TraversalAnswer,
    ) -> Vec<LegacyEndpoint> {
        let targets = plan_punch_targets(
            &offer.local_addresses,
            offer.reflexive_address.as_ref(),
            &answer.local_addresses,
            answer.reflexive_address.as_ref(),
        );
        let mut remotes = Vec::new();
        for target in targets {
            let endpoint = Self::endpoint_from_traversal_address(&target.remote);
            if !remotes.iter().any(|existing: &LegacyEndpoint| {
                existing.host == endpoint.host && existing.port == endpoint.port
            }) {
                remotes.push(endpoint);
            }
        }
        if remotes.is_empty() {
            if let Some(endpoint) = Self::select_remote_endpoint_from_answer(answer) {
                remotes.push(endpoint);
            }
        }
        remotes
    }

    async fn start_punch_and_wait(
        &self,
        session_id: String,
        remote: LegacyEndpoint,
        punch: LegacyPunch,
    ) -> Result<LegacyEndpoint> {
        let remote_addr = SocketAddr::new(remote.host.parse()?, remote.port);
        let (tx, rx) = oneshot::channel();
        self.pending_punch
            .lock()
            .await
            .insert(session_id.clone(), tx);
        self.punch_hashes.lock().await.insert(
            fips_nostr_rendezvous::session_hash(&session_id),
            session_id.clone(),
        );

        let socket = self.udp_socket.clone();
        let delay_ms = punch.start_at_ms.saturating_sub(now_ms());
        let interval_ms = punch.interval_ms;
        let duration_ms = punch.duration_ms;
        tokio::spawn(async move {
            sleep(Duration::from_millis(delay_ms)).await;
            let started = Instant::now();
            while started.elapsed() < Duration::from_millis(duration_ms) {
                let packet = build_punch_packet(PunchPacketKind::Probe, &session_id);
                let _ = socket.send_to(&packet, remote_addr).await;
                sleep(Duration::from_millis(interval_ms)).await;
            }
        });

        let remote = timeout(Duration::from_millis(duration_ms + 5_000), rx)
            .await
            .context("timed out waiting for UDP hole punch")?
            .map_err(|_| anyhow!("punch channel dropped"))?;
        Ok(remote)
    }

    async fn start_punch_plan_and_wait(
        &self,
        session_id: String,
        remotes: Vec<LegacyEndpoint>,
        punch: LegacyPunch,
    ) -> Result<LegacyEndpoint> {
        if remotes.is_empty() {
            return Err(anyhow!("no punch targets planned"));
        }
        let remote_addrs = remotes
            .iter()
            .map(|remote| Ok(SocketAddr::new(remote.host.parse()?, remote.port)))
            .collect::<Result<Vec<_>>>()?;
        let (tx, rx) = oneshot::channel();
        self.pending_punch
            .lock()
            .await
            .insert(session_id.clone(), tx);
        self.punch_hashes.lock().await.insert(
            fips_nostr_rendezvous::session_hash(&session_id),
            session_id.clone(),
        );

        let socket = self.udp_socket.clone();
        let delay_ms = punch.start_at_ms.saturating_sub(now_ms());
        let interval_ms = punch.interval_ms;
        let duration_ms = punch.duration_ms;
        tokio::spawn(async move {
            sleep(Duration::from_millis(delay_ms)).await;
            let started = Instant::now();
            while started.elapsed() < Duration::from_millis(duration_ms) {
                let packet = build_punch_packet(PunchPacketKind::Probe, &session_id);
                for remote in &remote_addrs {
                    let _ = socket.send_to(&packet, remote).await;
                }
                sleep(Duration::from_millis(interval_ms)).await;
            }
        });

        let remote = timeout(Duration::from_millis(duration_ms + 5_000), rx)
            .await
            .context("timed out waiting for UDP hole punch")?
            .map_err(|_| anyhow!("punch channel dropped"))?;
        Ok(remote)
    }

    async fn set_active_session(&self, session_id: String, remote: LegacyEndpoint) {
        *self.active_session.write().await = Some(ActiveSession {
            session_id: session_id.clone(),
            remote: remote.clone(),
        });
        self.emit(
            "status",
            json!({"connected": true, "sessionId": session_id, "remote": remote}),
        )
        .await;
    }

    async fn set_console_runtime(&self, runtime: ConsoleRuntimeHandle) {
        *self.console_runtime.lock().await = Some(runtime);
    }

    async fn send_console_message(&self, text: String) -> Result<()> {
        let runtime = self
            .console_runtime
            .lock()
            .await
            .clone()
            .context("FIPS console runtime not connected")?;
        let (tx, rx) = oneshot::channel();
        runtime
            .command_tx
            .send(AppCommand::SendDatagram {
                peer_npub: runtime.peer_npub.clone(),
                src_port: CONSOLE_APP_PORT,
                dst_port: CONSOLE_APP_PORT,
                payload: text.into_bytes(),
                response: tx,
            })
            .await
            .context("console command channel closed")?;
        rx.await
            .context("console command response dropped")?
            .map_err(anyhow::Error::from)?;
        Ok(())
    }

    async fn accept_console_datagram(&self, peer_npub: String, payload: Vec<u8>) -> Result<()> {
        let text = String::from_utf8(payload).context("console payload must be UTF-8")?;
        self.emit(
            "message",
            json!({"from": peer_npub, "text": text, "at": now_ms()}),
        )
        .await;
        Ok(())
    }
}

#[derive(Debug, Deserialize)]
struct ConnectRequest {
    npub: Option<String>,
}

#[derive(Debug, Deserialize)]
struct SendRequest {
    text: String,
}

async fn api_meta(State(state): State<Arc<AppState>>) -> Json<MetaResponse> {
    Json(MetaResponse {
        ok: true,
        npub: state.npub.clone(),
        udp_port: state.udp_socket.local_addr().map(|a| a.port()).unwrap_or(0),
        advert_relays: state.advert_relays.clone(),
        dm_relays: state.dm_relays.clone(),
        discovery_enabled: state.discovery_enabled,
    })
}

async fn api_discover(State(state): State<Arc<AppState>>) -> Json<Value> {
    match state.list_advertised_peers(10).await {
        Ok(peers) => Json(json!({"ok": true, "peers": peers})),
        Err(err) => Json(json!({"ok": false, "error": err.to_string(), "peers": []})),
    }
}

async fn api_send(
    State(state): State<Arc<AppState>>,
    Json(body): Json<SendRequest>,
) -> Json<Value> {
    match state.send_console_message(body.text).await {
        Ok(()) => Json(json!({"ok": true})),
        Err(err) => Json(json!({"ok": false, "error": err.to_string()})),
    }
}

async fn api_connect(
    State(state): State<Arc<AppState>>,
    Json(body): Json<ConnectRequest>,
) -> Json<Value> {
    let npub = body.npub.unwrap_or_default().trim().to_owned();
    println!(
        "[console-daemon] connect request {}",
        serde_json::to_string(&json!({
            "target": if npub.is_empty() { "(first-discovered-peer)" } else { npub.as_str() },
            "mode": if npub.is_empty() { "advert-discovery" } else { "explicit-npub-direct" },
        }))
        .unwrap_or_default()
    );

    let started_at = now_ms();
    let result: Result<Value> = async {
        let (target_npub, discovered_advert) = if npub.is_empty() {
            let peers = state.list_advertised_peers(1).await?;
            let advert = peers
                .into_iter()
                .next()
                .context("timed out waiting for any traversal advert after 60000ms")?;
            (advert.publisher_npub.clone(), Some(advert))
        } else {
            let advert = if state.discovery_enabled {
                state.find_advertised_peer(&npub).await?
            } else {
                None
            };
            (npub.clone(), advert)
        };

        if target_npub == state.npub {
            return Err(anyhow!("refusing to connect to self"));
        }
        let decoded = nostr::nips::nip19::FromBech32::from_bech32(&target_npub)?;
        let target_pubkey = match decoded {
            nostr::nips::nip19::Nip19::Pubkey(pubkey) => pubkey,
            _ => return Err(anyhow!("target must be npub")),
        };
        let dm_relays = state
            .preferred_dm_relays(target_pubkey, discovered_advert.as_ref())
            .await?;

        let (session_id, discovered_advert, established_remote) = match state
            .send_offer(dm_relays.clone(), target_pubkey, target_npub.clone())
            .await
        {
            Ok((offer, answer, discovered_advert)) => {
                if !answer.accepted {
                    return Err(anyhow!(
                        "{}",
                        answer
                            .reason
                            .clone()
                            .unwrap_or_else(|| "traversal answer rejected".to_owned())
                    ));
                }
                let remotes = AppState::planned_remote_endpoints_from_offer_answer(&offer, &answer);
                let punch = answer
                    .punch
                    .clone()
                    .map(|punch| LegacyPunch {
                        start_at_ms: punch.start_at_ms,
                        interval_ms: punch.interval_ms,
                        duration_ms: punch.duration_ms,
                    })
                    .unwrap_or(LegacyPunch {
                        start_at_ms: now_ms() + state.punch_start_delay_ms,
                        interval_ms: state.punch_interval_ms,
                        duration_ms: state.punch_duration_ms,
                    });
                let established_remote = state
                    .start_punch_plan_and_wait(offer.session_id.clone(), remotes, punch)
                    .await?;
                (offer.session_id, discovered_advert, established_remote)
            }
            Err(offer_err) => {
                println!(
                    "[console-daemon] offer fallback {}",
                    serde_json::to_string(&json!({
                        "target": target_npub,
                        "error": offer_err.to_string(),
                        "fallback": "legacy-hello",
                    }))
                    .unwrap_or_default()
                );
                let (reply, discovered_advert) = state
                    .send_hello(dm_relays, target_pubkey, target_npub.clone())
                    .await?;
                let remote = reply.endpoint.clone();
                let punch = reply.punch.clone().unwrap_or(LegacyPunch {
                    start_at_ms: now_ms() + state.punch_start_delay_ms,
                    interval_ms: state.punch_interval_ms,
                    duration_ms: state.punch_duration_ms,
                });
                let established_remote = state
                    .start_punch_and_wait(reply.nonce.clone(), remote, punch)
                    .await?;
                (reply.nonce, discovered_advert, established_remote)
            }
        };
        let mut response = json!({
            "ok": true,
            "sessionId": session_id,
            "remote": established_remote,
            "discovered": discovered_advert.is_some(),
            "discoveredAdvert": discovered_advert,
        });

        if state.handoff_fips {
            let _ = state.udp_shutdown.send(true);
            sleep(Duration::from_millis(50)).await;
            let handoff_socket = state.take_handoff_socket().await?;
            let remote_addr = SocketAddr::new(
                established_remote
                    .host
                    .parse()
                    .context("invalid established remote host")?,
                established_remote.port,
            );
            let runtime = handoff_established_app_runtime(
                &state.resolved_nsec,
                session_id.clone(),
                target_npub.clone(),
                handoff_socket,
                remote_addr,
                CONSOLE_APP_PORT,
            )
            .await?;
            let (handoff, command_tx, app_rx) = runtime.into_parts();
            state
                .set_console_runtime(ConsoleRuntimeHandle {
                    peer_npub: target_npub.clone(),
                    command_tx,
                })
                .await;
            let message_state = state.clone();
            let runtime_handle = tokio::runtime::Handle::current();
            tokio::task::spawn_blocking(move || {
                while let Ok(datagram) = app_rx.recv() {
                    let message_state = message_state.clone();
                    let peer_npub = datagram.peer_npub;
                    let payload = datagram.payload;
                    runtime_handle.block_on(async move {
                        if let Err(err) = message_state
                            .accept_console_datagram(peer_npub, payload)
                            .await
                        {
                            eprintln!("[console-runtime] message-accept-error {err}");
                        }
                    });
                }
            });
            state
                .set_active_session(session_id.clone(), established_remote.clone())
                .await;
            response["handoff"] = serde_json::to_value(handoff)?;
            response["runtimeMode"] = json!("fips-console");
            return Ok(response);
        }

        state
            .set_active_session(session_id.clone(), established_remote.clone())
            .await;

        Ok(response)
    }
    .await;

    match result {
        Ok(value) => {
            println!(
                "[console-daemon] connect success {}",
                serde_json::to_string(&json!({
                    "sessionId": value["sessionId"],
                    "remote": value["remote"],
                    "elapsedMs": now_ms().saturating_sub(started_at),
                }))
                .unwrap_or_default()
            );
            Json(value)
        }
        Err(err) => {
            println!(
                "[console-daemon] connect failure {}",
                serde_json::to_string(&json!({
                    "error": err.to_string(),
                    "elapsedMs": now_ms().saturating_sub(started_at),
                }))
                .unwrap_or_default()
            );
            Json(json!({"ok": false, "error": err.to_string()}))
        }
    }
}

async fn api_events(State(state): State<Arc<AppState>>) -> impl axum::response::IntoResponse {
    let mut rx = state.events.subscribe();
    let initial = state.current_status_value().await;
    Sse::new(stream! {
        yield Ok::<SseEvent, std::convert::Infallible>(SseEvent::default().event("status").data(initial.to_string()));
        while let Ok(envelope) = rx.recv().await {
            yield Ok::<SseEvent, std::convert::Infallible>(SseEvent::default().event(envelope.event).data(envelope.data.to_string()));
        }
    })
    .keep_alive(KeepAlive::new().interval(Duration::from_secs(15)).text("keepalive"))
}

async fn run_console_runtime(
    peer_npub: String,
    runtime: fips_nostr_rendezvous::fips_handoff::FipsAppRuntime,
) -> Result<()> {
    let (status, command_tx, app_rx) = runtime.into_parts();
    println!(
        "{}",
        serde_json::to_string_pretty(&json!({
            "app": "fips-console-client",
            "sessionId": status.session_id,
            "peerNpub": status.peer_npub,
            "transportId": status.transport_id,
            "localAddr": status.local_addr,
            "remoteAddr": status.remote_addr,
        }))?
    );
    println!("Connected. Type lines and press Enter. Ctrl-C exits.");

    std::thread::spawn(move || {
        while let Ok(datagram) = app_rx.recv() {
            let text = String::from_utf8_lossy(&datagram.payload);
            println!("[{}] {}", datagram.peer_npub, text);
        }
    });

    let (line_tx, mut line_rx) = tokio::sync::mpsc::channel::<String>(32);
    std::thread::spawn(move || {
        let stdin = std::io::stdin();
        for line in stdin.lock().lines() {
            match line {
                Ok(line) => {
                    if line_tx.blocking_send(line).is_err() {
                        break;
                    }
                }
                Err(err) => {
                    eprintln!("[console-input] read-error {err}");
                    break;
                }
            }
        }
    });

    while let Some(line) = line_rx.recv().await {
        let text = line.trim_end().to_owned();
        if text.is_empty() {
            continue;
        }
        let (tx, rx) = oneshot::channel();
        command_tx
            .send(AppCommand::SendDatagram {
                peer_npub: peer_npub.clone(),
                src_port: CONSOLE_APP_PORT,
                dst_port: CONSOLE_APP_PORT,
                payload: text.clone().into_bytes(),
                response: tx,
            })
            .await
            .context("console command channel closed")?;
        rx.await
            .context("console command response dropped")?
            .map_err(anyhow::Error::from)?;
        println!("[me] {}", text);
    }

    Ok(())
}

async fn connect_cli(state: Arc<AppState>, npub: Option<String>) -> Result<()> {
    let npub = npub.unwrap_or_default().trim().to_owned();
    println!(
        "[console-client] connect request {}",
        serde_json::to_string(&json!({
            "target": if npub.is_empty() { "(first-discovered-peer)" } else { npub.as_str() },
            "mode": if npub.is_empty() { "advert-discovery" } else { "explicit-npub-direct" },
        }))
        .unwrap_or_default()
    );

    let (target_npub, discovered_advert) = if npub.is_empty() {
        let peers = state.list_advertised_peers(1).await?;
        let advert = peers
            .into_iter()
            .next()
            .context("timed out waiting for any traversal advert after 60000ms")?;
        (advert.publisher_npub.clone(), Some(advert))
    } else {
        let advert = if state.discovery_enabled {
            state.find_advertised_peer(&npub).await?
        } else {
            None
        };
        (npub.clone(), advert)
    };

    if target_npub == state.npub {
        return Err(anyhow!("refusing to connect to self"));
    }

    let decoded = nostr::nips::nip19::FromBech32::from_bech32(&target_npub)?;
    let target_pubkey = match decoded {
        nostr::nips::nip19::Nip19::Pubkey(pubkey) => pubkey,
        _ => return Err(anyhow!("target must be npub")),
    };
    let dm_relays = state
        .preferred_dm_relays(target_pubkey, discovered_advert.as_ref())
        .await?;

    let (session_id, established_remote) = match state
        .send_offer(dm_relays.clone(), target_pubkey, target_npub.clone())
        .await
    {
        Ok((offer, answer, _)) => {
            if !answer.accepted {
                return Err(anyhow!(
                    "{}",
                    answer
                        .reason
                        .clone()
                        .unwrap_or_else(|| "traversal answer rejected".to_owned())
                ));
            }
            let remotes = AppState::planned_remote_endpoints_from_offer_answer(&offer, &answer);
            let punch = answer
                .punch
                .clone()
                .map(|punch| LegacyPunch {
                    start_at_ms: punch.start_at_ms,
                    interval_ms: punch.interval_ms,
                    duration_ms: punch.duration_ms,
                })
                .unwrap_or(LegacyPunch {
                    start_at_ms: now_ms() + state.punch_start_delay_ms,
                    interval_ms: state.punch_interval_ms,
                    duration_ms: state.punch_duration_ms,
                });
            let established_remote = state
                .start_punch_plan_and_wait(offer.session_id.clone(), remotes, punch)
                .await?;
            (offer.session_id, established_remote)
        }
        Err(offer_err) => {
            println!(
                "[console-client] offer fallback {}",
                serde_json::to_string(&json!({
                    "target": target_npub,
                    "error": offer_err.to_string(),
                    "fallback": "legacy-hello",
                }))
                .unwrap_or_default()
            );
            let (reply, _) = state
                .send_hello(dm_relays, target_pubkey, target_npub.clone())
                .await?;
            let remote = reply.endpoint.clone();
            let punch = reply.punch.clone().unwrap_or(LegacyPunch {
                start_at_ms: now_ms() + state.punch_start_delay_ms,
                interval_ms: state.punch_interval_ms,
                duration_ms: state.punch_duration_ms,
            });
            let established_remote = state
                .start_punch_and_wait(reply.nonce.clone(), remote, punch)
                .await?;
            (reply.nonce, established_remote)
        }
    };

    let _ = state.udp_shutdown.send(true);
    sleep(Duration::from_millis(50)).await;
    let handoff_socket = state.take_handoff_socket().await?;
    let remote_addr = SocketAddr::new(
        established_remote
            .host
            .parse()
            .context("invalid established remote host")?,
        established_remote.port,
    );
    let runtime = handoff_established_app_runtime(
        &state.resolved_nsec,
        session_id,
        target_npub.clone(),
        handoff_socket,
        remote_addr,
        CONSOLE_APP_PORT,
    )
    .await?;

    run_console_runtime(target_npub, runtime).await
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
    if let Some(stun_servers) = parse_csv_env_list("FIPS_STUN_SERVERS") {
        args.stun_servers = stun_servers;
    }
    if args.public_host.is_none() {
        args.public_host = env::var("FIPS_UDP_PUBLIC_HOST")
            .ok()
            .filter(|v| !v.is_empty());
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
    for relay in &relay_union {
        client.add_relay(relay).await?;
    }
    client.connect().await;

    let base_udp_socket = std::net::UdpSocket::bind(("0.0.0.0", args.udp_port))?;
    base_udp_socket.set_nonblocking(true)?;
    let udp_socket = Arc::new(UdpSocket::from_std(base_udp_socket.try_clone()?)?);
    let pubkey = keys.public_key();
    let npub = pubkey.to_bech32()?;
    let (event_tx, _) = broadcast::channel(256);
    let (udp_shutdown_tx, mut udp_shutdown_rx) = watch::channel(false);
    let inbox_lookup_relays = {
        let mut set = HashSet::new();
        set.extend(args.dm_relays.iter().cloned());
        set.extend(args.advert_relays.iter().cloned());
        set.into_iter().collect::<Vec<_>>()
    };

    let state = Arc::new(AppState {
        client,
        udp_socket: udp_socket.clone(),
        keys,
        resolved_nsec: args.nsec.clone(),
        npub: npub.clone(),
        pubkey,
        advert_relays: args.advert_relays.clone(),
        dm_relays: args.dm_relays.clone(),
        inbox_lookup_relays,
        discovery_enabled: !args.no_discover,
        public_host: args.public_host.clone(),
        stun_servers: args.stun_servers.clone(),
        stun_timeout_ms: 2_000,
        stun_refresh_ms: 60_000,
        punch_interval_ms: 300,
        punch_duration_ms: 30_000,
        punch_start_delay_ms: 3_000,
        pending_stun: Mutex::new(HashMap::new()),
        stun_observation: RwLock::new(None),
        stun_observed_at: Mutex::new(None),
        advert_cache: RwLock::new(HashMap::new()),
        pending_answer: Mutex::new(HashMap::new()),
        pending_server_info: Mutex::new(HashMap::new()),
        pending_punch: Mutex::new(HashMap::new()),
        punch_hashes: Mutex::new(HashMap::new()),
        active_session: RwLock::new(None),
        handoff_fips: args.handoff_fips,
        console_runtime: Mutex::new(None),
        handoff_socket: Mutex::new(Some(base_udp_socket)),
        udp_shutdown: udp_shutdown_tx,
        events: event_tx,
    });

    let udp_state = state.clone();
    let udp_task = tokio::spawn(async move {
        let mut buf = vec![0_u8; 64 * 1024];
        loop {
            let (len, remote) = tokio::select! {
                changed = udp_shutdown_rx.changed() => {
                    match changed {
                        Ok(()) if *udp_shutdown_rx.borrow() => break,
                        Ok(()) => continue,
                        Err(_) => break,
                    }
                }
                recv = udp_state.udp_socket.recv_from(&mut buf) => recv?,
            };
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
                    let hashes = udp_state.punch_hashes.lock().await;
                    hashes.get(&punch.session_hash).cloned()
                };
                if let Some(session_id) = session_id {
                    if punch.kind == PunchPacketKind::Probe {
                        let ack = build_punch_packet(PunchPacketKind::Ack, &session_id);
                        let _ = udp_state.udp_socket.send_to(&ack, remote).await;
                    }
                    if let Some(tx) = udp_state.pending_punch.lock().await.remove(&session_id) {
                        let _ = tx.send(LegacyEndpoint {
                            host: remote.ip().to_string(),
                            port: remote.port(),
                        });
                    }
                    continue;
                }
            }
        }
        #[allow(unreachable_code)]
        Ok::<(), anyhow::Error>(())
    });

    let observation = state
        .refresh_traversal_observation(true)
        .await
        .ok()
        .flatten();
    log_traversal_observation("client", observation.as_ref());
    state.publish_inbox_relays().await.ok();

    let notify_state = state.clone();
    let notify_task = tokio::spawn(async move {
        let mut notifications = notify_state.client.notifications();
        while let Ok(notification) = notifications.recv().await {
            match notification {
                RelayPoolNotification::Event { event, .. } if event.kind == Kind::GiftWrap => {
                    if let Ok(unwrapped) = nip59::extract_rumor(&notify_state.keys, &event).await {
                        if unwrapped.rumor.kind != Kind::PrivateDirectMessage {
                            continue;
                        }
                        if let Ok(msg) =
                            serde_json::from_str::<TraversalAnswer>(&unwrapped.rumor.content)
                        {
                            if msg.message_type == "answer" {
                                if let Some(tx) = notify_state
                                    .pending_answer
                                    .lock()
                                    .await
                                    .remove(&msg.in_reply_to)
                                {
                                    let _ = tx.send(msg);
                                    continue;
                                }
                            }
                        }
                        if let Ok(msg) = serde_json::from_str::<LegacyServerInfoMessage>(
                            &unwrapped.rumor.content,
                        ) {
                            if msg.message_type == "fips.rendezvous.server-info" {
                                if let Some(tx) = notify_state
                                    .pending_server_info
                                    .lock()
                                    .await
                                    .remove(&msg.nonce)
                                {
                                    let _ = tx.send(msg);
                                }
                            }
                        }
                    }
                }
                RelayPoolNotification::Event { event, .. }
                    if event.kind == Kind::Custom(ADVERT_KIND) =>
                {
                    if let Ok(advert) = serde_json::from_str::<TraversalAdvert>(&event.content) {
                        if advert.expires_at > now_ms() {
                            let mut cache = notify_state.advert_cache.write().await;
                            let replace = cache
                                .get(&advert.publisher_npub)
                                .map(|existing| {
                                    advert.published_at > existing.published_at
                                        || (advert.published_at == existing.published_at
                                            && advert.sequence >= existing.sequence)
                                })
                                .unwrap_or(true);
                            if replace {
                                cache.insert(advert.publisher_npub.clone(), advert);
                            }
                        }
                    }
                }
                _ => {}
            }
        }
        Ok::<(), anyhow::Error>(())
    });

    println!(
        "{}",
        serde_json::to_string_pretty(&json!({
            "app": "fips-console-client-rs",
            "npub": npub,
            "udpPort": udp_socket.local_addr()?.port(),
            "advertRelays": args.advert_relays,
            "dmRelays": args.dm_relays,
            "relaySource": "embedded-defaults",
            "discoveryEnabled": !args.no_discover,
            "appPort": CONSOLE_APP_PORT,
            "target": args.npub,
        }))?
    );

    state
        .client
        .subscribe_to(
            state.dm_relays.clone(),
            Filter::new()
                .kind(Kind::GiftWrap)
                .pubkey(state.pubkey)
                .limit(0),
            None,
        )
        .await?;

    state
        .client
        .subscribe_to(
            state.advert_relays.clone(),
            Filter::new().kind(Kind::Custom(ADVERT_KIND)),
            None,
        )
        .await?;

    let result = connect_cli(state.clone(), args.npub.clone()).await;
    notify_task.abort();
    udp_task.abort();
    result
}
