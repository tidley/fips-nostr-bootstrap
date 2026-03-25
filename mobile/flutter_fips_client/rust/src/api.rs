use std::time::{Duration, SystemTime, UNIX_EPOCH};

use anyhow::Context;
use flutter_rust_bridge::frb;
use futures_util::{SinkExt, StreamExt};
use nostr::nips::nip19::ToBech32;
use nostr::nips::nip59;
use nostr::{
    ClientMessage, Event, EventBuilder, Filter, JsonUtil, Keys, Kind, PublicKey, RelayMessage,
    SubscriptionId, Tag, Timestamp,
};
use rand::{distributions::Alphanumeric, Rng};
use serde::{Deserialize, Serialize};
use serde_json::json;
use tokio::net::UdpSocket;
use tokio::time::{Instant, timeout};
use tokio_tungstenite::{connect_async, tungstenite::Message};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Endpoint {
    pub host: String,
    pub port: u16,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Punch {
    #[serde(rename = "startAtMs")]
    pub start_at_ms: i64,
    #[serde(rename = "intervalMs")]
    pub interval_ms: u64,
    #[serde(rename = "durationMs")]
    pub duration_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StunInfo {
    pub uri: String,
    #[serde(rename = "metadataTag")]
    pub metadata_tag: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServerInfo {
    #[serde(rename = "type")]
    pub msg_type: String,
    pub version: String,
    #[serde(rename = "sessionId")]
    pub session_id: String,
    pub nonce: String,
    #[serde(rename = "issuedAt")]
    pub issued_at: i64,
    pub endpoint: Endpoint,
    pub punch: Option<Punch>,
    pub stun: Option<StunInfo>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BootstrapResult {
    #[serde(rename = "bootstrapRttMs")]
    pub bootstrap_rtt_ms: i64,
    pub relay_url: String,
    pub server_npub: String,
    pub client_npub: String,
    pub server_info: ServerInfo,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EchoResult {
    #[serde(rename = "echoRoundtripOk")]
    pub echo_roundtrip_ok: bool,
    #[serde(rename = "echoRttMs")]
    pub echo_rtt_ms: Option<i64>,
    pub endpoint: Endpoint,
    pub detail: String,
}

#[frb(sync)]
pub fn ping() -> String {
    "pong".to_string()
}

#[frb]
pub async fn bootstrap(
    relay_url: String,
    server_npub: String,
    timeout_ms: i64,
    connect_mode: bool,
) -> Result<BootstrapResult, String> {
    run_bootstrap(relay_url, server_npub, timeout_ms, connect_mode)
        .await
        .map_err(|e| format!("{e:#}"))
}

#[frb]
pub async fn echo_test(
    relay_url: String,
    server_npub: String,
    timeout_ms: i64,
) -> Result<EchoResult, String> {
    run_echo(relay_url, server_npub, timeout_ms)
        .await
        .map_err(|e| format!("{e:#}"))
}

async fn run_echo(relay_url: String, server_npub: String, timeout_ms: i64) -> anyhow::Result<EchoResult> {
    let boot = run_bootstrap(relay_url, server_npub, timeout_ms, true).await?;
    let endpoint = boot.server_info.endpoint.clone();
    let punch = boot
        .server_info
        .punch
        .clone()
        .context("echo test requires punch config")?;

    let udp = UdpSocket::bind("0.0.0.0:0").await?;
    let wait_ms = (punch.start_at_ms - now_ms()).max(0) as u64;
    tokio::time::sleep(Duration::from_millis(wait_ms)).await;

    let mut seq = 0u64;
    let start = Instant::now();
    let interval = Duration::from_millis(punch.interval_ms.max(25));
    while start.elapsed() < Duration::from_millis(punch.duration_ms) {
        let probe = json!({ "t": "PROBE", "n": boot.server_info.nonce, "s": seq });
        seq += 1;
        udp.send_to(
            &serde_json::to_vec(&probe)?,
            format!("{}:{}", endpoint.host, endpoint.port),
        )
        .await?;

        let mut buf = [0u8; 4096];
        if let Ok(Ok((n, _))) = timeout(interval, udp.recv_from(&mut buf)).await {
            let v: serde_json::Value = serde_json::from_slice(&buf[..n]).unwrap_or(json!({}));
            if v.get("t") == Some(&json!("PROBE_ACK")) {
                break;
            }
        }
    }

    let msg = json!({"channel":"fips_ping","body":"hello-from-mobile","nonce":boot.server_info.nonce});
    let framed = [b"FIPS1".as_slice(), &serde_json::to_vec(&msg)?].concat();
    let t0 = Instant::now();
    udp.send_to(&framed, format!("{}:{}", endpoint.host, endpoint.port)).await?;

    let mut buf = [0u8; 8192];
    let deadline = Instant::now() + Duration::from_millis(timeout_ms as u64);
    let mut ok = false;
    let mut detail = "timeout waiting for fips_pong".to_string();

    while Instant::now() < deadline {
        let left = deadline.saturating_duration_since(Instant::now());
        let recv = timeout(left.min(Duration::from_millis(500)), udp.recv_from(&mut buf)).await;
        let (n, _) = match recv {
            Ok(Ok(v)) => v,
            Ok(Err(e)) => return Err(e.into()),
            Err(_) => continue,
        };

        let payload = &buf[..n];
        if !payload.starts_with(b"FIPS1") {
            detail = "received non-FIPS1 packet while waiting for pong".to_string();
            continue;
        }

        let parsed = serde_json::from_slice::<serde_json::Value>(&payload[5..]).ok();
        let ch = parsed.as_ref().and_then(|v| v.get("channel")).and_then(|v| v.as_str());
        if matches!(ch, Some("fips_pong") | Some("fips_status")) {
            ok = true;
            detail = format!("received FIPS1 {}", ch.unwrap_or("unknown"));
            break;
        }
        detail = format!("received FIPS1 frame with unexpected channel: {:?}", ch);
    }

    Ok(EchoResult {
        echo_roundtrip_ok: ok,
        echo_rtt_ms: Some(t0.elapsed().as_millis() as i64),
        endpoint,
        detail,
    })
}

async fn run_bootstrap(
    relay_url: String,
    server_npub: String,
    timeout_ms: i64,
    connect_mode: bool,
) -> anyhow::Result<BootstrapResult> {
    let _ = rustls::crypto::ring::default_provider().install_default();
    let keys = Keys::generate();
    let server_pubkey = PublicKey::parse(&server_npub).context("invalid server npub")?;

    let udp = UdpSocket::bind("0.0.0.0:0").await?;
    let local_port = udp.local_addr()?.port();

    let session_id = random_token("mobile");
    let nonce = random_token("n");

    let hello = json!({
        "type": "fips.rendezvous.hello",
        "version": "1.0",
        "sessionId": session_id,
        "nonce": nonce,
        "issuedAt": now_ms(),
        "wants": {"stunInfo": true, "fipsConnect": connect_mode},
        "clientEndpoint": {"host": "0.0.0.0", "port": local_port},
        "capabilities": ["flutter-rust-mobile-v1"]
    });

    let gift_wrap: Event = EventBuilder::private_msg(
        &keys,
        server_pubkey,
        serde_json::to_string(&hello)?,
        [Tag::public_key(server_pubkey)],
    )
    .await
    .context("failed to gift-wrap hello")?;

    let ws_t0 = Instant::now();
    let (mut ws, _) = connect_async(&relay_url).await.context("websocket connect failed")?;
    let bootstrap_rtt_ms = ws_t0.elapsed().as_millis() as i64;

    let sub_id = SubscriptionId::new(random_token("sub"));
    let since = Timestamp::from(Timestamp::now().as_u64().saturating_sub(120));
    let filter = Filter::new().kind(Kind::GiftWrap).since(since);
    ws.send(Message::Text(ClientMessage::req(sub_id.clone(), filter).as_json().into()))
        .await?;
    ws.send(Message::Text(ClientMessage::event(gift_wrap.clone()).as_json().into()))
        .await?;

    let mut info: Option<ServerInfo> = None;
    let deadline = Duration::from_millis(timeout_ms as u64);

    timeout(deadline, async {
        while let Some(frame) = ws.next().await {
            let frame = frame?;
            if !frame.is_text() {
                continue;
            }
            let text = frame.into_text()?;
            let relay_msg = match RelayMessage::from_json(&text) {
                Ok(m) => m,
                Err(_) => continue,
            };
            match relay_msg {
                RelayMessage::Ok { event_id, status, message } => {
                    if event_id == gift_wrap.id && !status {
                        anyhow::bail!("relay rejected hello event: {message}");
                    }
                }
                RelayMessage::Event { event, .. } => {
                    let unwrapped = match nip59::extract_rumor(&keys, &event).await {
                        Ok(v) => v,
                        Err(_) => continue,
                    };
                    let parsed = match serde_json::from_str::<ServerInfo>(&unwrapped.rumor.content) {
                        Ok(v) => v,
                        Err(_) => continue,
                    };
                    if parsed.msg_type == "fips.rendezvous.server-info"
                        && parsed.session_id == hello["sessionId"]
                        && parsed.nonce == hello["nonce"]
                    {
                        info = Some(parsed);
                        break;
                    }
                }
                _ => {}
            }
        }
        anyhow::Ok(())
    })
    .await
    .context("timed out waiting for server-info")??;

    let server_info = info.context("server-info not received")?;
    let _ = ws
        .send(Message::Text(ClientMessage::close(sub_id).as_json().into()))
        .await;

    Ok(BootstrapResult {
        bootstrap_rtt_ms,
        relay_url,
        server_npub,
        client_npub: keys.public_key().to_bech32()?,
        server_info,
    })
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn random_token(prefix: &str) -> String {
    let suffix: String = rand::thread_rng()
        .sample_iter(&Alphanumeric)
        .take(12)
        .map(char::from)
        .collect();
    format!("{prefix}-{suffix}")
}
