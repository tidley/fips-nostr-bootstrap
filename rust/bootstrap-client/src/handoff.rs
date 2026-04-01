use serde::{Deserialize, Serialize};

use crate::schema::{Endpoint, Punch, StunInfo};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BootstrapHandoff {
    pub relay_url: String,
    pub server_npub: String,
    pub session_id: String,
    pub nonce: String,
    pub endpoint: Endpoint,
    pub punch: Option<Punch>,
    pub stun: Option<StunInfo>,
    pub received_at_ms: i64,
}
