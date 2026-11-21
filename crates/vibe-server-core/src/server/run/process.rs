use super::*;

impl ServerManager {
    /// Prozess übernehmen.
    pub(super) fn attach(&self, state: Core, id: String, mut child: tokio::process::Child) {
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
            crate::rt::spawn(async move {
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
            crate::rt::spawn(async move {
                let Some(stream) = stream else { return };
                let mut reader = tokio::io::BufReader::with_capacity(64 * 1024, stream);
                let mut parser = LineParser::new(is_err);
                let mut log4shell = crate::minecraft::log4shell::Watch::default();
                let mut buf = Vec::new();
                loop {
                    buf.clear();
                    match reader.read_until(b'\n', &mut buf).await {
                        Ok(0) | Err(_) => break,
                        Ok(_) => {
                            let line = decode_line(&buf);
                            let warnings = log4shell.check(&line);
                            let mut parsed = parser.feed(&line);
                            // JVM-Hinweise auf stderr („WARNING: …“) sind keine Fehler
                            for p in parsed.iter_mut() {
                                paper_line(p);
                                if p.level == LogLevel::Stderr && p.text.starts_with("WARNING:") {
                                    p.level = LogLevel::Warn;
                                }
                            }
                            if let Some(m) = me.upgrade() {
                                let texts: Vec<String> = parsed.iter().map(|p| p.text.clone()).collect();
                                m.push(&id, parsed);
                                for w in warnings {
                                    m.launcher_line(&id, LogLevel::Warn, w);
                                }
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

        crate::rt::spawn(async move {
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
}
