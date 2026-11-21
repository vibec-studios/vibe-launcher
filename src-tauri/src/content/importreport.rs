use super::norisk::mods::Failed;
use crate::error::AppResult;
use crate::state::AppState;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct ImportReport {
    pub launcher: String,
    pub at: i64,
    pub files: u64,
    pub bytes: u64,
    pub mods: Vec<String>,
    pub jars: Vec<String>,
    pub from_cache: Vec<String>,
    pub failed: Vec<Failed>,
    pub locked: Vec<String>,
    pub norisk_only: Vec<String>,
    pub unfit: Vec<String>,
    pub sync_packs: Vec<String>,
    pub warnings: Vec<String>,
}

const FILE: &str = "import-report.json";

pub fn save(state: &AppState, instance_id: &str, r: &ImportReport) -> AppResult<()> {
    crate::util::write_json_atomic(&state.paths.instance_dir(instance_id).join(FILE), r)
}

pub fn load(state: &AppState, instance_id: &str) -> Option<ImportReport> {
    serde_json::from_slice(&std::fs::read(state.paths.instance_dir(instance_id).join(FILE)).ok()?).ok()
}

pub fn mod_files(game: &std::path::Path) -> Vec<String> {
    let mut v: Vec<String> = std::fs::read_dir(game.join("mods"))
        .into_iter()
        .flatten()
        .flatten()
        .map(|e| e.file_name().to_string_lossy().to_string())
        .filter(|n| {
            let l = n.to_ascii_lowercase();
            l.ends_with(".jar") || l.ends_with(".jar.disabled")
        })
        .collect();
    v.sort_by_key(|n| n.to_lowercase());
    v
}
