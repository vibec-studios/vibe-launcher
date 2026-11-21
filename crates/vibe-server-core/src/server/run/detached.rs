use super::*;
use crate::minecraft::adopt::{self, ProcInfo, START_TOLERANCE_SECS};
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};

pub(super) fn plausible(p: &ProcInfo, pid_written_secs: u64, dir: &Path) -> bool {
    adopt::is_java(p) && p.start_secs <= pid_written_secs + START_TOLERANCE_SECS && p.cwd.as_deref().map_or(true, |c| adopt::same_path(c, dir))
}

pub(super) fn probe(pidf: &Path, pid: u32, dir: &Path) -> Option<u64> {
    let p = adopt::info(pid)?;
    let written = std::fs::metadata(pidf).and_then(|m| m.modified()).ok()?.duration_since(std::time::UNIX_EPOCH).ok()?.as_secs();
    plausible(&p, written, dir).then_some(p.start_secs)
}

impl ServerManager {
    pub(super) fn resume_detached(&self, state: &Core, id: &str, pid: u32, start_secs: u64) {
        self.ensure_flusher();
        self.update(id, |x| {
            x.status.state = RunState::Running;
            x.status.pid = Some(pid);
            x.status.detached = true;
            x.status.started_at = Some((start_secs as i64) * 1000);
        });
        self.launcher_line(id, LogLevel::Launcher, "Server läuft noch aus einer früheren Sitzung. Die Konsole liest logs/latest.log mit, Befehle gehen erst nach einem Neustart des Servers.");
        let stop = Arc::new(AtomicBool::new(false));
        let me = self.me.clone();
        let key = id.to_string();
        let core = state.clone();
        let mut parser = LineParser::new(false);
        let tail = adopt::follow(server_dir(&self.paths, id).join("logs").join("latest.log"), stop.clone(), move |lines| {
            let Some(m) = me.upgrade() else { return };
            let parsed: Vec<Parsed> = lines.iter().flat_map(|l| parser.feed(&decode_line(l))).collect();
            let texts: Vec<String> = parsed.iter().map(|p| p.text.clone()).collect();
            m.push(&key, parsed);
            for t in &texts {
                m.inspect(&core, &key, t);
            }
        });
        start_tunnel(state, id);
        let me = self.me.clone();
        let key = id.to_string();
        crate::rt::spawn(async move {
            adopt::wait_exit(pid, start_secs).await;
            stop.store(true, Ordering::Relaxed);
            let _ = tokio::time::timeout(Duration::from_secs(3), tail).await;
            if let Some(m) = me.upgrade() {
                m.stop_tunnel(&key);
                if m.status(&key).is_some_and(|st| st.detached) {
                    m.finish_detached(&key);
                }
            }
        });
    }
}
