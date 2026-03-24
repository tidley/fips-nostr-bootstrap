use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WireMeta {
    pub version: String,
    pub session_id: String,
    pub nonce: String,
    pub issued_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Wants {
    #[serde(rename = "stunInfo")]
    pub stun_info: bool,
    #[serde(rename = "fipsConnect")]
    pub fips_connect: bool,
}

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
pub struct HelloMessage {
    #[serde(rename = "type")]
    pub msg_type: String,
    pub version: String,
    #[serde(rename = "sessionId")]
    pub session_id: String,
    pub nonce: String,
    #[serde(rename = "issuedAt")]
    pub issued_at: i64,
    pub wants: Wants,
    #[serde(rename = "clientEndpoint")]
    pub client_endpoint: Endpoint,
    pub capabilities: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServerInfoMessage {
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

impl HelloMessage {
    pub fn validate(&self) -> anyhow::Result<()> {
        if self.msg_type != "fips.rendezvous.hello" {
            anyhow::bail!("invalid hello type");
        }
        if self.version != "1.0" {
            anyhow::bail!("unsupported version");
        }
        if self.session_id.is_empty() || self.nonce.is_empty() {
            anyhow::bail!("missing session_id/nonce");
        }
        Ok(())
    }
}

impl ServerInfoMessage {
    pub fn validate_for(&self, session_id: &str, nonce: &str) -> anyhow::Result<()> {
        if self.msg_type != "fips.rendezvous.server-info" {
            anyhow::bail!("invalid server-info type");
        }
        if self.version != "1.0" {
            anyhow::bail!("unsupported version");
        }
        if self.session_id != session_id || self.nonce != nonce {
            anyhow::bail!("session/nonce mismatch");
        }
        Ok(())
    }
}
