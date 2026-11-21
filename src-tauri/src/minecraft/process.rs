//! Laufende Spielprozesse: Sitzungen (eine Instanz kann mehrfach laufen), Log-Puffer, Events, Beenden, Crash-Erkennung.
use super::logs::{decode_line, LineParser, Parsed};
use super::sessions::{BeginOpts, Registry};
use super::{GameState, LogLevel, LogLine};
use crate::error::{AppError, AppResult};
use crate::events;
use crate::paths::Paths;
use crate::state::AppState;
use parking_lot::Mutex;
use std::sync::{Arc, Weak};
use std::time::Duration;
use tauri::{AppHandle, Manager};
use tokio::io::AsyncBufReadExt;

/// Verwaltet laufende Spielsitzungen und ihre Log-Puffer. Schlüssel (`key`) ist eine Run-ID oder eine
/// Instanz-ID (dann die neueste, bevorzugt laufende Sitzung der Instanz).
pub struct GameManager {
    paths: Paths,
    app: AppHandle,
    me: Weak<GameManager>,
    reg: Mutex<Registry>,
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
            reg: Mutex::new(Registry::default()),
            flusher: std::sync::Once::new(),
            install_lock: tokio::sync::Mutex::new(()),
        })
    }

    pub fn states(&self) -> Vec<GameState> {
        self.reg.lock().states()
    }

    pub fn state_of(&self, key: &str) -> Option<GameState> {
        self.reg.lock().get(key).map(|s| s.state.clone())
    }

    pub fn spark_report(&self, run_id: &str) -> Option<String> {
        self.reg.lock().get(run_id)?.spark_report.clone()
    }

    pub fn latest_crash(&self, instance_id: &str) -> Option<GameState> {
        self.reg.lock().latest_crash(instance_id)
    }

    /// Mindestens eine Sitzung läuft oder wird gerade gestartet.
    pub fn is_running(&self, instance_id: &str) -> bool {
        self.reg.lock().is_active(instance_id)
    }

    /// Mindestens ein Prozess der Instanz läuft (nicht nur Vorbereitung).
    pub fn is_process_running(&self, instance_id: &str) -> bool {
        self.reg.lock().is_process_running(instance_id)
    }

    pub fn running_count(&self) -> usize {
        self.reg.lock().running_count()
    }

    pub(crate) fn any_running(&self) -> bool {
        self.reg.lock().any_running()
    }

    pub fn active_runs(&self, instance_id: &str) -> Vec<String> {
        self.reg.lock().active_runs(instance_id)
    }

    /// Andere aktive Sitzungen derselben Instanz.
    pub fn others_active(&self, instance_id: &str, run_id: &str) -> usize {
        self.reg.lock().others_active(instance_id, run_id)
    }

    pub fn account_in_use(&self, uuid: &str, except_run: &str) -> Option<GameState> {
        self.reg.lock().account_in_use(uuid, except_run)
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
        let batches = self.reg.lock().take_pending();
        for b in batches {
            events::emit(&self.app, events::GAME_LOG, &serde_json::json!({ "run_id": b.run_id, "instance_id": b.instance_id, "lines": b.lines }));
        }
    }

    /// Neue Sitzung beginnen (Zustand "preparing"). Gibt die Run-ID zurück.
    pub fn begin(&self, instance_id: &str) -> AppResult<String> {
        self.begin_with(instance_id, BeginOpts { exclusive: false, world: None, server: None })
    }

    /// Wie `begin`, aber nur, wenn die Instanz noch nicht läuft (Bedrock).
    pub fn begin_exclusive(&self, instance_id: &str) -> AppResult<String> {
        self.begin_with(instance_id, BeginOpts { exclusive: true, world: None, server: None })
    }

    pub fn begin_with(&self, instance_id: &str, opts: BeginOpts<'_>) -> AppResult<String> {
        self.ensure_flusher();
        let st = self.reg.lock().begin(instance_id, opts, crate::util::now_ms()).map_err(AppError::Invalid)?;
        self.emit_state(&st);
        Ok(st.run_id)
    }

    pub fn set_task(&self, key: &str, task_id: &str) {
        if let Some(s) = self.reg.lock().get_mut(key) {
            s.task_id = Some(task_id.to_string());
        }
    }

    /// Token, das in Ausgaben der Sitzung unkenntlich gemacht wird.
    pub fn set_secret(&self, key: &str, secret: &str) {
        if secret.len() < 8 {
            return;
        }
        if let Some(s) = self.reg.lock().get_mut(key) {
            s.secret = Some(secret.to_string());
        }
    }

    /// Account der Sitzung (für Anzeige und Warnung bei doppelter Nutzung).
    pub fn set_account(&self, run_id: &str, name: &str, uuid: &str) {
        let st = {
            let mut reg = self.reg.lock();
            let Some(s) = reg.get_mut(run_id) else { return };
            s.state.account_name = Some(name.to_string());
            s.state.account_uuid = Some(uuid.replace('-', ""));
            s.state.clone()
        };
        self.emit_state(&st);
    }

    /// Vorbereitung gescheitert/abgebrochen -> "stopped".
    pub fn fail(&self, key: &str, err: &AppError) {
        if !matches!(err, AppError::Cancelled) {
            self.launcher_line(key, LogLevel::Error, format!("Start fehlgeschlagen: {err}"));
        } else {
            self.launcher_line(key, LogLevel::Launcher, "Start abgebrochen.".to_string());
        }
        self.flush();
        let st = {
            let mut reg = self.reg.lock();
            if reg.get(key).is_none_or(|s| s.state.state != super::RunState::Preparing) {
                return;
            }
            reg.mark_stopped(key, crate::util::now_ms(), |_| {})
        };
        if let Some(st) = st {
            self.emit_state(&st);
        }
    }

    pub fn push(&self, key: &str, lines: Vec<Parsed>) {
        if lines.is_empty() {
            return;
        }
        self.reg.lock().push(key, lines);
    }

    /// Eigene Meldung des Launchers ins Log.
    pub fn launcher_line(&self, key: &str, level: LogLevel, text: String) {
        let time = Some(chrono::Local::now().format("%H:%M:%S").to_string());
        let lines = text
            .lines()
            .map(|t| Parsed { time: time.clone(), level, thread: None, logger: Some("Vibe Launcher".into()), text: t.to_string() })
            .collect();
        self.push(key, lines);
    }

    pub fn session_log(&self, key: &str) -> Vec<LogLine> {
        self.reg.lock().get(key).map(|s| s.log.iter().cloned().collect()).unwrap_or_default()
    }

    /// Prozess(baum) beenden bzw. laufende Vorbereitung abbrechen. Mit einer Instanz-ID: alle Sitzungen der Instanz.
    pub fn kill(&self, state: &AppState, key: &str) -> AppResult<()> {
        let runs = {
            let reg = self.reg.lock();
            if reg.is_run(key) {
                vec![key.to_string()]
            } else {
                reg.active_runs(key)
            }
        };
        let mut any = false;
        for run in runs {
            let (pid, task) = {
                let mut reg = self.reg.lock();
                let Some(s) = reg.get_mut(&run) else { continue };
                if s.state.state == super::RunState::Stopped {
                    continue;
                }
                s.killed = true;
                (s.state.pid, s.task_id.clone())
            };
            any = true;
            match pid {
                Some(pid) => {
                    self.launcher_line(&run, LogLevel::Launcher, "Spiel wird beendet …".into());
                    kill_tree(pid);
                }
                None => {
                    if let Some(t) = task {
                        state.tasks.cancel(&t);
                    }
                }
            }
        }
        if !any {
            return Err(AppError::Invalid("Die Instanz läuft nicht.".into()));
        }
        Ok(())
    }

    /// Nicht selbst gestarteten Prozess (Bedrock) als laufend melden. Die Sitzung muss mit `begin` angelegt sein.
    pub fn mark_running(&self, key: &str, pid: Option<u32>, started_ms: i64) {
        let st = self.reg.lock().mark_running(key, pid, started_ms);
        if let Some(st) = st {
            self.emit_state(&st);
        }
    }

    /// Externe Sitzung beendet (Bedrock). Meldung kommt ins Log.
    pub fn mark_stopped(&self, key: &str, crashed: bool, msg: String) {
        self.launcher_line(key, if crashed { LogLevel::Error } else { LogLevel::Launcher }, msg);
        self.flush();
        let st = {
            let mut reg = self.reg.lock();
            let now = crate::util::now_ms();
            let st = reg.mark_stopped(key, now, |s| s.crashed = crashed);
            if let Some(st) = &st {
                reg.clock_stop(&st.instance_id, now);
            }
            st
        };
        if let Some(st) = st {
            self.emit_state(&st);
        }
    }

    /// Wurde die Sitzung über „Stoppen“ beendet?
    pub fn was_killed(&self, key: &str) -> bool {
        self.reg.lock().get(key).is_some_and(|s| s.killed)
    }

    /// Gestarteten Prozess übernehmen: Ausgabe lesen, auf Ende warten, Zustand melden.
    pub fn attach(&self, state: AppState, run_id: String, mut child: tokio::process::Child) {
        let pid = child.id();
        let started_ms = crate::util::now_ms();
        let started_sys = std::time::SystemTime::now();
        let st = self.reg.lock().mark_running(&run_id, pid, started_ms);
        let Some(st) = st else { return };
        let instance_id = st.instance_id.clone();
        self.emit_state(&st);
        let _ = state.instances.modify(&instance_id, |i| i.last_played = Some(started_ms));
        apply_launch_behavior(&state, true);

        let me = self.me.clone();
        let stdout = child.stdout.take();
        let stderr = child.stderr.take();
        let mk_reader = |stream: Option<Box<dyn tokio::io::AsyncRead + Unpin + Send>>, is_err: bool| {
            let me = me.clone();
            let id = run_id.clone();
            tauri::async_runtime::spawn(async move {
                let Some(stream) = stream else { return };
                let mut reader = tokio::io::BufReader::with_capacity(64 * 1024, stream);
                let mut parser = LineParser::new(is_err);
                let mut log4shell = super::log4shell::Watch::default();
                let mut buf = Vec::new();
                loop {
                    buf.clear();
                    match reader.read_until(b'\n', &mut buf).await {
                        Ok(0) | Err(_) => break,
                        Ok(_) => {
                            let line = decode_line(&buf);
                            let warnings = log4shell.check(&line);
                            let parsed = parser.feed(&line);
                            if let Some(gm) = me.upgrade() {
                                gm.push(&id, parsed);
                                for w in warnings {
                                    gm.launcher_line(&id, LogLevel::Warn, w);
                                }
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
            let (killed, concurrent) = {
                let reg = gm.reg.lock();
                (reg.get(&run_id).is_some_and(|s| s.killed), reg.had_concurrent(&run_id))
            };
            let failed = code.is_some_and(|c| c != 0) || status.is_err();
            let crash_report = if killed || (concurrent && !failed) {
                None
            } else {
                find_new_crash_report(&game_dir, started_sys).filter(|r| gm.reg.lock().claim_report(r))
            };
            let crashed = !killed && (crash_report.is_some() || failed);
            let msg = match (killed, crashed, code) {
                (true, _, _) => "Spiel wurde beendet.".to_string(),
                (_, true, Some(c)) => format!("Spiel ist abgestürzt (Exit-Code {c})."),
                (_, true, None) => "Spiel ist abgestürzt.".to_string(),
                _ => format!("Spiel beendet (Exit-Code {}).", code.unwrap_or(0)),
            };
            gm.launcher_line(&run_id, if crashed { LogLevel::Error } else { LogLevel::Launcher }, msg);
            if let Some(r) = &crash_report {
                gm.launcher_line(&run_id, LogLevel::Error, format!("Crash-Report: {r}"));
            }
            if concurrent {
                if let Some(p) = gm.save_session_log(&run_id, &game_dir) {
                    gm.launcher_line(&run_id, LogLevel::Launcher, format!("Sitzungs-Log gespeichert: {}", p.display()));
                }
            }
            gm.flush();
            let (st, secs) = {
                let mut reg = gm.reg.lock();
                let now = crate::util::now_ms();
                let st = reg.mark_stopped(&run_id, now, |s| {
                    s.exit_code = code;
                    s.crashed = crashed;
                    s.crash_report = crash_report.clone();
                });
                (st, reg.clock_stop(&instance_id, now))
            };
            if let Some(st) = st {
                gm.emit_state(&st);
            }
            if let Some(secs) = secs {
                let _ = state.instances.modify(&instance_id, |i| i.play_time_secs = i.play_time_secs.saturating_add(secs));
            }
            if let Ok(inst) = state.instances.get(&instance_id) {
                if let Some(cmd) = inst.hooks.post_exit.clone().filter(|c| !c.trim().is_empty()) {
                    if let Err(e) = super::hooks::run(&state, &inst, &run_id, "Post-Exit", &cmd, None).await {
                        gm.launcher_line(&run_id, LogLevel::Error, e.to_string());
                    }
                }
            }
            if !gm.any_running() {
                apply_launch_behavior(&state, false);
            }
        });
    }

    fn save_session_log(&self, run_id: &str, game_dir: &std::path::Path) -> Option<std::path::PathBuf> {
        let (slot, text) = {
            let reg = self.reg.lock();
            let s = reg.get(run_id)?;
            let text: String = s.log.iter().map(|l| format!("[{}] {}\n", l.time.as_deref().unwrap_or("--:--:--"), l.text)).collect();
            (s.state.slot, text)
        };
        let dir = game_dir.join("logs").join("vibe-sessions");
        let stamp = chrono::Local::now().format("%Y-%m-%d_%H-%M-%S");
        let file = dir.join(format!("{stamp}-session-{slot}.log"));
        std::fs::create_dir_all(&dir).and_then(|_| std::fs::write(&file, text)).ok()?;
        Some(file)
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
