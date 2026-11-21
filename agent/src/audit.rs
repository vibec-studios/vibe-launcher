use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use std::io::Write;
use std::path::PathBuf;
use vibe_server_core::util::now_ms;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuditEntry {
    pub at: i64,
    pub user_id: Option<String>,
    pub user_name: Option<String>,
    pub ip: Option<String>,
    pub via: String,
    pub action: String,
    pub target: Option<String>,
    pub ok: bool,
    pub detail: Option<String>,
}

pub struct Audit {
    path: PathBuf,
    lock: Mutex<()>,
}

const MAX_BYTES: u64 = 8 * 1024 * 1024;

impl Audit {
    pub fn new(path: PathBuf) -> Self {
        Audit { path, lock: Mutex::new(()) }
    }

    pub fn record(&self, mut e: AuditEntry) {
        if e.at == 0 {
            e.at = now_ms();
        }
        let _g = self.lock.lock();
        if std::fs::metadata(&self.path).is_ok_and(|m| m.len() > MAX_BYTES) {
            let _ = std::fs::rename(&self.path, self.path.with_extension("log.1"));
        }
        if let Some(p) = self.path.parent() {
            let _ = std::fs::create_dir_all(p);
        }
        let Ok(line) = serde_json::to_string(&e) else { return };
        if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(&self.path) {
            let _ = writeln!(f, "{line}");
        }
    }

    pub fn read(&self, limit: usize, before: Option<i64>) -> Vec<AuditEntry> {
        let text = std::fs::read_to_string(&self.path).unwrap_or_default();
        text.lines()
            .rev()
            .filter_map(|l| serde_json::from_str::<AuditEntry>(l).ok())
            .filter(|e| before.map_or(true, |b| e.at < b))
            .take(limit.clamp(1, 1000))
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn append_and_read_newest_first() {
        let dir = std::env::temp_dir().join(format!("vibe-agent-audit-{}", crate::crypto::new_id("t")));
        let a = Audit::new(dir.join("audit.log"));
        for (i, act) in ["a", "b", "c"].iter().enumerate() {
            a.record(AuditEntry { at: 100 + i as i64, user_id: None, user_name: None, ip: None, via: "cli".into(), action: act.to_string(), target: None, ok: true, detail: None });
        }
        let all = a.read(10, None);
        assert_eq!(all.iter().map(|e| e.action.as_str()).collect::<Vec<_>>(), vec!["c", "b", "a"]);
        assert_eq!(a.read(10, Some(102)).len(), 2);
        let _ = std::fs::remove_dir_all(dir);
    }
}
