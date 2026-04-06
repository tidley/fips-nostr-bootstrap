use anyhow::Result;
use fips::{AppCommand, AppDatagram, Config, EstablishedTraversal, Node};
use serde::Serialize;
use std::net::{SocketAddr, UdpSocket};
use tokio::sync::{mpsc, oneshot};

#[derive(Debug, Clone, Serialize)]
pub struct FipsHandoffStatus {
    #[serde(rename = "nodeNpub")]
    pub node_npub: String,
    #[serde(rename = "peerNpub")]
    pub peer_npub: String,
    #[serde(rename = "sessionId")]
    pub session_id: String,
    #[serde(rename = "transportId")]
    pub transport_id: u32,
    #[serde(rename = "localAddr")]
    pub local_addr: String,
    #[serde(rename = "remoteAddr")]
    pub remote_addr: String,
}

pub struct FipsAppRuntime {
    status: FipsHandoffStatus,
    command_tx: mpsc::Sender<AppCommand>,
    app_rx: std::sync::mpsc::Receiver<AppDatagram>,
}

impl FipsAppRuntime {
    pub fn status(&self) -> &FipsHandoffStatus {
        &self.status
    }

    pub fn into_parts(
        self,
    ) -> (
        FipsHandoffStatus,
        mpsc::Sender<AppCommand>,
        std::sync::mpsc::Receiver<AppDatagram>,
    ) {
        (self.status, self.command_tx, self.app_rx)
    }

    pub async fn send_datagram(
        &self,
        peer_npub: &str,
        src_port: u16,
        dst_port: u16,
        payload: Vec<u8>,
    ) -> Result<()> {
        let (tx, rx) = oneshot::channel();
        self.command_tx
            .send(AppCommand::SendDatagram {
                peer_npub: peer_npub.to_owned(),
                src_port,
                dst_port,
                payload,
                response: tx,
            })
            .await?;
        rx.await??;
        Ok(())
    }
}

pub async fn handoff_established_traversal(
    nsec: &str,
    session_id: String,
    peer_npub: String,
    socket: UdpSocket,
    remote_addr: SocketAddr,
) -> Result<FipsHandoffStatus> {
    let mut config = Config::new();
    config.node.identity.nsec = Some(nsec.to_owned());
    config.node.identity.persistent = false;
    config.node.control.enabled = false;
    config.tun.enabled = false;
    config.dns.enabled = false;

    let mut node = Node::new(config)?;
    let node_npub = node.npub();
    node.start().await?;

    let result = node
        .adopt_established_traversal(
            EstablishedTraversal::new(session_id.clone(), peer_npub.clone(), remote_addr, socket)
                .with_transport_name("nostr-punched"),
        )
        .await?;

    tokio::spawn(async move {
        let mut node = node;
        let run_result = node.run_rx_loop().await;
        if let Err(err) = run_result {
            eprintln!("[fips-handoff] rx-loop-error {err}");
        }
        let _ = node.stop().await;
    });

    Ok(FipsHandoffStatus {
        node_npub,
        peer_npub,
        session_id,
        transport_id: result.transport_id.as_u32(),
        local_addr: result.local_addr.to_string(),
        remote_addr: result.remote_addr.to_string(),
    })
}

pub async fn handoff_established_app_runtime(
    nsec: &str,
    session_id: String,
    peer_npub: String,
    socket: UdpSocket,
    remote_addr: SocketAddr,
    app_port: u16,
) -> Result<FipsAppRuntime> {
    let mut config = Config::new();
    config.node.identity.nsec = Some(nsec.to_owned());
    config.node.identity.persistent = false;
    config.node.control.enabled = false;
    config.tun.enabled = false;
    config.dns.enabled = false;

    let mut node = Node::new(config)?;
    let node_npub = node.npub();
    node.start().await?;
    let app_rx = node.bind_app_port(app_port)?;

    let result = node
        .adopt_established_traversal(
            EstablishedTraversal::new(session_id.clone(), peer_npub.clone(), remote_addr, socket)
                .with_transport_name("nostr-punched"),
        )
        .await?;

    let (command_tx, command_rx) = mpsc::channel(64);
    tokio::spawn(async move {
        let mut node = node;
        let run_result = node.run_rx_loop_with_app_commands(command_rx).await;
        if let Err(err) = run_result {
            eprintln!("[fips-handoff] rx-loop-error {err}");
        }
        let _ = node.stop().await;
    });

    Ok(FipsAppRuntime {
        status: FipsHandoffStatus {
            node_npub,
            peer_npub,
            session_id,
            transport_id: result.transport_id.as_u32(),
            local_addr: result.local_addr.to_string(),
            remote_addr: result.remote_addr.to_string(),
        },
        command_tx,
        app_rx,
    })
}
