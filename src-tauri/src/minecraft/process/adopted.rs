use super::*;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use vibe_server_core::minecraft::adopt;

impl GameManager {
    pub fn adopt_running(&self, state: AppState, st: GameState, start_secs: u64, log_path: PathBuf) -> GameState {
        self.ensure_flusher();
        let st = self.reg.lock().adopt(st);
        self.emit_state(&st);
        let pid = st.pid.unwrap_or(0);
        let run_id = st.run_id.clone();
        let instance_id = st.instance_id.clone();
        let since = st.started_at.map(|t| chrono::DateTime::from_timestamp_millis(t).map(|d| d.with_timezone(&chrono::Local).format("%H:%M").to_string())).flatten().unwrap_or_default();
        let how = if st.resumed.as_deref() == Some("external") { "Laufendes Spiel erkannt (nicht von diesem Launcher-Start gestartet)" } else { "Sitzung wiederaufgenommen" };
        self.launcher_line(&run_id, LogLevel::Launcher, format!("{how} – PID {pid}, läuft seit {since}. Frühere Ausgaben stehen in {}.", log_path.display()));
        let stop = Arc::new(AtomicBool::new(false));
        let me = self.me.clone();
        let id = run_id.clone();
        let mut parser = LineParser::new(false);
        let tail = adopt::follow(log_path, stop.clone(), move |lines| {
            let Some(gm) = me.upgrade() else { return };
            let parsed: Vec<Parsed> = lines.iter().flat_map(|l| parser.feed(&decode_line(l))).collect();
            gm.push(&id, parsed);
        });
        let me = self.me.clone();
        let started_sys = std::time::UNIX_EPOCH + Duration::from_secs(start_secs);
        tauri::async_runtime::spawn(async move {
            let code = adopt::wait_exit(pid, start_secs).await;
            stop.store(true, Ordering::Relaxed);
            let _ = tokio::time::timeout(Duration::from_secs(3), tail).await;
            let Some(gm) = me.upgrade() else { return };
            gm.finish(state, run_id, instance_id, started_sys, code, false).await;
        });
        st
    }
}
