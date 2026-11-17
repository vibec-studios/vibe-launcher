//! Laufende Server: Start/Stopp/Neustart, Konsole (stdin), Log-Puffer, Spielerliste, Auto-Neustart,
//! Tunnel-Steuerung, „noch laufende“ Server aus früheren Sitzungen.
use super::{server_dir, Server, ServerConnection, EV_LOG, EV_STATUS};
use crate::error::{AppError, AppResult};
use crate::events;
use crate::minecraft::logs::{decode_line, LineParser, Parsed};
use crate::minecraft::{LogLevel, LogLine};
use crate::paths::Paths;
use crate::state::AppState;
use parking_lot::Mutex;
use regex::Regex;
use serde::Serialize;
use std::collections::{HashMap, VecDeque};
use std::sync::{Arc, OnceLock, Weak};
use std::time::{Duration, Instant};
use tauri::AppHandle;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt};
use tokio_util::sync::CancellationToken;

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
}

impl TunnelStatus {
    pub fn new(kind: ServerConnection, state: TunnelState) -> Self {
        TunnelStatus { kind, state, address: None, claim_url: None, message: None }
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
    app: AppHandle,
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
    pub fn new(paths: Paths, app: AppHandle) -> Arc<Self> {
        Arc::new_cyclic(|me| ServerManager {
            paths,
            app,
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
        events::emit(&self.app, EV_STATUS, st);
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

    fn ensure_flusher(&self) {
        self.flusher.call_once(|| {
            let me = self.me.clone();
            tauri::async_runtime::spawn(async move {
                loop {
                    tokio::time::sleep(Duration::from_millis(100)).await;
                    let Some(m) = me.upgrade() else { break };
                    m.flush();
                }
            });
        });
    }

    fn flush(&self) {
        let batches: Vec<(String, Vec<LogLine>)> = {
            let mut map = self.sessions.lock();
            map.iter_mut().filter(|(_, s)| !s.pending.is_empty()).map(|(k, s)| (k.clone(), std::mem::take(&mut s.pending))).collect()
        };
        for (id, lines) in batches {
            events::emit(&self.app, EV_LOG, &serde_json::json!({ "server_id": id, "lines": lines }));
        }
    }

    pub fn push(&self, id: &str, lines: Vec<Parsed>) {
        if lines.is_empty() {
            return;
        }
        let mut map = self.sessions.lock();
        let s = map.entry(id.to_string()).or_insert_with(|| Session::new(id));
        for p in lines {
            s.seq += 1;
            let l = LogLine { seq: s.seq, time: p.time, level: p.level, thread: p.thread, logger: p.logger, text: p.text };
            if s.log.len() >= MAX_LINES {
                s.log.pop_front();
            }
            s.log.push_back(l.clone());
            s.pending.push(l);
        }
    }

    pub fn launcher_line(&self, id: &str, level: LogLevel, text: impl Into<String>) {
        let time = Some(chrono::Local::now().format("%H:%M:%S").to_string());
        let lines = text
            .into()
            .lines()
            .map(|t| Parsed { time: time.clone(), level, thread: None, logger: Some("Vibe Launcher".into()), text: t.to_string() })
            .collect();
        self.push(id, lines);
    }

    /// Ausgabezeile auswerten: Start fertig, Spieler, `list`-Antwort.
    fn inspect(&self, state: &AppState, id: &str, text: &str) {
        static DONE: OnceLock<Regex> = OnceLock::new();
        static JOIN: OnceLock<Regex> = OnceLock::new();
        static LEFT: OnceLock<Regex> = OnceLock::new();
        static LIST: OnceLock<Regex> = OnceLock::new();
        let done = DONE.get_or_init(|| re(r#"Done \([0-9.,]+s\)! For help, type "help""#));
        let join = JOIN.get_or_init(|| re(r"(?:^|System chat: |\]: )([A-Za-z0-9_]{1,16}) joined the game$"));
        let left = LEFT.get_or_init(|| re(r"(?:^|System chat: |\]: )([A-Za-z0-9_]{1,16}) left the game$"));
        let list = LIST.get_or_init(|| re(r"There are (\d+) ?(?:of a max of|/) ?(\d+) players online:?(.*)$"));
        if done.is_match(text) {
            let max = super::props::get(&server_dir(&self.paths, id).join("server.properties"), "max-players").and_then(|v| v.parse().ok());
            self.update(id, |s| {
                if s.status.state == RunState::Starting {
                    s.status.state = RunState::Running;
                }
                s.status.max_players = max;
            });
            self.launcher_line(id, LogLevel::Launcher, "Server ist bereit.");
            start_tunnel(state, id);
        } else if let Some(c) = join.captures(text) {
            let name = c[1].to_string();
            self.update(id, |s| {
                if !s.status.players.contains(&name) {
                    s.status.players.push(name);
                }
            });
        } else if let Some(c) = left.captures(text) {
            let name = c[1].to_string();
            self.update(id, |s| s.status.players.retain(|p| *p != name));
        } else if let Some(c) = list.captures(text) {
            let max = c[2].parse().ok();
            let names: Vec<String> =
                c[3].split(',').map(|n| n.trim().to_string()).filter(|n| !n.is_empty() && n.len() <= 16).collect();
            let count: usize = c[1].parse().unwrap_or(0);
            self.update(id, |s| {
                s.status.max_players = max;
                if names.len() == count {
                    s.status.players = names;
                }
            });
        } else if text.contains("FAILED TO BIND TO PORT") {
            self.launcher_line(id, LogLevel::Error, "Der Port ist belegt – läuft dort schon ein anderer Server? Ändere den Port in den Einstellungen.");
        }
    }

    /// Konsolenbefehl senden.
    pub fn command(&self, id: &str, cmd: &str) -> AppResult<()> {
        let cmd = cmd.trim().trim_start_matches('/').to_string();
        if cmd.is_empty() {
            return Ok(());
        }
        let tx = {
            let map = self.sessions.lock();
            let s = map.get(id).ok_or_else(|| AppError::Invalid("Der Server läuft nicht.".into()))?;
            if s.status.detached {
                return Err(AppError::Invalid("Dieser Server wurde in einer früheren Sitzung gestartet – keine Konsole verfügbar.".into()));
            }
            s.stdin.clone().ok_or_else(|| AppError::Invalid("Der Server läuft nicht.".into()))?
        };
        self.launcher_line(id, LogLevel::Launcher, format!("> {cmd}"));
        tx.send(cmd).map_err(|_| AppError::Invalid("Der Server läuft nicht.".into()))
    }

    /// Sauber stoppen (`stop`), nach Zeitlimit Prozessbaum beenden.
    pub fn stop(&self, id: &str) -> AppResult<()> {
        let (pid, tx, detached) = {
            let mut map = self.sessions.lock();
            let s = map.get_mut(id).ok_or_else(|| AppError::Invalid("Der Server läuft nicht.".into()))?;
            if matches!(s.status.state, RunState::Stopped | RunState::Crashed) {
                return Err(AppError::Invalid("Der Server läuft nicht.".into()));
            }
            s.stopping = true;
            (s.status.pid, s.stdin.clone(), s.status.detached)
        };
        self.update(id, |s| s.status.state = RunState::Stopping);
        if detached || tx.is_none() {
            if let Some(pid) = pid {
                crate::minecraft::process::kill_tree(pid);
            }
            if detached {
                self.finish_detached(id);
            }
            return Ok(());
        }
        self.launcher_line(id, LogLevel::Launcher, "Server wird gestoppt …");
        if let Some(tx) = tx {
            let _ = tx.send("stop".into());
        }
        let me = self.me.clone();
        let id2 = id.to_string();
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(STOP_TIMEOUT).await;
            let Some(m) = me.upgrade() else { return };
            let still = m.sessions.lock().get(&id2).filter(|s| s.status.state == RunState::Stopping).and_then(|s| s.status.pid);
            if let Some(pid) = still {
                m.launcher_line(&id2, LogLevel::Warn, "Server reagiert nicht – wird hart beendet.");
                crate::minecraft::process::kill_tree(pid);
            }
        });
        Ok(())
    }

    pub fn kill(&self, id: &str) -> AppResult<()> {
        let (pid, detached) = {
            let mut map = self.sessions.lock();
            let s = map.get_mut(id).ok_or_else(|| AppError::Invalid("Der Server läuft nicht.".into()))?;
            s.stopping = true;
            s.restart_after = false;
            (s.status.pid, s.status.detached)
        };
        if let Some(pid) = pid {
            self.launcher_line(id, LogLevel::Warn, "Server wird hart beendet.");
            crate::minecraft::process::kill_tree(pid);
        }
        if detached {
            self.finish_detached(id);
        }
        Ok(())
    }

    pub fn restart(&self, state: &AppState, id: &str) -> AppResult<()> {
        if !self.is_active(id) {
            return start(state, id);
        }
        self.sessions.lock().entry(id.to_string()).or_insert_with(|| Session::new(id)).restart_after = true;
        self.stop(id)
    }

    fn finish_detached(&self, id: &str) {
        let _ = std::fs::remove_file(server_dir(&self.paths, id).join(PID_FILE));
        self.update(id, |s| {
            s.status.state = RunState::Stopped;
            s.status.pid = None;
            s.status.detached = false;
            s.status.players.clear();
        });
    }

    /// Wartet, bis der Server beendet ist (max. `timeout`).
    pub async fn wait_stopped(&self, id: &str, timeout: Duration) {
        let notify = self.sessions.lock().get(id).map(|s| s.exited.clone());
        let Some(n) = notify else { return };
        let fut = n.notified();
        if !self.is_active(id) {
            return;
        }
        let _ = tokio::time::timeout(timeout, fut).await;
    }

    fn stop_tunnel(&self, id: &str) {
        let t = self.sessions.lock().get_mut(id).and_then(|s| s.tunnel_cancel.take());
        if let Some(t) = t {
            t.cancel();
        }
    }

    /// Prozess übernehmen.
    fn attach(&self, state: AppState, id: String, mut child: tokio::process::Child) {
        self.ensure_flusher();
        let pid = child.id();
        let started_ms = crate::util::now_ms();
        let dir = server_dir(&self.paths, &id);
        if let Some(pid) = pid {
            let _ = std::fs::write(dir.join(PID_FILE), format!("{pid}"));
        }
        // stdin-Schreiber
        let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<String>();
        if let Some(mut stdin) = child.stdin.take() {
            tauri::async_runtime::spawn(async move {
                while let Some(cmd) = rx.recv().await {
                    if stdin.write_all(format!("{cmd}\n").as_bytes()).await.is_err() {
                        break;
                    }
                    let _ = stdin.flush().await;
                }
            });
        }
        self.update(&id, |s| {
            s.status.pid = pid;
            s.status.started_at = Some(started_ms);
            s.stdin = Some(tx);
        });

        let me = self.me.clone();
        let mk_reader = |stream: Option<Box<dyn tokio::io::AsyncRead + Unpin + Send>>, is_err: bool| {
            let me = me.clone();
            let id = id.clone();
            let state = state.clone();
            tauri::async_runtime::spawn(async move {
                let Some(stream) = stream else { return };
                let mut reader = tokio::io::BufReader::with_capacity(64 * 1024, stream);
                let mut parser = LineParser::new(is_err);
                let mut buf = Vec::new();
                loop {
                    buf.clear();
                    match reader.read_until(b'\n', &mut buf).await {
                        Ok(0) | Err(_) => break,
                        Ok(_) => {
                            let line = decode_line(&buf);
                            let mut parsed = parser.feed(&line);
                            // JVM-Hinweise auf stderr („WARNING: …“) sind keine Fehler
                            for p in parsed.iter_mut() {
                                if p.level == LogLevel::Stderr && p.text.starts_with("WARNING:") {
                                    p.level = LogLevel::Warn;
                                }
                            }
                            if let Some(m) = me.upgrade() {
                                let texts: Vec<String> = parsed.iter().map(|p| p.text.clone()).collect();
                                m.push(&id, parsed);
                                for t in &texts {
                                    m.inspect(&state, &id, t);
                                }
                            }
                        }
                    }
                }
            })
        };
        let r_out = mk_reader(child.stdout.take().map(|s| Box::new(s) as Box<dyn tokio::io::AsyncRead + Unpin + Send>), false);
        let r_err = mk_reader(child.stderr.take().map(|s| Box::new(s) as Box<dyn tokio::io::AsyncRead + Unpin + Send>), true);

        tauri::async_runtime::spawn(async move {
            let status = child.wait().await;
            let _ = tokio::time::timeout(Duration::from_secs(3), async {
                let _ = r_out.await;
                let _ = r_err.await;
            })
            .await;
            let Some(m) = me.upgrade() else { return };
            let _ = std::fs::remove_file(dir.join(PID_FILE));
            m.stop_tunnel(&id);
            let code = status.as_ref().ok().and_then(|s| s.code());
            let (stopping, restart_after) = {
                let map = m.sessions.lock();
                map.get(&id).map(|s| (s.stopping, s.restart_after)).unwrap_or((false, false))
            };
            let crashed = !stopping && code != Some(0);
            m.launcher_line(
                &id,
                if crashed { LogLevel::Error } else { LogLevel::Launcher },
                if crashed { format!("Server ist abgestürzt (Exit-Code {}).", code.map(|c| c.to_string()).unwrap_or("?".into())) } else { "Server gestoppt.".to_string() },
            );
            m.flush();
            let mut auto_restart = false;
            let st = m.update(&id, |s| {
                s.status.state = if crashed { RunState::Crashed } else { RunState::Stopped };
                s.status.exit_code = code;
                s.status.pid = None;
                s.status.players.clear();
                s.status.tunnel = None;
                s.stdin = None;
                s.stopping = false;
                s.restart_after = false;
                if crashed {
                    let now = Instant::now();
                    s.crashes.retain(|t| now.duration_since(*t) < Duration::from_secs(600));
                    s.crashes.push(now);
                    auto_restart = s.crashes.len() <= 3;
                }
            });
            let exited = m.sessions.lock().get(&id).map(|s| s.exited.clone());
            if let Some(n) = exited {
                n.notify_waiters();
            }
            let _ = st;
            if m.quitting() {
                return;
            }
            let wants_restart = state.servers.get(&id).map(|s| s.auto_restart).unwrap_or(false);
            if restart_after || (crashed && wants_restart && auto_restart) {
                if !restart_after {
                    m.launcher_line(&id, LogLevel::Launcher, "Automatischer Neustart in 5 Sekunden …");
                    tokio::time::sleep(Duration::from_secs(5)).await;
                }
                if let Err(e) = start(&state, &id) {
                    m.launcher_line(&id, LogLevel::Error, format!("Neustart fehlgeschlagen: {e}"));
                }
            } else if crashed && wants_restart && !auto_restart {
                m.launcher_line(&id, LogLevel::Error, "Zu viele Abstürze – automatischer Neustart ausgesetzt.");
            }
        });
    }

    /// Beim Launcher-Start: Server aus früheren Sitzungen erkennen, Auto-Start.
    pub fn on_startup(&self, state: &AppState) {
        let mut sys = sysinfo::System::new();
        sys.refresh_processes(sysinfo::ProcessesToUpdate::All, true);
        for s in state.servers.list() {
            let pidf = server_dir(&self.paths, &s.id).join(PID_FILE);
            let Some(pid) = std::fs::read_to_string(&pidf).ok().and_then(|t| t.trim().parse::<u32>().ok()) else { continue };
            let alive = sys
                .process(sysinfo::Pid::from_u32(pid))
                .is_some_and(|p| p.name().to_string_lossy().to_ascii_lowercase().starts_with("java"));
            if alive {
                self.update(&s.id, |x| {
                    x.status.state = RunState::Running;
                    x.status.pid = Some(pid);
                    x.status.detached = true;
                });
                self.launcher_line(&s.id, LogLevel::Launcher, "Server läuft noch aus einer früheren Sitzung (keine Konsole verfügbar).");
                // Prozessende überwachen
                let me = self.me.clone();
                let id = s.id.clone();
                tauri::async_runtime::spawn(async move {
                    loop {
                        tokio::time::sleep(Duration::from_secs(3)).await;
                        let mut sys = sysinfo::System::new();
                        sys.refresh_processes(sysinfo::ProcessesToUpdate::Some(&[sysinfo::Pid::from_u32(pid)]), true);
                        if sys.process(sysinfo::Pid::from_u32(pid)).is_none() {
                            if let Some(m) = me.upgrade() {
                                if m.status(&id).is_some_and(|st| st.detached) {
                                    m.finish_detached(&id);
                                }
                            }
                            break;
                        }
                    }
                });
            } else {
                let _ = std::fs::remove_file(&pidf);
            }
        }
        for s in state.servers.list().into_iter().filter(|s| s.auto_start) {
            if self.is_active(&s.id) {
                continue;
            }
            if let Err(e) = start(state, &s.id) {
                tracing::warn!("Auto-Start von Server {} fehlgeschlagen: {e}", s.id);
                self.launcher_line(&s.id, LogLevel::Error, format!("Auto-Start fehlgeschlagen: {e}"));
            }
        }
    }

    /// Alle Server sauber stoppen und warten (Launcher wird beendet).
    pub async fn stop_all(&self) {
        let ids: Vec<String> = self.sessions.lock().iter().filter(|(_, s)| !matches!(s.status.state, RunState::Stopped | RunState::Crashed)).map(|(k, _)| k.clone()).collect();
        for id in &ids {
            let _ = self.stop(id);
        }
        let waits = ids.iter().map(|id| self.wait_stopped(id, STOP_TIMEOUT + Duration::from_secs(5)));
        futures::future::join_all(waits).await;
    }
}

/// Java für den Server: fester Pfad > verwaltete Runtime der Komponente > Auflösung (lädt ggf. herunter).
async fn server_java(state: &AppState, s: &Server, spec: &super::install::LaunchSpec, task: Option<&crate::tasks::TaskHandle>) -> AppResult<std::path::PathBuf> {
    use crate::minecraft::java;
    if let Some(p) = s.java_path.as_deref().filter(|p| !p.trim().is_empty()) {
        return java::normalize_java_path(std::path::Path::new(p.trim()))
            .ok_or_else(|| AppError::msg(format!("Der eingestellte Java-Pfad existiert nicht: {p}")));
    }
    if let Some(c) = &spec.java_component {
        if let Some((_, p)) = java::managed_runtimes(&state.paths.java_root()).into_iter().find(|(n, _)| n == c) {
            return Ok(p);
        }
    }
    let owned;
    let task = match task {
        Some(t) => t,
        None => {
            owned = state.tasks.create("java", format!("Java {} wird vorbereitet", spec.java_major), Some(format!("server:{}", s.id)));
            &owned
        }
    };
    let r = java::resolve_with(state, None, spec.java_major, spec.java_component.as_deref(), false, &task.sub(0.0, 1.0)).await;
    task.finish(r.as_ref().map(|_| ()).map_err(|e| AppError::msg(e.to_string())));
    Ok(std::path::PathBuf::from(r?.path))
}

/// Server starten (Prozess läuft im Hintergrund weiter).
pub fn start(state: &AppState, id: &str) -> AppResult<()> {
    let s = state.servers.get(id)?;
    let mgr = state.server_mgr.clone();
    if mgr.is_active(id) {
        return Err(AppError::Invalid("Der Server läuft bereits.".into()));
    }
    if s.install_state != crate::instance::InstallState::Installed || s.launch.is_none() {
        return Err(AppError::Invalid("Der Server ist noch nicht (fertig) installiert.".into()));
    }
    if !s.eula {
        return Err(AppError::Invalid("Bitte zuerst die Minecraft-EULA akzeptieren.".into()));
    }
    if let Some(other) = state.servers.list().into_iter().find(|o| o.id != s.id && o.port == s.port && mgr.is_active(&o.id)) {
        return Err(AppError::Invalid(format!("Port {} wird schon vom laufenden Server „{}“ verwendet.", s.port, other.name)));
    }
    if !port_free(s.port) {
        return Err(AppError::Invalid(format!(
            "Port {} ist belegt – läuft dort schon ein anderer Server oder ein Programm? Ändere den Port in den Einstellungen.",
            s.port
        )));
    }
    mgr.ensure_flusher();
    mgr.update(id, |x| {
        x.status.state = RunState::Starting;
        x.status.exit_code = None;
        x.status.players.clear();
        x.status.detached = false;
        x.status.tunnel = None;
        x.stopping = false;
        x.restart_after = false;
        x.log.clear();
        x.seq = 0;
        x.pending.clear();
    });
    let state2 = state.clone();
    let id2 = id.to_string();
    tauri::async_runtime::spawn(async move {
        let mgr = state2.server_mgr.clone();
        if let Err(e) = spawn_process(&state2, &id2).await {
            mgr.launcher_line(&id2, LogLevel::Error, format!("Start fehlgeschlagen: {e}"));
            mgr.update(&id2, |x| {
                x.status.state = RunState::Crashed;
                x.stdin = None;
            });
            let exited = mgr.sessions.lock().get(&id2).map(|s| s.exited.clone());
            if let Some(n) = exited {
                n.notify_waiters();
            }
        }
    });
    Ok(())
}

async fn spawn_process(state: &AppState, id: &str) -> AppResult<()> {
    let mgr = state.server_mgr.clone();
    let s = state.servers.get(id)?;
    let spec = s.launch.clone().ok_or_else(|| AppError::msg("Startdaten fehlen – bitte Server reparieren."))?;
    let dir = server_dir(&state.paths, id);
    // eula.txt + Port synchronisieren
    std::fs::write(dir.join("eula.txt"), "# Akzeptiert im Vibe Launcher (https://aka.ms/MinecraftEULA)\neula=true\n")?;
    super::props::set(&dir.join("server.properties"), &[("server-port".into(), s.port.to_string())])?;
    let java = server_java(state, &s, &spec, None).await?;
    let java = crate::minecraft::java::console_java(&java);
    let mem = s.memory();
    let mut args: Vec<String> = vec![format!("-Xms{}M", mem.min(1024)), format!("-Xmx{mem}M")];
    if let Some(a) = &s.jvm_args {
        args.extend(crate::minecraft::launch::split_args(a));
    }
    args.extend(spec.args.iter().cloned());
    args.push("nogui".into());
    mgr.launcher_line(id, LogLevel::Launcher, format!("Java: {}", java.display()));
    mgr.launcher_line(id, LogLevel::Launcher, format!("Startbefehl: java {}", args.join(" ")));
    let mut cmd = tokio::process::Command::new(&java);
    cmd.args(&args)
        .current_dir(&dir)
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());
    #[cfg(windows)]
    cmd.creation_flags(crate::minecraft::java::CREATE_NO_WINDOW);
    #[cfg(unix)]
    cmd.process_group(0);
    let child = cmd.spawn().map_err(|e| AppError::msg(format!("Server konnte nicht gestartet werden: {e}")))?;
    let _ = state.servers.modify(id, |x| x.last_started = Some(crate::util::now_ms()));
    mgr.attach(state.clone(), id.to_string(), child);
    Ok(())
}

/// Tunnel der gewählten Verbindungsart starten (nachdem der Server bereit ist).
pub fn start_tunnel(state: &AppState, id: &str) {
    let Ok(s) = state.servers.get(id) else { return };
    let mgr = state.server_mgr.clone();
    mgr.stop_tunnel(id);
    let token = CancellationToken::new();
    match s.connection {
        ServerConnection::Local => return,
        ServerConnection::Relay => {
            let v = state.settings().vibe;
            if !(v.enabled && v.hosting) {
                mgr.set_tunnel(id, Some(TunnelStatus {
                    message: Some("Vibe-Hosting ist in den Einstellungen ausgeschaltet.".into()),
                    ..TunnelStatus::new(ServerConnection::Relay, TunnelState::Error)
                }));
                return;
            }
            super::relay::spawn(state.clone(), id.to_string(), token.clone());
        }
        ServerConnection::Playit => super::playit::spawn(state.clone(), id.to_string(), token.clone()),
    }
    let mut map = mgr.sessions.lock();
    if let Some(sess) = map.get_mut(id) {
        sess.tunnel_cancel = Some(token);
    }
}

/// Verbindungsart geändert, während der Server läuft -> Tunnel neu starten.
pub fn restart_tunnel_if_running(state: &AppState, id: &str) {
    let mgr = state.server_mgr.clone();
    if mgr.status(id).is_some_and(|s| s.state == RunState::Running) {
        mgr.stop_tunnel(id);
        mgr.set_tunnel(id, None);
        start_tunnel(state, id);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn patterns() {
        let list = re(r"There are (\d+) ?(?:of a max of|/) ?(\d+) players online:?(.*)$");
        let c = list.captures("There are 2 of a max of 20 players online: Steve, Alex").unwrap();
        assert_eq!(&c[1], "2");
        assert_eq!(&c[2], "20");
        assert_eq!(c[3].trim(), "Steve, Alex");
        let c = list.captures("There are 0/10 players online:").unwrap();
        assert_eq!(&c[2], "10");
        let join = re(r"(?:^|System chat: |\]: )([A-Za-z0-9_]{1,16}) joined the game$");
        assert_eq!(&join.captures("System chat: VibeTester joined the game").unwrap()[1], "VibeTester");
        assert_eq!(&join.captures("Steve joined the game").unwrap()[1], "Steve");
        assert!(join.captures("[Not Secure] <Bob> Alice joined the game").is_none());
        assert!(re(r#"Done \([0-9.,]+s\)! For help, type "help""#).is_match(r#"Done (3.215s)! For help, type "help""#));
    }
}
