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

        super::super::resume::record(&state, &run_id, pid);
        tauri::async_runtime::spawn(async move {
            let status = child.wait().await;
            let _ = tokio::time::timeout(Duration::from_secs(3), async {
                let _ = r_out.await;
                let _ = r_err.await;
            })
            .await;
            let Some(gm) = me.upgrade() else { return };
            let code = status.as_ref().ok().and_then(|s| s.code());
            gm.finish(state, run_id, instance_id, started_sys, code, status.is_err()).await;
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
