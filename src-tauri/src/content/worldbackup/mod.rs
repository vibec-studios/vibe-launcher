//! Welt-Backups (ZIP), Welten zwischen Instanzen kopieren, Welten aus ZIP importieren.
//!
//! ```text
//! <data>/backups/worlds/<instanz>/<weltordner>/<zeitstempel>.zip    ZIP mit "<weltordner>/..." als Wurzel
//! <data>/backups/worlds/<instanz>/<weltordner>/<zeitstempel>.json   {world_name, created, size, auto, fingerprint}
//! ```
//! Backup-ID = `"<weltordner>/<zeitstempel>"`. Große Welten werden in `spawn_blocking` gestreamt,
//! Fortschritt nach Bytes, abbrechbar.

use super::snapshots::{valid_name, Prog, Progress};
use crate::error::{AppError, AppResult};
use crate::paths::Paths;
use crate::state::AppState;
use serde::{Deserialize, Serialize};
use sha1::{Digest, Sha1};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

mod paths;
mod archive;
mod ops;
mod api;
#[cfg(test)]
mod tests;

use paths::*;
pub(crate) use archive::*;
use ops::*;
pub use api::*;

#[derive(Debug, Clone, Serialize)]
pub struct WorldBackup {
    /// `"<weltordner>/<zeitstempel>"`
    pub id: String,
    pub folder: String,
    pub world_name: String,
    pub created: i64,
    pub size: u64,
    /// Automatisch angelegt (vor Spielstart / vor Wiederherstellung) – zählt zur Grenze `world_backups_keep`
    pub auto: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Sidecar {
    world_name: String,
    created: i64,
    size: u64,
    #[serde(default)]
    auto: bool,
    #[serde(default)]
    fingerprint: String,
}

/// Dateien, die nie gesichert/kopiert werden (vom laufenden Spiel gesperrt).
const SKIP: &[&str] = &["session.lock"];
