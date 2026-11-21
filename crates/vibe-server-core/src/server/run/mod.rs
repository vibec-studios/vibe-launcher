//! Laufende Server: Start/Stopp/Neustart, Konsole (stdin), Log-Puffer, Spielerliste, Auto-Neustart,
//! Tunnel-Steuerung, „noch laufende“ Server aus früheren Sitzungen.
use super::{server_dir, Server, ServerConnection, EV_LOG, EV_STATUS};
use crate::error::{AppError, AppResult};
use crate::events;
use crate::minecraft::logparse::{decode_line, LineParser, Parsed};
use crate::minecraft::{LogLevel, LogLine};
use crate::paths::Paths;
use crate::Core;
use parking_lot::Mutex;
use regex::Regex;
use serde::Serialize;
use std::collections::{HashMap, VecDeque};
use std::sync::{Arc, OnceLock, Weak};
use std::time::{Duration, Instant};
use crate::events::Sink;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt};
use tokio_util::sync::CancellationToken;

mod log;
pub use log::*;
mod control;
pub use control::*;
mod process;
mod start;
pub use start::*;

const MAX_LINES: usize = 50_000;
const STOP_TIMEOUT: Duration = Duration::from_secs(60);
const PID_FILE: &str = ".vibe-pid";

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RunState {
    Stopped,
    Starting,
    Running,
    Stopping,
    Crashed,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TunnelState {
    Connecting,
    Online,
    Claim,
    Error,
    Stopped,
}

#[derive(Debug, Clone, Serialize)]
pub struct TunnelStatus {
    pub kind: ServerConnection,
    pub state: TunnelState,
    pub address: Option<String>,
    pub claim_url: Option<String>,
    pub message: Option<String>,
    /// Sprachchat/Bedrock über den Relay (nur Relay, nur wenn eingeschaltet)
    pub udp: Option<super::relay::UdpStatus>,
}

impl TunnelStatus {
    pub fn new(kind: ServerConnection, state: TunnelState) -> Self {
        TunnelStatus { kind, state, address: None, claim_url: None, message: None, udp: None }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct ServerStatus {
    pub server_id: String,
    pub state: RunState,
    pub pid: Option<u32>,
    pub started_at: Option<i64>,
    pub players: Vec<String>,
    pub max_players: Option<u32>,
    pub exit_code: Option<i32>,
    pub detached: bool,
    pub tunnel: Option<TunnelStatus>,
}

struct Session {
    status: ServerStatus,
    log: VecDeque<LogLine>,
    seq: u64,
    pending: Vec<LogLine>,
    stdin: Option<tokio::sync::mpsc::UnboundedSender<String>>,
    stopping: bool,
    restart_after: bool,
    crashes: Vec<Instant>,
    tunnel_cancel: Option<CancellationToken>,
    /// Wird nach dem Ende ausgelöst (für sauberes Beenden)
    exited: Arc<tokio::sync::Notify>,
}

impl Session {
    fn new(id: &str) -> Self {
        Session {
            status: ServerStatus {
                server_id: id.to_string(),
                state: RunState::Stopped,
                pid: None,
                started_at: None,
                players: vec![],
                max_players: None,
                exit_code: None,
                detached: false,
                tunnel: None,
            },
            log: VecDeque::new(),
            seq: 0,
            pending: vec![],
            stdin: None,
            stopping: false,
            restart_after: false,
            crashes: vec![],
            tunnel_cancel: None,
            exited: Arc::new(tokio::sync::Notify::new()),
        }
    }
}

pub struct ServerManager {
    paths: Paths,
    events: Sink,
    me: Weak<ServerManager>,
    sessions: Mutex<HashMap<String, Session>>,
    flusher: std::sync::Once,
    quitting: std::sync::atomic::AtomicBool,
}

/// Ist der TCP-Port frei (auf allen Adressen)?
pub fn port_free(port: u16) -> bool {
    std::net::TcpListener::bind(("0.0.0.0", port)).is_ok()
}

fn re(pat: &str) -> Regex {
    Regex::new(pat).expect("regex")
}

impl ServerManager {
    pub fn new(paths: Paths, events: Sink) -> Arc<Self> {
        Arc::new_cyclic(|me| ServerManager {
            paths,
            events,
            me: me.clone(),
            sessions: Mutex::new(HashMap::new()),
            flusher: std::sync::Once::new(),
            quitting: Default::default(),
        })
    }

    pub fn statuses(&self) -> Vec<ServerStatus> {
        self.sessions.lock().values().map(|s| s.status.clone()).collect()
    }

    pub fn status(&self, id: &str) -> Option<ServerStatus> {
        self.sessions.lock().get(id).map(|s| s.status.clone())
    }

    pub fn is_active(&self, id: &str) -> bool {
        self.sessions.lock().get(id).is_some_and(|s| !matches!(s.status.state, RunState::Stopped | RunState::Crashed))
    }

    pub fn running_count(&self) -> usize {
        self.sessions.lock().values().filter(|s| !matches!(s.status.state, RunState::Stopped | RunState::Crashed)).count()
    }

    pub fn quitting(&self) -> bool {
        self.quitting.load(std::sync::atomic::Ordering::Relaxed)
    }

    pub fn set_quitting(&self) {
        self.quitting.store(true, std::sync::atomic::Ordering::Relaxed);
    }

    pub fn log(&self, id: &str) -> Vec<LogLine> {
        self.sessions.lock().get(id).map(|s| s.log.iter().cloned().collect()).unwrap_or_default()
    }

    fn emit_status(&self, st: &ServerStatus) {
        events::emit(&self.events, EV_STATUS, st);
    }

    /// Status ändern und senden.
    fn update<F: FnOnce(&mut Session)>(&self, id: &str, f: F) -> ServerStatus {
        let st = {
            let mut map = self.sessions.lock();
            let s = map.entry(id.to_string()).or_insert_with(|| Session::new(id));
            f(s);
            s.status.clone()
        };
        self.emit_status(&st);
        st
    }

    pub fn set_tunnel(&self, id: &str, t: Option<TunnelStatus>) {
        self.update(id, |s| s.status.tunnel = t);
    }
}

#[cfg(test)]
mod tests;
