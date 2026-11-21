mod conn;
mod dispatch;
mod pairing;

pub use pairing::{link_with_code, start_pairing, PairingCode};

use crate::jsonfile;
use crate::state::{AgentState, Ctx};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use vibe_server_core::error::AppResult;

pub const DEFAULT_API: &str = "https://vibe.axolite.app";
pub const PROTOCOL: u32 = 1;

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct GatewayFile {
    #[serde(default)]
    pub agent_token: Option<String>,
    #[serde(default)]
    pub agent_id: Option<String>,
    #[serde(default)]
    pub owner_id: Option<String>,
    #[serde(default)]
    pub owner_name: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize)]
pub struct GatewayStatus {
    pub connected: bool,
    pub linked: bool,
    pub agent_id: Option<String>,
    pub owner: Option<Value>,
    pub last_error: Option<String>,
    pub pairing: Option<PairingCode>,
}

pub fn api_base(ctx: &AgentState) -> String {
    let c = ctx.cfg.read();
    c.api_url.clone().filter(|u| !u.trim().is_empty()).unwrap_or_else(|| DEFAULT_API.to_string()).trim_end_matches('/').to_string()
}

pub fn ws_url(ctx: &AgentState) -> String {
    if let Some(u) = ctx.cfg.read().gateway_url.clone().filter(|u| !u.trim().is_empty()) {
        return u;
    }
    let base = api_base(ctx);
    let ws = base.replacen("https://", "wss://", 1).replacen("http://", "ws://", 1);
    format!("{ws}/agent/ws")
}

pub fn load(ctx: &AgentState) -> GatewayFile {
    jsonfile::read(&ctx.dirs.gateway_file())
}

pub fn save(ctx: &AgentState, f: &GatewayFile) -> AppResult<()> {
    jsonfile::write(&ctx.dirs.gateway_file(), f)
}

pub fn refresh_status(ctx: &AgentState) {
    let f = load(ctx);
    let mut s = ctx.gateway.write();
    s.linked = f.agent_token.is_some();
    s.agent_id = f.agent_id.clone();
    s.owner = f.owner_id.map(|id| json!({ "id": id, "name": f.owner_name }));
    if !s.linked {
        s.connected = false;
    }
}

pub fn status_json(ctx: &AgentState) -> Value {
    refresh_status(ctx);
    let s = ctx.gateway.read().clone();
    let enabled = ctx.cfg.read().gateway_enabled;
    json!({
        "enabled": enabled,
        "connected": s.connected,
        "linked": s.linked,
        "agent_id": s.agent_id,
        "vibe_user": s.owner,
        "last_error": s.last_error,
        "pairing": s.pairing,
    })
}

pub fn kick(ctx: &AgentState) {
    ctx.gw_notify.notify_waiters();
}

pub fn unlink(ctx: &AgentState) -> AppResult<()> {
    save(ctx, &GatewayFile::default())?;
    refresh_status(ctx);
    kick(ctx);
    Ok(())
}

pub fn spawn(ctx: Ctx, router: axum::Router) {
    refresh_status(&ctx);
    tokio::spawn(conn::run(ctx, router));
}
