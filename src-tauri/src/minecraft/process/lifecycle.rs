use super::*;

impl GameManager {

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
                if s.state.state == super::super::RunState::Stopped {
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
}
