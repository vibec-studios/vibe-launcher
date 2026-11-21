use super::*;

impl ServerManager {
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
        crate::rt::spawn(async move {
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

    pub fn restart(&self, state: &Core, id: &str) -> AppResult<()> {
        if !self.is_active(id) {
            return start(state, id);
        }
        self.sessions.lock().entry(id.to_string()).or_insert_with(|| Session::new(id)).restart_after = true;
        self.stop(id)
    }

    pub(super) fn finish_detached(&self, id: &str) {
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

    pub(super) fn stop_tunnel(&self, id: &str) {
        let t = self.sessions.lock().get_mut(id).and_then(|s| s.tunnel_cancel.take());
        if let Some(t) = t {
            t.cancel();
        }
    }
}

impl ServerManager {
    /// Beim Launcher-Start: Server aus früheren Sitzungen erkennen, Auto-Start.
    pub fn on_startup(&self, state: &Core) {
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
                crate::rt::spawn(async move {
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

/// Tunnel der gewählten Verbindungsart starten (nachdem der Server bereit ist).
pub fn start_tunnel(state: &Core, id: &str) {
    let Ok(s) = state.servers.get(id) else { return };
    let mgr = state.server_mgr.clone();
    mgr.stop_tunnel(id);
    let token = CancellationToken::new();
    match s.connection {
        ServerConnection::Local => return,
        ServerConnection::Relay => {
            if !state.host.hosting_enabled() {
                mgr.set_tunnel(id, Some(TunnelStatus {
                    message: Some(state.host.hosting_disabled_message()),
                    ..TunnelStatus::new(ServerConnection::Relay, TunnelState::Error)
                }));
                return;
            }
            crate::server::relay::spawn(state.clone(), id.to_string(), token.clone());
        }
        ServerConnection::Playit => crate::server::playit::spawn(state.clone(), id.to_string(), token.clone()),
    }
    let mut map = mgr.sessions.lock();
    if let Some(sess) = map.get_mut(id) {
        sess.tunnel_cancel = Some(token);
    }
}

/// Verbindungsart geändert, während der Server läuft -> Tunnel neu starten.
pub fn restart_tunnel_if_running(state: &Core, id: &str) {
    let mgr = state.server_mgr.clone();
    if mgr.status(id).is_some_and(|s| s.state == RunState::Running) {
        mgr.stop_tunnel(id);
        mgr.set_tunnel(id, None);
        start_tunnel(state, id);
    }
}
