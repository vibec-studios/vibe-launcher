use crate::config::AgentConfig;
use futures::future::BoxFuture;
use parking_lot::{Mutex, RwLock};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::{mpsc, oneshot};
use vibe_server_core::error::{AppError, AppResult};
use vibe_server_core::host::{Host, JavaPrefs, RelayIdentity};

#[derive(Default)]
pub struct GatewayLink {
    out: Mutex<Option<mpsc::Sender<String>>>,
    pending: Mutex<HashMap<String, oneshot::Sender<Value>>>,
}

impl GatewayLink {
    pub fn attach(&self, out: mpsc::Sender<String>) {
        *self.out.lock() = Some(out);
    }

    pub fn detach(&self) {
        *self.out.lock() = None;
        self.pending.lock().clear();
    }

    pub fn connected(&self) -> bool {
        self.out.lock().as_ref().is_some_and(|o| !o.is_closed())
    }

    pub fn resolve(&self, d: &Value) {
        let id = d["id"].as_str().unwrap_or_default();
        if let Some(tx) = self.pending.lock().remove(id) {
            let _ = tx.send(d.clone());
        }
    }

    pub async fn relay_ticket(&self, server_id: &str) -> AppResult<RelayIdentity> {
        let out = self.out.lock().clone().ok_or_else(|| {
            AppError::NotConfigured("Für den Vibe-Relay muss der Agent mit einem Vibe-Konto verbunden sein (`vibe-agent link`).".into())
        })?;
        let id = crate::crypto::new_id("q");
        let (tx, rx) = oneshot::channel();
        self.pending.lock().insert(id.clone(), tx);
        let frame = json!({ "op": "relay.ticket", "d": { "id": id, "serverId": server_id } }).to_string();
        if out.send(frame).await.is_err() {
            self.pending.lock().remove(&id);
            return Err(AppError::Unreachable("Vibe-Gateway nicht verbunden".into()));
        }
        let d = match tokio::time::timeout(Duration::from_secs(15), rx).await {
            Ok(Ok(d)) => d,
            _ => {
                self.pending.lock().remove(&id);
                return Err(AppError::Unreachable("Vibe-Gateway antwortet nicht (Relay-Ticket)".into()));
            }
        };
        if let Some(e) = d["error"].as_str() {
            return Err(AppError::Access(e.to_string()));
        }
        let field = |k: &str| d[k].as_str().map(str::to_string).ok_or_else(|| AppError::msg(format!("Relay-Ticket ohne {k}")));
        Ok(RelayIdentity { username: field("name")?, uuid: field("uuid")?, access_token: String::new(), ticket: Some(field("ticket")?) })
    }
}

pub struct AgentHost {
    pub cfg: Arc<RwLock<AgentConfig>>,
    pub gateway: GatewayLink,
}

impl AgentHost {
    pub fn new(cfg: Arc<RwLock<AgentConfig>>) -> Self {
        AgentHost { cfg, gateway: GatewayLink::default() }
    }
}

impl Host for AgentHost {
    fn java_prefs(&self) -> JavaPrefs {
        JavaPrefs { overrides: Default::default(), auto_java: self.cfg.read().auto_java }
    }

    fn hosting_enabled(&self) -> bool {
        self.cfg.read().hosting
    }

    fn hosting_disabled_message(&self) -> String {
        "Vibe-Relay ist in der Agent-Konfiguration ausgeschaltet (hosting = false).".into()
    }

    fn relay_identity<'a>(&'a self, server_id: &'a str) -> BoxFuture<'a, AppResult<RelayIdentity>> {
        Box::pin(self.gateway.relay_ticket(server_id))
    }
}

pub const RELAY_SLOT_BASE: u32 = 32;

pub fn product() -> vibe_server_core::product::Product {
    vibe_server_core::product::Product {
        display: "Vibe Agent".into(),
        slug: "vibe-agent".into(),
        ua_name: "VibeAgent".into(),
        version: env!("CARGO_PKG_VERSION").into(),
        client: "agent".into(),
        relay_slot_base: RELAY_SLOT_BASE,
    }
}
