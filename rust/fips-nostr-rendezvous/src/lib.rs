use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use thiserror::Error;

pub const ADVERT_KIND: u16 = 30078;
pub const TRAVERSAL_SIGNAL_KIND: u16 = 21059;
pub const INBOX_RELAYS_KIND: u16 = 10050;
pub const PUNCH_MAGIC: u32 = 0x4E505443;
pub const PUNCH_ACK_MAGIC: u32 = 0x4E505441;
pub const TRAVERSAL_SIGNAL_APP: &str = "fips.nat.traversal.v1";

pub const DEFAULT_ADVERT_RELAYS: &[&str] = &[
    "wss://offchain.pub",
    "wss://strfry.bitsbytom.com",
];

pub const DEFAULT_DM_RELAYS: &[&str] = &[
    "wss://nip17.com",
    "wss://offchain.pub",
];

pub const DEFAULT_STUN_SERVERS: &[&str] = &[
    "stun:fips.tomdwyer.uk:3478",
    "stun:stun.l.google.com:19302",
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

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PunchStrategy {
    Lan,
    Reflexive,
    Mixed,
    Local,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AddressSource {
    Local,
    Reflexive,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PlannedPunchTarget {
    pub strategy: PunchStrategy,
    pub local_source: AddressSource,
    pub remote_source: AddressSource,
    pub local: TraversalAddress,
    pub remote: TraversalAddress,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PunchWindow {
    pub start_at_ms: u64,
    pub interval_ms: u64,
    pub duration_ms: u64,
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

fn same_subnet_24(left: &TraversalAddress, right: &TraversalAddress) -> bool {
    let left_parts = left.ip.split('.').collect::<Vec<_>>();
    let right_parts = right.ip.split('.').collect::<Vec<_>>();
    left_parts.len() == 4
        && right_parts.len() == 4
        && left_parts[..3] == right_parts[..3]
}

pub fn create_traversal_offer(
    session_id: String,
    issued_at: u64,
    ttl_ms: u64,
    nonce: String,
    sender_npub: String,
    recipient_npub: String,
    reflexive_address: Option<TraversalAddress>,
    local_addresses: Vec<TraversalAddress>,
) -> TraversalOffer {
    TraversalOffer {
        app: TRAVERSAL_SIGNAL_APP.to_owned(),
        event_kind: TRAVERSAL_SIGNAL_KIND,
        message_type: "offer".to_owned(),
        session_id,
        issued_at,
        expires_at: issued_at + ttl_ms,
        nonce,
        sender_npub,
        recipient_npub,
        reflexive_address,
        local_addresses,
    }
}

pub fn create_traversal_answer(
    session_id: String,
    issued_at: u64,
    ttl_ms: u64,
    nonce: String,
    sender_npub: String,
    recipient_npub: String,
    in_reply_to: String,
    accepted: bool,
    reflexive_address: Option<TraversalAddress>,
    local_addresses: Vec<TraversalAddress>,
    punch: Option<PunchHint>,
    reason: Option<String>,
) -> TraversalAnswer {
    TraversalAnswer {
        app: TRAVERSAL_SIGNAL_APP.to_owned(),
        event_kind: TRAVERSAL_SIGNAL_KIND,
        message_type: "answer".to_owned(),
        session_id,
        issued_at,
        expires_at: issued_at + ttl_ms,
        nonce,
        sender_npub,
        recipient_npub,
        in_reply_to,
        accepted,
        reflexive_address,
        local_addresses,
        punch,
        reason,
    }
}

pub fn validate_traversal_answer_for_offer(
    offer: &TraversalOffer,
    answer: &TraversalAnswer,
    now: u64,
) -> Result<(), &'static str> {
    if offer.app != TRAVERSAL_SIGNAL_APP || answer.app != TRAVERSAL_SIGNAL_APP {
        return Err("unsupported-app");
    }
    if offer.event_kind != TRAVERSAL_SIGNAL_KIND || answer.event_kind != TRAVERSAL_SIGNAL_KIND {
        return Err("unsupported-event-kind");
    }
    if offer.message_type != "offer" || answer.message_type != "answer" {
        return Err("invalid-type");
    }
    if offer.expires_at <= now || answer.expires_at <= now {
        return Err("expired-signal");
    }
    if offer.session_id != answer.session_id || answer.in_reply_to != offer.nonce {
        return Err("session-mismatch");
    }
    if offer.sender_npub != answer.recipient_npub || offer.recipient_npub != answer.sender_npub {
        return Err("identity-mismatch");
    }
    if answer.issued_at < offer.issued_at {
        return Err("answer-precedes-offer");
    }
    if answer.accepted && answer.reflexive_address.is_none() && answer.local_addresses.is_empty() {
        return Err("missing-addresses");
    }
    if !answer.accepted && answer.reason.as_deref().unwrap_or_default().is_empty() {
        return Err("missing-rejection-reason");
    }
    Ok(())
}

pub fn plan_punch_targets(
    local_addresses: &[TraversalAddress],
    local_reflexive_address: Option<&TraversalAddress>,
    remote_addresses: &[TraversalAddress],
    remote_reflexive_address: Option<&TraversalAddress>,
) -> Vec<PlannedPunchTarget> {
    let mut planned = Vec::new();

    let mut push_unique = |target: PlannedPunchTarget| {
        if !planned.iter().any(|existing| existing == &target) {
            planned.push(target);
        }
    };

    for local in local_addresses {
        for remote in remote_addresses {
            if same_subnet_24(local, remote) {
                push_unique(PlannedPunchTarget {
                    strategy: PunchStrategy::Lan,
                    local_source: AddressSource::Local,
                    remote_source: AddressSource::Local,
                    local: local.clone(),
                    remote: remote.clone(),
                });
            }
        }
    }

    if let (Some(local), Some(remote)) = (local_reflexive_address, remote_reflexive_address) {
        push_unique(PlannedPunchTarget {
            strategy: PunchStrategy::Reflexive,
            local_source: AddressSource::Reflexive,
            remote_source: AddressSource::Reflexive,
            local: local.clone(),
            remote: remote.clone(),
        });
    }

    if let Some(remote) = remote_reflexive_address {
        for local in local_addresses {
            push_unique(PlannedPunchTarget {
                strategy: PunchStrategy::Mixed,
                local_source: AddressSource::Local,
                remote_source: AddressSource::Reflexive,
                local: local.clone(),
                remote: remote.clone(),
            });
        }
    }

    if let Some(local) = local_reflexive_address {
        for remote in remote_addresses {
            push_unique(PlannedPunchTarget {
                strategy: PunchStrategy::Mixed,
                local_source: AddressSource::Reflexive,
                remote_source: AddressSource::Local,
                local: local.clone(),
                remote: remote.clone(),
            });
        }
    }

    for local in local_addresses {
        for remote in remote_addresses {
            push_unique(PlannedPunchTarget {
                strategy: PunchStrategy::Local,
                local_source: AddressSource::Local,
                remote_source: AddressSource::Local,
                local: local.clone(),
                remote: remote.clone(),
            });
        }
    }

    planned
}

pub fn negotiate_punch_window(
    now_ms: u64,
    local_lead_ms: u64,
    remote_lead_ms: u64,
    local_interval_ms: u64,
    remote_interval_ms: u64,
    local_duration_ms: u64,
    remote_duration_ms: u64,
) -> PunchWindow {
    PunchWindow {
        start_at_ms: now_ms + local_lead_ms.max(remote_lead_ms),
        interval_ms: local_interval_ms.max(remote_interval_ms).max(20),
        duration_ms: local_duration_ms.max(remote_duration_ms).max(1),
    }
}

pub fn build_punch_attempt_schedule(window: PunchWindow, max_attempts: usize) -> Vec<u64> {
    let mut attempts = Vec::new();
    let max_attempts = max_attempts.max(1);
    let interval_ms = window.interval_ms.max(1);
    let cutoff = window.start_at_ms + window.duration_ms.max(1);
    let mut at = window.start_at_ms;

    while attempts.len() < max_attempts && (attempts.is_empty() || at < cutoff) {
        attempts.push(at);
        at += interval_ms;
    }

    attempts
}

#[cfg(test)]
mod tests {
    use super::*;

    #[derive(Clone, Copy, PartialEq, Eq)]
    enum NatType {
        RestrictedCone,
        PortRestricted,
        Symmetric,
    }

    fn attempt_direct_probe(
        local_targets: &[PlannedPunchTarget],
        remote_targets: &[PlannedPunchTarget],
        local_nat: NatType,
        remote_nat: NatType,
        max_attempts: usize,
    ) -> bool {
        let max_attempts = max_attempts.max(1);
        for _ in 0..max_attempts {
            for local in local_targets {
                for remote in remote_targets {
                    if is_pair_reachable(&local.local, &remote.remote, local_nat, remote_nat) {
                        return true;
                    }
                }
            }
        }
        false
    }

    fn is_pair_reachable(
        local: &TraversalAddress,
        remote: &TraversalAddress,
        local_nat: NatType,
        remote_nat: NatType,
    ) -> bool {
        if local.protocol != "udp" || remote.protocol != "udp" {
            return false;
        }
        if local_nat == NatType::Symmetric || remote_nat == NatType::Symmetric {
            return false;
        }
        if local_nat == NatType::PortRestricted && remote_nat == NatType::PortRestricted {
            return false;
        }
        true
    }

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

    fn address(ip: &str, port: u16) -> TraversalAddress {
        TraversalAddress {
            protocol: "udp".to_owned(),
            ip: ip.to_owned(),
            port,
        }
    }

    #[test]
    fn creates_and_validates_matching_offer_answer() {
        let offer = create_traversal_offer(
            "sess-1".to_owned(),
            1_700_000_000_000,
            60_000,
            "offer-1".to_owned(),
            "npub1client".to_owned(),
            "npub1server".to_owned(),
            Some(address("203.0.113.10", 62000)),
            vec![address("192.168.1.10", 62000)],
        );
        let answer = create_traversal_answer(
            "sess-1".to_owned(),
            1_700_000_000_500,
            60_000,
            "answer-1".to_owned(),
            "npub1server".to_owned(),
            "npub1client".to_owned(),
            "offer-1".to_owned(),
            true,
            Some(address("198.51.100.20", 63000)),
            vec![address("192.168.1.20", 63000)],
            Some(PunchHint {
                start_at_ms: 1_700_000_000_800,
                interval_ms: 300,
                duration_ms: 30_000,
            }),
            None,
        );

        assert_eq!(offer.message_type, "offer");
        assert_eq!(answer.message_type, "answer");
        assert_eq!(offer.app, TRAVERSAL_SIGNAL_APP);
        assert!(validate_traversal_answer_for_offer(&offer, &answer, 1_700_000_000_900).is_ok());
    }

    #[test]
    fn rejects_answer_without_addresses_when_accepted() {
        let offer = create_traversal_offer(
            "sess-1".to_owned(),
            1_700_000_000_000,
            60_000,
            "offer-1".to_owned(),
            "npub1client".to_owned(),
            "npub1server".to_owned(),
            Some(address("203.0.113.10", 62000)),
            vec![],
        );
        let answer = create_traversal_answer(
            "sess-1".to_owned(),
            1_700_000_000_500,
            60_000,
            "answer-1".to_owned(),
            "npub1server".to_owned(),
            "npub1client".to_owned(),
            "offer-1".to_owned(),
            true,
            None,
            vec![],
            None,
            None,
        );

        assert_eq!(
            validate_traversal_answer_for_offer(&offer, &answer, 1_700_000_000_900),
            Err("missing-addresses")
        );
    }

    #[test]
    fn plans_lan_then_reflexive_then_fallback_targets() {
        let planned = plan_punch_targets(
            &[address("192.168.1.10", 62000)],
            Some(&address("203.0.113.10", 62000)),
            &[address("192.168.1.20", 63000)],
            Some(&address("198.51.100.20", 63000)),
        );

        assert_eq!(planned[0].strategy, PunchStrategy::Lan);
        assert_eq!(planned[1].strategy, PunchStrategy::Reflexive);
        assert!(planned.iter().any(|target| target.strategy == PunchStrategy::Mixed));
        assert!(planned.iter().any(|target| target.strategy == PunchStrategy::Local));
    }

    #[test]
    fn negotiates_window_and_builds_bounded_schedule() {
        let window = negotiate_punch_window(1_700_000_000_000, 1_000, 2_000, 150, 300, 10_000, 30_000);
        assert_eq!(
            window,
            PunchWindow {
                start_at_ms: 1_700_000_002_000,
                interval_ms: 300,
                duration_ms: 30_000,
            }
        );
        let schedule = build_punch_attempt_schedule(window, 4);
        assert_eq!(schedule, vec![1_700_000_002_000, 1_700_000_002_300, 1_700_000_002_600, 1_700_000_002_900]);
    }

    #[test]
    fn simulated_lan_scenario_prefers_lan_and_establishes() {
        let offer = create_traversal_offer(
            "sess-lan".to_owned(),
            1_700_000_000_000,
            60_000,
            "offer-lan".to_owned(),
            "npub1client".to_owned(),
            "npub1server".to_owned(),
            Some(address("203.0.113.10", 62000)),
            vec![address("192.168.1.10", 62000)],
        );
        let answer = create_traversal_answer(
            "sess-lan".to_owned(),
            1_700_000_000_500,
            60_000,
            "answer-lan".to_owned(),
            "npub1server".to_owned(),
            "npub1client".to_owned(),
            "offer-lan".to_owned(),
            true,
            Some(address("198.51.100.20", 63000)),
            vec![address("192.168.1.20", 63000)],
            None,
            None,
        );
        let targets = plan_punch_targets(
            &offer.local_addresses,
            offer.reflexive_address.as_ref(),
            &answer.local_addresses,
            answer.reflexive_address.as_ref(),
        );
        let window = negotiate_punch_window(1_700_000_000_600, 1_000, 1_000, 200, 200, 10_000, 10_000);
        let schedule = build_punch_attempt_schedule(window, 4);

        assert_eq!(targets[0].strategy, PunchStrategy::Lan);
        assert!(attempt_direct_probe(&targets, &targets, NatType::RestrictedCone, NatType::RestrictedCone, schedule.len()));
    }

    #[test]
    fn simulated_symmetric_nat_scenario_requires_fallback() {
        let offer = create_traversal_offer(
            "sess-symmetric".to_owned(),
            1_700_000_000_000,
            60_000,
            "offer-symmetric".to_owned(),
            "npub1client".to_owned(),
            "npub1server".to_owned(),
            Some(address("203.0.113.10", 62000)),
            vec![address("192.168.1.10", 62000)],
        );
        let answer = create_traversal_answer(
            "sess-symmetric".to_owned(),
            1_700_000_000_500,
            60_000,
            "answer-symmetric".to_owned(),
            "npub1server".to_owned(),
            "npub1client".to_owned(),
            "offer-symmetric".to_owned(),
            true,
            Some(address("198.51.100.20", 63000)),
            vec![address("192.168.1.20", 63000)],
            None,
            None,
        );
        let targets = plan_punch_targets(
            &offer.local_addresses,
            offer.reflexive_address.as_ref(),
            &answer.local_addresses,
            answer.reflexive_address.as_ref(),
        );
        let window = negotiate_punch_window(1_700_000_000_600, 1_000, 1_000, 200, 200, 10_000, 10_000);
        let schedule = build_punch_attempt_schedule(window, 4);

        assert!(!attempt_direct_probe(&targets, &targets, NatType::Symmetric, NatType::Symmetric, schedule.len()));
    }
}
