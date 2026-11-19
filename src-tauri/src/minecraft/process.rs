//! Laufende Spielprozesse: Zustände, Log-Puffer, Events, Beenden, Crash-Erkennung.
use super::logs::{decode_line, LineParser, Parsed};
use super::{GameState, LogLevel, LogLine, RunState};
use crate::error::{AppError, AppResult};
use crate::events;
use crate::paths::Paths;
use crate::state::AppState;
use parking_lot::Mutex;
use std::collections::{HashMap, VecDeque};
use std::sync::{Arc, Weak};
use std::time::Duration;
use tauri::{AppHandle, Manager};
use tokio::io::AsyncBufReadExt;

const MAX_LINES: usize = 50_000;

struct Session {
    state: GameState,
    log: VecDeque<LogLine>,
    seq: u64,
    pending: Vec<LogLine>,
    killed: bool,
    task_id: Option<String>,
    /// Zugangstoken – wird in Log-Zeilen maskiert
    secret: Option<String>,
}

/// Verwaltet laufende Spielprozesse und ihre Log-Puffer.
pub struct GameManager {
    paths: Paths,
    app: AppHandle,
    me: Weak<GameManager>,
    sessions: Mutex<HashMap<String, Session>>,
    flusher: std::sync::Once,
    /// Installationen laufen nacheinander (gemeinsame Dateien in meta/)
    pub(crate) install_lock: tokio::sync::Mutex<()>,
}

impl GameManager {
    pub fn new(paths: Paths, app: AppHandle) -> Arc<Self> {
        Arc::new_cyclic(|me| GameManager {
            paths,
            app,
            me: me.clone(),
            sessions: Mutex::new(HashMap::new()),
            flusher: std::sync::Once::new(),
            install_lock: tokio::sync::Mutex::new(()),
        })
    }

    pub fn states(&self) -> Vec<GameState> {
        self.sessions.lock().values().map(|s| s.state.clone()).collect()
    }

    /// Läuft oder wird gerade gestartet.
    pub fn is_running(&self, instance_id: &str) -> bool {
        self.sessions.lock().get(instance_id).is_some_and(|s| s.state.state != RunState::Stopped)
    }

    /// Prozess läuft (nicht nur Vorbereitung).
    pub fn is_process_running(&self, instance_id: &str) -> bool {
        self.sessions.lock().get(instance_id).is_some_and(|s| s.state.state == RunState::Running)
    }

    pub(crate) fn any_running(&self) -> bool {
        self.sessions.lock().values().any(|s| s.state.state == RunState::Running)
    }

    fn emit_state(&self, st: &GameState) {
        events::emit(&self.app, events::GAME_STATE, st);
    }

    fn ensure_flusher(&self) {
        self.flusher.call_once(|| {
            let me = self.me.clone();
            tauri::async_runtime::spawn(async move {
                loop {
                    tokio::time::sleep(Duration::from_millis(100)).await;
                    let Some(gm) = me.upgrade() else { break };
                    gm.flush();
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
            events::emit(&self.app, events::GAME_LOG, &serde_json::json!({ "instance_id": id, "lines": lines }));
        }
    }

    /// Neue Sitzung beginnen (Zustand "preparing"). Fehler, wenn die Instanz schon läuft.
    pub fn begin(&self, instance_id: &str) -> AppResult<()> {
        self.ensure_flusher();
        let st = {
            let mut map = self.sessions.lock();
            if map.get(instance_id).is_some_and(|s| s.state.state != RunState::Stopped) {
                return Err(AppError::Invalid("Die Instanz läuft bereits oder wird gerade gestartet.".into()));
            }
            let st = GameState {
                instance_id: instance_id.to_string(),
                state: RunState::Preparing,
                pid: None,
                started_at: None,
                exit_code: None,
                crashed: false,
                crash_report: None,
            };
            map.insert(
                instance_id.to_string(),
                Session { state: st.clone(), log: VecDeque::new(), seq: 0, pending: Vec::new(), killed: false, task_id: None, secret: None },
            );
            st
        };
        self.emit_state(&st);
        Ok(())
    }

    pub fn set_task(&self, instance_id: &str, task_id: &str) {
        if let Some(s) = self.sessions.lock().get_mut(instance_id) {
            s.task_id = Some(task_id.to_string());
        }
    }

    /// Token, das in Ausgaben der Sitzung unkenntlich gemacht wird.
    pub fn set_secret(&self, instance_id: &str, secret: &str) {
        if secret.len() < 8 {
            return;
        }
        if let Some(s) = self.sessions.lock().get_mut(instance_id) {
            s.secret = Some(secret.to_string());
        }
    }

    /// Vorbereitung gescheitert/abgebrochen -> "stopped".
    pub fn fail(&self, instance_id: &str, err: &AppError) {
        if !matches!(err, AppError::Cancelled) {
            self.launcher_line(instance_id, LogLevel::Error, format!("Start fehlgeschlagen: {err}"));
        } else {
            self.launcher_line(instance_id, LogLevel::Launcher, "Start abgebrochen.".to_string());
        }
        let st = {
            let mut map = self.sessions.lock();
            let Some(s) = map.get_mut(instance_id) else { return };
            if s.state.state == RunState::Running {
                return;
            }
            s.state.state = RunState::Stopped;
            s.state.clone()
        };
        self.emit_state(&st);
    }

    pub fn push(&self, instance_id: &str, lines: Vec<Parsed>) {
        if lines.is_empty() {
            return;
        }
        let mut map = self.sessions.lock();
        let Some(s) = map.get_mut(instance_id) else { return };
        for p in lines {
            s.seq += 1;
            let text = match &s.secret {
                Some(t) if p.text.contains(t.as_str()) => p.text.replace(t.as_str(), "••••••"),
                _ => p.text,
            };
            let l = LogLine { seq: s.seq, time: p.time, level: p.level, thread: p.thread, logger: p.logger, text };
            if s.log.len() >= MAX_LINES {
                s.log.pop_front();
            }
            s.log.push_back(l.clone());
            s.pending.push(l);
        }
    }

    /// Eigene Meldung des Launchers ins Log.
    pub fn launcher_line(&self, instance_id: &str, level: LogLevel, text: String) {
        let time = Some(chrono::Local::now().format("%H:%M:%S").to_string());
        let lines = text
            .lines()
            .map(|t| Parsed { time: time.clone(), level, thread: None, logger: Some("Vibe Launcher".into()), text: t.to_string() })
            .collect();
        self.push(instance_id, lines);
    }

    pub fn session_log(&self, instance_id: &str) -> Vec<LogLine> {
        self.sessions.lock().get(instance_id).map(|s| s.log.iter().cloned().collect()).unwrap_or_default()
    }

    /// Prozess(baum) beenden bzw. laufende Vorbereitung abbrechen.
    pub fn kill(&self, state: &AppState, instance_id: &str) -> AppResult<()> {
        let (pid, task) = {
            let mut map = self.sessions.lock();
            let s = map.get_mut(instance_id).ok_or_else(|| AppError::Invalid("Die Instanz läuft nicht.".into()))?;
            if s.state.state == RunState::Stopped {
                return Err(AppError::Invalid("Die Instanz läuft nicht.".into()));
            }
            s.killed = true;
            (s.state.pid, s.task_id.clone())
        };
        match pid {
            Some(pid) => {
                self.launcher_line(instance_id, LogLevel::Launcher, "Spiel wird beendet …".into());
                kill_tree(pid);
            }
            None => {
                if let Some(t) = task {
                    state.tasks.cancel(&t);
                }
            }
        }
        Ok(())
    }

    /// Nicht selbst gestarteten Prozess (Bedrock) als laufend melden. Die Sitzung muss mit `begin` angelegt sein.
    pub fn mark_running(&self, instance_id: &str, pid: Option<u32>, started_ms: i64) {
        let st = {
            let mut map = self.sessions.lock();
            map.get_mut(instance_id).map(|s| {
                s.state.state = RunState::Running;
                s.state.pid = pid;
                s.state.started_at = Some(started_ms);
                s.state.clone()
            })
        };
        if let Some(st) = st {
            self.emit_state(&st);
        }
    }

    /// Externe Sitzung beendet (Bedrock). Meldung kommt ins Log.
    pub fn mark_stopped(&self, instance_id: &str, crashed: bool, msg: String) {
        self.launcher_line(instance_id, if crashed { LogLevel::Error } else { LogLevel::Launcher }, msg);
        self.flush();
        let st = {
            let mut map = self.sessions.lock();
            map.get_mut(instance_id).map(|s| {
                s.state.state = RunState::Stopped;
                s.state.crashed = crashed;
                s.state.clone()
            })
        };
        if let Some(st) = st {
            self.emit_state(&st);
        }
    }

    /// Wurde die Sitzung über „Stoppen“ beendet?
    pub fn was_killed(&self, instance_id: &str) -> bool {
        self.sessions.lock().get(instance_id).is_some_and(|s| s.killed)
    }

    /// Gestarteten Prozess übernehmen: Ausgabe lesen, auf Ende warten, Zustand melden.
    pub fn attach(&self, state: AppState, instance_id: String, mut child: tokio::process::Child) {
        let pid = child.id();
        let started_ms = crate::util::now_ms();
        let started_sys = std::time::SystemTime::now();
        let st = {
            let mut map = self.sessions.lock();
            map.get_mut(&instance_id).map(|s| {
                s.state.state = RunState::Running;
                s.state.pid = pid;
                s.state.started_at = Some(started_ms);
                s.state.clone()
            })
        };
        if let Some(st) = st {
            self.emit_state(&st);
        }
        let _ = state.instances.modify(&instance_id, |i| i.last_played = Some(started_ms));
        apply_launch_behavior(&state, true);

        let me = self.me.clone();
        let stdout = child.stdout.take();
        let stderr = child.stderr.take();
        let mk_reader = |stream: Option<Box<dyn tokio::io::AsyncRead + Unpin + Send>>, is_err: bool| {
            let me = me.clone();
            let id = instance_id.clone();
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
                            let parsed = parser.feed(&line);
                            if let Some(gm) = me.upgrade() {
                                gm.push(&id, parsed);
                            }
                        }
                    }
                }
                if let Some(gm) = me.upgrade() {
                    gm.push(&id, parser.flush());
                }
            })
        };
        let r_out = mk_reader(stdout.map(|s| Box::new(s) as Box<dyn tokio::io::AsyncRead + Unpin + Send>), false);
        let r_err = mk_reader(stderr.map(|s| Box::new(s) as Box<dyn tokio::io::AsyncRead + Unpin + Send>), true);

        let game_dir = self.paths.game_dir(&instance_id);
        tauri::async_runtime::spawn(async move {
            let status = child.wait().await;
            let _ = tokio::time::timeout(Duration::from_secs(3), async {
                let _ = r_out.await;
                let _ = r_err.await;
            })
            .await;
            let Some(gm) = me.upgrade() else { return };
            let code = status.as_ref().ok().and_then(|s| s.code());
            let crash_report = find_new_crash_report(&game_dir, started_sys);
            let killed = gm.sessions.lock().get(&instance_id).is_some_and(|s| s.killed);
            let crashed = !killed && (crash_report.is_some() || code.is_some_and(|c| c != 0) || status.is_err());
            let secs = (crate::util::now_ms() - started_ms).max(0) as u64 / 1000;
            let msg = match (killed, crashed, code) {
                (true, _, _) => "Spiel wurde beendet.".to_string(),
                (_, true, Some(c)) => format!("Spiel ist abgestürzt (Exit-Code {c})."),
                (_, true, None) => "Spiel ist abgestürzt.".to_string(),
                _ => format!("Spiel beendet (Exit-Code {}).", code.unwrap_or(0)),
            };
            gm.launcher_line(&instance_id, if crashed { LogLevel::Error } else { LogLevel::Launcher }, msg);
            if let Some(r) = &crash_report {
                gm.launcher_line(&instance_id, LogLevel::Error, format!("Crash-Report: {r}"));
            }
            gm.flush();
            let st = {
                let mut map = gm.sessions.lock();
                map.get_mut(&instance_id).map(|s| {
                    s.state.state = RunState::Stopped;
                    s.state.exit_code = code;
                    s.state.crashed = crashed;
                    s.state.crash_report = crash_report.clone();
                    s.state.clone()
                })
            };
            if let Some(st) = st {
                gm.emit_state(&st);
            }
            let _ = state.instances.modify(&instance_id, |i| i.play_time_secs = i.play_time_secs.saturating_add(secs));
            // Post-Exit-Hook der Instanz (Fehler nur ins Log)
            if let Ok(inst) = state.instances.get(&instance_id) {
                if let Some(cmd) = inst.hooks.post_exit.clone().filter(|c| !c.trim().is_empty()) {
                    if let Err(e) = super::hooks::run(&state, &inst, "Post-Exit", &cmd, None).await {
                        gm.launcher_line(&instance_id, LogLevel::Error, e.to_string());
                    }
                }
            }
            if !gm.any_running() {
                apply_launch_behavior(&state, false);
            }
        });
    }
}

fn find_new_crash_report(game_dir: &std::path::Path, since: std::time::SystemTime) -> Option<String> {
    let rd = std::fs::read_dir(game_dir.join("crash-reports")).ok()?;
    let since = since - Duration::from_secs(2);
    let mut best: Option<(std::time::SystemTime, String)> = None;
    for e in rd.flatten() {
        let Ok(m) = e.metadata() else { continue };
        let Ok(t) = m.modified() else { continue };
        if m.is_file() && t >= since && best.as_ref().is_none_or_older(t) {
            best = Some((t, e.path().to_string_lossy().to_string()));
        }
    }
    best.map(|(_, p)| p)
}

trait OlderExt {
    fn is_none_or_older(&self, t: std::time::SystemTime) -> bool;
}
impl OlderExt for Option<&(std::time::SystemTime, String)> {
    fn is_none_or_older(&self, t: std::time::SystemTime) -> bool {
        self.map(|(b, _)| *b < t).unwrap_or(true)
    }
}

/// Ganzen Prozessbaum beenden.
pub fn kill_tree(pid: u32) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let _ = std::process::Command::new("taskkill")
            .args(["/F", "/T", "/PID", &pid.to_string()])
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .creation_flags(super::java::CREATE_NO_WINDOW)
            .status();
    }
    #[cfg(unix)]
    {
        // Spiel läuft in eigener Prozessgruppe (pgid = pid)
        let _ = std::process::Command::new("kill").args(["-KILL", &format!("-{pid}")]).status();
        let _ = std::process::Command::new("kill").args(["-KILL", &pid.to_string()]).status();
    }
}

/// `settings.launch_behavior`: Launcher während des Spiels minimieren/verstecken, danach zeigen.
pub(crate) fn apply_launch_behavior(state: &AppState, started: bool) {
    use crate::settings::LaunchBehavior;
    let behavior = state.settings().launch_behavior;
    if behavior == LaunchBehavior::Keep {
        return;
    }
    let Some(w) = state.app.get_webview_window("main") else { return };
    if started {
        match behavior {
            LaunchBehavior::Minimize => {
                let _ = w.minimize();
            }
            LaunchBehavior::Hide => {
                let _ = w.hide();
            }
            LaunchBehavior::Keep => {}
        }
    } else {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}
