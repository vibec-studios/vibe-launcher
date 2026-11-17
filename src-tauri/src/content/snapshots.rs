//! PLATZHALTER – wird durch die Implementierung aus dem Backups-Branch ersetzt (gleiche Signaturen).
use crate::error::AppResult;
use crate::state::AppState;
use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct SnapshotInfo {
    pub id: String,
    pub name: String,
    pub created: i64,
    pub auto: bool,
    pub file_count: u32,
    pub size: u64,
}

/// Snapshot anlegen. `auto` = automatisch (zählt zur Aufbewahrungsgrenze).
pub async fn create(_state: &AppState, _instance_id: &str, name: &str, auto: bool, _progress: Option<&crate::tasks::SubProgress>) -> AppResult<SnapshotInfo> {
    Ok(SnapshotInfo { id: String::new(), name: name.to_string(), created: 0, auto, file_count: 0, size: 0 })
}
