use super::*;

impl GameManager {

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
                let mut log4shell = super::super::log4shell::Watch::default();
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
            crate::minecraft::cds::on_exit(&run_id, crashed, crate::util::now_ms() - started_ms);
            crate::afk::on_exit(&state, &run_id, &instance_id);
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
                    if let Err(e) = super::super::hooks::run(&state, &inst, &run_id, "Post-Exit", &cmd, None).await {
                        gm.launcher_line(&run_id, LogLevel::Error, e.to_string());
                    }
                }
            }
            if !gm.any_running() {
                apply_launch_behavior(&state, false);
            }
        });
    }

    pub(super) fn save_session_log(&self, run_id: &str, game_dir: &std::path::Path) -> Option<std::path::PathBuf> {
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

pub(super) fn find_new_crash_report(game_dir: &std::path::Path, since: std::time::SystemTime) -> Option<String> {
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

pub(super) trait OlderExt {
    fn is_none_or_older(&self, t: std::time::SystemTime) -> bool;
}
impl OlderExt for Option<&(std::time::SystemTime, String)> {
    fn is_none_or_older(&self, t: std::time::SystemTime) -> bool {
        self.map(|(b, _)| *b < t).unwrap_or(true)
    }
}
