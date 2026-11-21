use super::*;

impl GameManager {
    pub(super) async fn finish(&self, state: AppState, run_id: String, instance_id: String, started_sys: std::time::SystemTime, code: Option<i32>, status_err: bool) {
        let gm = self;
        let game_dir = self.paths.game_dir(&instance_id);
        let (killed, concurrent) = {
            let reg = gm.reg.lock();
            (reg.get(&run_id).is_some_and(|s| s.killed), reg.had_concurrent(&run_id))
        };
        let failed = code.is_some_and(|c| c != 0) || status_err;
        let crash_report = if killed || (concurrent && !failed) {
            None
        } else {
            super::attach::find_new_crash_report(&game_dir, started_sys).filter(|r| gm.reg.lock().claim_report(r))
        };
        let crashed = !killed && (crash_report.is_some() || failed);
        let msg = match (killed, crashed, code) {
            (true, _, _) => "Spiel wurde beendet.".to_string(),
            (_, true, Some(c)) => format!("Spiel ist abgestürzt (Exit-Code {c})."),
            (_, true, None) => "Spiel ist abgestürzt.".to_string(),
            (_, _, None) => "Spiel beendet.".to_string(),
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
        crate::afk::on_exit(&state, &run_id, &instance_id);
        super::super::resume::forget(&state, &run_id);
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
    }
}
