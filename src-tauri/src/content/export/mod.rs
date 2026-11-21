//! Export einer Instanz als `.mrpack`, CurseForge-ZIP oder `.vlpack`.
//! Dateien mit bekannter Herkunft werden als Download-Verweis exportiert, alles andere als Override.

use super::import::{cf_loader_id, VlFile, VlPack};
use super::index::{self, ContentIndex, IndexEntry};
use super::{local, modrinth as mr, *};
use crate::error::{AppError, AppResult};
use crate::state::AppState;
use crate::tasks::TaskHandle;
use crate::util::safe_join;
use serde_json::json;
use std::io::Write;
use std::path::{Path, PathBuf};

mod collect;
mod run;
#[cfg(test)]
mod tests;

pub use collect::*;
pub use run::*;

/// Standardmäßig ausgewählte Einträge (Pack-relevante Ordner/Dateien).
const DEFAULT_ON: &[&str] = &[
    "mods", "config", "defaultconfigs", "kubejs", "scripts", "resourcepacks", "shaderpacks", "datapacks", "global_packs",
    "openloader", "patchouli_books", "options.txt", "optionsshaders.txt", "optionsof.txt",
];
