pub mod commands;
pub mod http;
pub mod pair;
pub mod store;
pub mod tls;
pub mod vibe;
pub mod ws;

use serde::{Deserialize, Serialize};

pub const DEFAULT_PORT: u16 = 25580;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Via {
    Direct,
    Vibe,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RemoteAgent {
    pub key: String,
    pub id: String,
    pub name: String,
    pub via: Via,
    #[serde(default)]
    pub address: Option<String>,
    #[serde(default)]
    pub fingerprint: Option<String>,
    #[serde(default)]
    pub version: Option<String>,
    #[serde(default)]
    pub os: Option<String>,
    #[serde(default)]
    pub arch: Option<String>,
    #[serde(default)]
    pub token_id: Option<String>,
    #[serde(default)]
    pub role: Option<String>,
    #[serde(default)]
    pub online: Option<bool>,
    #[serde(default)]
    pub last_seen: Option<i64>,
    pub added_at: i64,
}

pub fn valid_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 80 && id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

pub fn agent_key(via: Via, id: &str) -> String {
    let p = match via {
        Via::Direct => "d",
        Via::Vibe => "v",
    };
    format!("{p}-{id}")
}

pub fn secret_id(key: &str) -> String {
    format!("remote-agent:{key}")
}

pub fn device_name() -> String {
    let host = ["COMPUTERNAME", "HOSTNAME"]
        .iter()
        .find_map(|k| std::env::var(k).ok().filter(|v| !v.trim().is_empty()))
        .unwrap_or_else(|| "PC".into());
    format!("Vibe Launcher ({})", host.trim())
}

pub fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}
