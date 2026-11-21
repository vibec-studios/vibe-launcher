use crate::audit::{Audit, AuditEntry};
use crate::config::{AgentConfig, Dirs};
use crate::gateway::GatewayStatus;
use crate::host::AgentHost;
use crate::pairing::PairingStore;
use crate::ratelimit::RateLimiter;
use crate::users::{User, UserStore};
use parking_lot::RwLock;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::broadcast;
use vibe_server_core::events::ChannelSink;
use vibe_server_core::net::Net;
use vibe_server_core::paths::Paths;
use vibe_server_core::Core;

pub type Event = (String, serde_json::Value);

pub struct AgentState {
    pub core: Core,
    pub dirs: Dirs,
    pub cfg: Arc<RwLock<AgentConfig>>,
    pub host: Arc<AgentHost>,
    pub users: UserStore,
    pub pairing: PairingStore,
    pub audit: Audit,
    pub pair_limit: RateLimiter,
    pub api_limit: RateLimiter,
    pub events: broadcast::Sender<Event>,
    pub fingerprint: Option<String>,
    pub started_at: i64,
    pub gateway: RwLock<GatewayStatus>,
    pub gw_notify: tokio::sync::Notify,
}

pub type Ctx = Arc<AgentState>;

impl AgentState {
    pub fn new(dirs: Dirs, cfg: AgentConfig, fingerprint: Option<String>) -> Ctx {
        vibe_server_core::product::set(crate::host::product());
        let paths = Paths { root: dirs.data.clone() };
        if let Err(e) = std::fs::create_dir_all(paths.root.join("servers")).and_then(|_| paths.ensure()) {
            tracing::error!("Datenordner {:?} nicht anlegbar: {e}", paths.root);
        }
        let (tx, _) = broadcast::channel(4096);
        let cfg = Arc::new(RwLock::new(cfg));
        let host = Arc::new(AgentHost::new(cfg.clone()));
        let net = Arc::new(Net::new(cfg.read().concurrent_downloads.max(1) as usize));
        let core = Core::new(paths, net, Arc::new(ChannelSink(tx.clone())), host.clone());
        Arc::new(AgentState {
            core,
            users: UserStore::load(dirs.users_file()),
            pairing: PairingStore::new(dirs.pair_file()),
            audit: Audit::new(dirs.audit_file()),
            dirs,
            cfg,
            host,
            pair_limit: RateLimiter::new(5, Duration::from_secs(60)),
            api_limit: RateLimiter::new(600, Duration::from_secs(60)),
            events: tx,
            fingerprint,
            started_at: vibe_server_core::util::now_ms(),
            gateway: RwLock::new(GatewayStatus::default()),
            gw_notify: tokio::sync::Notify::new(),
        })
    }

    pub fn audit(&self, user: Option<&User>, ip: Option<String>, via: &str, action: &str, target: Option<&str>, ok: bool, detail: Option<String>) {
        self.audit.record(AuditEntry {
            at: 0,
            user_id: user.map(|u| u.id.clone()),
            user_name: user.map(|u| u.name.clone()),
            ip,
            via: via.to_string(),
            action: action.to_string(),
            target: target.map(str::to_string),
            ok,
            detail,
        });
    }
}
