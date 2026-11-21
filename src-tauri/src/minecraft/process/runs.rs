use super::*;

impl GameManager {

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
            if reg.get(key).is_none_or(|s| s.state.state != super::super::RunState::Preparing) {
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
        crate::afk::observe_log(key, &lines);
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
}
