use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

pub const FILE: &str = "running-games.json";
static LOCK: Mutex<()> = Mutex::new(());

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct AfkRecord {
    pub background: bool,
    pub requested: bool,
    pub agent: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub agent_version: Option<String>,
    pub overlay: bool,
    pub files: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Record {
    pub run_id: String,
    pub instance_id: String,
    pub slot: u32,
    pub pid: u32,
    pub start_secs: u64,
    pub started_at: i64,
    pub game_dir: PathBuf,
    pub log_path: PathBuf,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub account_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub account_uuid: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub world: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub server: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub afk: Option<AfkRecord>,
    #[serde(default)]
    pub external: bool,
}

pub fn path(root: &Path) -> PathBuf {
    root.join(FILE)
}

pub fn load(root: &Path) -> Vec<Record> {
    std::fs::read(path(root)).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default()
}

fn write(root: &Path, list: &[Record]) -> std::io::Result<()> {
    let p = path(root);
    if list.is_empty() {
        return match std::fs::remove_file(&p) {
            Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(e),
            _ => Ok(()),
        };
    }
    let tmp = p.with_extension("json.tmp");
    std::fs::write(&tmp, serde_json::to_vec_pretty(list).unwrap_or_default())?;
    std::fs::rename(&tmp, &p)
}

pub fn update(root: &Path, f: impl FnOnce(&mut Vec<Record>)) {
    let _g = LOCK.lock();
    let mut list = load(root);
    let before = list.clone();
    f(&mut list);
    if list != before {
        if let Err(e) = write(root, &list) {
            tracing::warn!("Laufende Sitzungen nicht speicherbar: {e}");
        }
    }
}

pub fn upsert(root: &Path, rec: Record) {
    update(root, |l| {
        l.retain(|r| r.run_id != rec.run_id && r.pid != rec.pid);
        l.push(rec);
    });
}

pub fn remove(root: &Path, run_id: &str) {
    update(root, |l| l.retain(|r| r.run_id != run_id));
}

pub fn replace(root: &Path, list: Vec<Record>) {
    update(root, |l| *l = list);
}
