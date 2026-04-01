mod handoff;
mod schema;

use std::time::{Duration, SystemTime, UNIX_EPOCH};

use anyhow::Context;
use clap::Parser;
use futures_util::{SinkExt, StreamExt};
use nostr::nips::nip19::ToBech32;
use nostr::nips::nip59;
use nostr::{
    ClientMessage, Event, EventBuilder, Filter, JsonUtil, Keys, Kind, PublicKey, RelayMessage,
    SubscriptionId, Tag, Timestamp,
};
use rand::{distributions::Alphanumeric, Rng};
use serde_json::json;
use tokio::net::UdpSocket;
use tokio::time::{Instant, timeout};
use tokio_tungstenite::{connect_async, tungstenite::Message};

use handoff::BootstrapHandoff;
use schema::{Endpoint, HelloMessage, ServerInfoMessage, Wants};

#[derive(Debug, Parser)]
#[command(name = "fips-bootstrap-client", about = "Rust Nostr->STUN/FIPS bootstrap client")]
struct Args {
    #[arg(long, default_value = "wss://fips.tomdwyer.uk")]
    relay: String,

    #[arg(long)]
    server_npub: String,

    #[arg(long)]
    nsec: Option<String>,

    #[arg(long, default_value_t = true)]
    want_stun: bool,

    #[arg(long, default_value_t = true)]
    want_fips: bool,

    #[arg(long, default_value = "bootstrap")]
    mode: String,

    #[arg(long, default_value_t = 30000)]
    timeout_ms: u64,

    #[arg(long)]
    out_handoff: Option<String>,
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

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let args = Args::parse();

    if args.mode != "bootstrap" && args.mode != "connect" {
        anyhow::bail!("--mode must be bootstrap or connect");
    }

    let keys = match args.nsec.as_deref() {
        Some(nsec) => Keys::parse(nsec).context("invalid --nsec")?,
        None => Keys::generate(),
    };
    let client_npub = keys.public_key().to_bech32()?;
    let client_nsec = keys.secret_key().to_bech32()?;

    let server_pubkey = PublicKey::parse(&args.server_npub).context("invalid --server-npub")?;

    let udp_socket = UdpSocket::bind("0.0.0.0:0").await?;
    let local_port = udp_socket.local_addr()?.port();

    let session_id = random_token("combo");
    let nonce = random_token("n");

    let hello = HelloMessage {
        msg_type: "fips.rendezvous.hello".to_string(),
        version: "1.0".to_string(),
        session_id: session_id.clone(),
        nonce: nonce.clone(),
        issued_at: now_ms(),
        wants: Wants {
            stun_info: args.want_stun,
            fips_connect: args.want_fips || args.mode == "connect",
        },
        client_endpoint: Endpoint {
            host: "0.0.0.0".to_string(),
            port: local_port,
        },
        capabilities: vec!["rust-bootstrap-client-v1".to_string()],
    };
    hello.validate()?;

    println!(
        "{}",
        serde_json::to_string_pretty(&json!({
            "app": "fips-bootstrap-client-rs",
            "relay": args.relay,
            "mode": args.mode,
            "client": {
                "npub": client_npub,
                "ephemeral": args.nsec.is_none(),
                "nsec": client_nsec,
            },
            "target": { "npub": args.server_npub },
            "request": hello,
        }))?
    );

    let gift_wrap: Event = EventBuilder::private_msg(
        &keys,
        server_pubkey,
        serde_json::to_string(&hello)?,
        [Tag::public_key(server_pubkey)],
    )
    .await
    .context("failed to gift-wrap hello")?;

    let (mut ws, _) = connect_async(&args.relay).await.context("websocket connect failed")?;

    let sub_id = SubscriptionId::new(random_token("sub"));
    let since = Timestamp::from(Timestamp::now().as_u64().saturating_sub(120));
    let filter = Filter::new().kind(Kind::GiftWrap).since(since);

    ws.send(Message::Text(ClientMessage::req(sub_id.clone(), filter).as_json().into()))
        .await?;
    ws.send(Message::Text(ClientMessage::event(gift_wrap.clone()).as_json().into()))
        .await?;

    let mut server_info: Option<ServerInfoMessage> = None;
    let deadline = Duration::from_millis(args.timeout_ms);

    let wait_fut = async {
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

                    let parsed: ServerInfoMessage = match serde_json::from_str(&unwrapped.rumor.content)
                    {
                        Ok(v) => v,
                        Err(_) => continue,
                    };

                    if parsed.validate_for(&session_id, &nonce).is_ok() {
                        server_info = Some(parsed);
                        break;
                    }
                }
                _ => {}
            }
        }
        anyhow::Ok(())
    };

    timeout(deadline, wait_fut)
        .await
        .context("timed out waiting for server-info")??;

    let info = server_info.context("server-info not received")?;

    println!(
        "{}",
        serde_json::to_string_pretty(&json!({
            "ok": true,
            "response": info,
        }))?
    );

    let mut handoff = BootstrapHandoff {
        relay_url: args.relay.clone(),
        server_npub: args.server_npub.clone(),
        session_id: info.session_id.clone(),
        nonce: info.nonce.clone(),
        endpoint: info.endpoint.clone(),
        punch: info.punch.clone(),
        stun: info.stun.clone(),
        received_at_ms: now_ms(),
    };

    if args.mode == "connect" {
        let punch = info
            .punch
            .clone()
            .context("connect mode requires punch block in server-info")?;

        let wait_ms = (punch.start_at_ms - now_ms()).max(0) as u64;
        tokio::time::sleep(Duration::from_millis(wait_ms)).await;

        let start = Instant::now();
        let timeout_dur = Duration::from_millis(punch.duration_ms);
        let interval_dur = Duration::from_millis(punch.interval_ms.max(20));
        let mut seq = 0u64;
        let mut probe_acked = false;

        while start.elapsed() < timeout_dur {
            let probe = json!({ "t": "PROBE", "n": info.nonce, "s": seq });
            seq += 1;
            let payload = serde_json::to_vec(&probe)?;
            udp_socket
                .send_to(&payload, format!("{}:{}", info.endpoint.host, info.endpoint.port))
                .await?;

            let mut buf = [0u8; 2048];
            if let Ok(Ok((n, _addr))) = timeout(interval_dur, udp_socket.recv_from(&mut buf)).await {
                if let Ok(v) = serde_json::from_slice::<serde_json::Value>(&buf[..n]) {
                    if v.get("t") == Some(&json!("PROBE_ACK")) && v.get("n") == Some(&json!(info.nonce)) {
                        probe_acked = true;
                        break;
                    }
                }
            }
        }

        println!(
            "{}",
            serde_json::to_string_pretty(&json!({
                "connect": {
                    "attempted": true,
                    "endpoint": info.endpoint,
                    "punch": punch,
                    "probeAckReceived": probe_acked,
                }
            }))?
        );

        if !probe_acked {
            anyhow::bail!("connect mode: no PROBE_ACK received within punch window");
        }
    }

    if let Some(path) = args.out_handoff {
        let content = serde_json::to_string_pretty(&handoff)?;
        std::fs::write(&path, content).with_context(|| format!("failed writing handoff to {path}"))?;
        eprintln!("[fips-bootstrap-client-rs] wrote handoff to {path}");
    }

    // Try close subscription cleanly.
    let _ = ws
        .send(Message::Text(ClientMessage::close(sub_id).as_json().into()))
        .await;

    // Prevent unused mutation warnings for future handoff enrichment.
    handoff.received_at_ms = handoff.received_at_ms.max(0);

    Ok(())
}
