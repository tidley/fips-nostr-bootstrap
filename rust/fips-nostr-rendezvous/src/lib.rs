use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use thiserror::Error;

pub const ADVERT_KIND: u16 = 30078;
pub const TRAVERSAL_SIGNAL_KIND: u16 = 21059;
pub const INBOX_RELAYS_KIND: u16 = 10050;
pub const PUNCH_MAGIC: u32 = 0x4E505443;
pub const PUNCH_ACK_MAGIC: u32 = 0x4E505441;

pub const DEFAULT_ADVERT_RELAYS: &[&str] = &[
    "wss://offchain.pub",
    "wss://www.nostr.ltd",
    "wss://relay.nostr.band",
];

pub const DEFAULT_DM_RELAYS: &[&str] = &[
    "wss://nip17.com",
    "wss://nip17.tomdwyer.uk",
    "wss://relay.nostr.band",
    "wss://offchain.pub",
    "wss://www.nostr.ltd",
];

pub const DEFAULT_STUN_SERVERS: &[&str] = &[
    "stun:fips.tomdwyer.uk:3478",
    "stun:45.77.228.152:3478",
    "stun:stun.l.google.com:19302",
    "stun:stun1.l.google.com:19302",
    "stun:stun.cloudflare.com:3478",
];

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TraversalAddress {
    pub protocol: String,
    pub ip: String,
    pub port: u16,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PunchHint {
    #[serde(rename = "startAtMs")]
    pub start_at_ms: u64,
    #[serde(rename = "intervalMs")]
    pub interval_ms: u64,
    #[serde(rename = "durationMs")]
    pub duration_ms: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TraversalAdvert {
    pub app: String,
    #[serde(rename = "eventKind")]
    pub event_kind: u16,
    pub protocol: String,
    #[serde(rename = "publisherNpub")]
    pub publisher_npub: String,
    #[serde(rename = "publishedAt")]
    pub published_at: u64,
    #[serde(rename = "expiresAt")]
    pub expires_at: u64,
    pub sequence: u64,
    pub relays: Vec<String>,
    #[serde(rename = "stunServers")]
    pub stun_servers: Vec<String>,
    pub transports: Vec<String>,
    #[serde(rename = "endpointHint")]
    pub endpoint_hint: Option<EndpointHint>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct EndpointHint {
    pub host: String,
    pub port: u16,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TraversalOffer {
    pub app: String,
    #[serde(rename = "eventKind")]
    pub event_kind: u16,
    #[serde(rename = "type")]
    pub message_type: String,
    #[serde(rename = "sessionId")]
    pub session_id: String,
    #[serde(rename = "issuedAt")]
    pub issued_at: u64,
    #[serde(rename = "expiresAt")]
    pub expires_at: u64,
    pub nonce: String,
    #[serde(rename = "senderNpub")]
    pub sender_npub: String,
    #[serde(rename = "recipientNpub")]
    pub recipient_npub: String,
    #[serde(rename = "reflexiveAddress")]
    pub reflexive_address: Option<TraversalAddress>,
    #[serde(rename = "localAddresses")]
    pub local_addresses: Vec<TraversalAddress>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TraversalAnswer {
    pub app: String,
    #[serde(rename = "eventKind")]
    pub event_kind: u16,
    #[serde(rename = "type")]
    pub message_type: String,
    #[serde(rename = "sessionId")]
    pub session_id: String,
    #[serde(rename = "issuedAt")]
    pub issued_at: u64,
    #[serde(rename = "expiresAt")]
    pub expires_at: u64,
    pub nonce: String,
    #[serde(rename = "senderNpub")]
    pub sender_npub: String,
    #[serde(rename = "recipientNpub")]
    pub recipient_npub: String,
    #[serde(rename = "inReplyTo")]
    pub in_reply_to: String,
    pub accepted: bool,
    #[serde(rename = "reflexiveAddress")]
    pub reflexive_address: Option<TraversalAddress>,
    #[serde(rename = "localAddresses")]
    pub local_addresses: Vec<TraversalAddress>,
    pub punch: Option<PunchHint>,
    pub reason: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct InboxRelays {
    pub relays: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct LegacyWants {
    #[serde(rename = "stunInfo")]
    pub stun_info: bool,
    #[serde(rename = "fipsConnect")]
    pub fips_connect: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct LegacyEndpoint {
    pub host: String,
    pub port: u16,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct LegacyPunch {
    #[serde(rename = "startAtMs")]
    pub start_at_ms: u64,
    #[serde(rename = "intervalMs")]
    pub interval_ms: u64,
    #[serde(rename = "durationMs")]
    pub duration_ms: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct LegacyStunInfo {
    pub uri: String,
    #[serde(rename = "metadataTag")]
    pub metadata_tag: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct LegacyHelloMessage {
    #[serde(rename = "type")]
    pub message_type: String,
    pub version: String,
    #[serde(rename = "sessionId")]
    pub session_id: String,
    pub nonce: String,
    #[serde(rename = "issuedAt")]
    pub issued_at: u64,
    pub wants: LegacyWants,
    #[serde(rename = "clientEndpoint")]
    pub client_endpoint: Option<LegacyEndpoint>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct LegacyServerInfoMessage {
    #[serde(rename = "type")]
    pub message_type: String,
    pub version: String,
    #[serde(rename = "sessionId")]
    pub session_id: String,
    pub nonce: String,
    #[serde(rename = "issuedAt")]
    pub issued_at: u64,
    pub endpoint: LegacyEndpoint,
    pub punch: Option<LegacyPunch>,
    pub stun: Option<LegacyStunInfo>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SessionFrame {
    #[serde(rename = "sessionId")]
    pub session_id: String,
    #[serde(rename = "type")]
    pub frame_type: String,
    pub channel: Option<String>,
    pub payload: Value,
    pub at: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StunEndpoint {
    pub host: String,
    pub port: u16,
}

#[derive(Debug, Error, PartialEq, Eq)]
pub enum RendezvousError {
    #[error("invalid STUN url: {0}")]
    InvalidStunUrl(String),
    #[error("invalid punch packet length")]
    InvalidPunchPacketLength,
    #[error("invalid punch packet magic")]
    InvalidPunchPacketMagic,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PunchPacketKind {
    Probe,
    Ack,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PunchPacket {
    pub kind: PunchPacketKind,
    pub session_hash: [u8; 16],
}

pub fn parse_stun_url(input: &str) -> Result<StunEndpoint, RendezvousError> {
    let raw = input.strip_prefix("stun:").unwrap_or(input);
    let Some((host, port)) = raw.rsplit_once(':') else {
        return Err(RendezvousError::InvalidStunUrl(input.to_owned()));
    };
    let port = port
        .parse::<u16>()
        .map_err(|_| RendezvousError::InvalidStunUrl(input.to_owned()))?;
    if host.is_empty() {
        return Err(RendezvousError::InvalidStunUrl(input.to_owned()));
    }
    Ok(StunEndpoint {
        host: host.to_owned(),
        port,
    })
}

pub fn session_hash(session_id: &str) -> [u8; 16] {
    let digest = Sha256::digest(session_id.as_bytes());
    let mut output = [0_u8; 16];
    output.copy_from_slice(&digest[..16]);
    output
}

pub fn build_punch_packet(kind: PunchPacketKind, session_id: &str) -> [u8; 20] {
    let magic = match kind {
        PunchPacketKind::Probe => PUNCH_MAGIC,
        PunchPacketKind::Ack => PUNCH_ACK_MAGIC,
    };
    let mut packet = [0_u8; 20];
    packet[..4].copy_from_slice(&magic.to_be_bytes());
    packet[4..].copy_from_slice(&session_hash(session_id));
    packet
}

pub fn parse_punch_packet(bytes: &[u8]) -> Result<PunchPacket, RendezvousError> {
    if bytes.len() < 20 {
        return Err(RendezvousError::InvalidPunchPacketLength);
    }
    let magic = u32::from_be_bytes(bytes[..4].try_into().expect("fixed slice length"));
    let kind = match magic {
        PUNCH_MAGIC => PunchPacketKind::Probe,
        PUNCH_ACK_MAGIC => PunchPacketKind::Ack,
        _ => return Err(RendezvousError::InvalidPunchPacketMagic),
    };
    let mut session_hash = [0_u8; 16];
    session_hash.copy_from_slice(&bytes[4..20]);
    Ok(PunchPacket { kind, session_hash })
}

pub fn encode_session_frame(frame: &SessionFrame) -> Result<Vec<u8>, serde_json::Error> {
    let mut bytes = b"FIPS1".to_vec();
    bytes.extend_from_slice(&serde_json::to_vec(frame)?);
    Ok(bytes)
}

pub fn decode_session_frame(bytes: &[u8]) -> Result<SessionFrame, RendezvousError> {
    if bytes.len() < 5 {
        return Err(RendezvousError::InvalidPunchPacketLength);
    }
    if &bytes[..5] != b"FIPS1" {
        return Err(RendezvousError::InvalidPunchPacketMagic);
    }
    serde_json::from_slice(&bytes[5..]).map_err(|_| RendezvousError::InvalidPunchPacketMagic)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_stun_urls() {
        let parsed = parse_stun_url("stun:fips.tomdwyer.uk:3478").unwrap();
        assert_eq!(parsed.host, "fips.tomdwyer.uk");
        assert_eq!(parsed.port, 3478);
    }

    #[test]
    fn rejects_bad_stun_urls() {
        assert_eq!(
            parse_stun_url("stun:bad"),
            Err(RendezvousError::InvalidStunUrl("stun:bad".to_owned()))
        );
    }

    #[test]
    fn builds_and_parses_probe_packets() {
        let packet = build_punch_packet(PunchPacketKind::Probe, "sess-1");
        let parsed = parse_punch_packet(&packet).unwrap();
        assert_eq!(parsed.kind, PunchPacketKind::Probe);
        assert_eq!(parsed.session_hash, session_hash("sess-1"));
    }

    #[test]
    fn builds_and_parses_ack_packets() {
        let packet = build_punch_packet(PunchPacketKind::Ack, "sess-1");
        let parsed = parse_punch_packet(&packet).unwrap();
        assert_eq!(parsed.kind, PunchPacketKind::Ack);
        assert_eq!(parsed.session_hash, session_hash("sess-1"));
    }

    #[test]
    fn serializes_advert_schema() {
        let advert = TraversalAdvert {
            app: "fips.nat.traversal.v1".to_owned(),
            event_kind: ADVERT_KIND,
            protocol: "fips.nat.traversal.v1".to_owned(),
            publisher_npub: "npub1server".to_owned(),
            published_at: 1,
            expires_at: 2,
            sequence: 1,
            relays: DEFAULT_DM_RELAYS.iter().map(|relay| relay.to_string()).collect(),
            stun_servers: DEFAULT_STUN_SERVERS.iter().map(|server| server.to_string()).collect(),
            transports: vec!["udp".to_owned()],
            endpoint_hint: Some(EndpointHint {
                host: "203.0.113.10".to_owned(),
                port: 9999,
            }),
        };

        let json = serde_json::to_string(&advert).unwrap();
        assert!(json.contains("\"eventKind\":30078"));
        assert!(json.contains("\"stunServers\""));
    }

    #[test]
    fn encodes_and_decodes_session_frames() {
        let frame = SessionFrame {
            session_id: "sess-1".to_owned(),
            frame_type: "data".to_owned(),
            channel: Some("shell".to_owned()),
            payload: serde_json::json!({"cmd": "pwd"}),
            at: 42,
        };
        let encoded = encode_session_frame(&frame).unwrap();
        let decoded = decode_session_frame(&encoded).unwrap();
        assert_eq!(decoded.session_id, "sess-1");
        assert_eq!(decoded.channel.as_deref(), Some("shell"));
        assert_eq!(decoded.payload["cmd"], "pwd");
    }
}
