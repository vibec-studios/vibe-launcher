//! Import direkt aus anderen Launchern: Modrinth App, Prism/MultiMC, CurseForge App, ATLauncher,
//! NoRisk Client (siehe [`super::norisk`]) oder ein beliebiger Spielordner.
//!
//! Fremde Ordner werden **nur gelesen**. Die SQLite-Datenbank der Modrinth App (WAL-Modus, App läuft
//! evtl.) wird vor dem Lesen samt `-wal`/`-shm` nach `cache/tmp/` kopiert.

use super::extsettings::{self, ExtSettings};
use super::import::{loader_from_cf_id, parse_ini, prism_info};
use super::{ExternalInstance, ExternalLauncher, LauncherKind};
use crate::error::{AppError, AppResult};
use crate::instance::{InstallState, Instance, Loader, LoaderKind, PackSource, PackSourceKind};
use crate::state::AppState;
use crate::tasks::TaskHandle;
use serde_json::Value;
use std::collections::HashMap;
use std::path::{Path, PathBuf};

mod util;
mod infer;
mod modrinth_app;
mod prism;
mod curseforge_app;
mod atlauncher;
mod folder;
mod scan;
mod marks;
mod run;
#[cfg(test)]
mod tests;

pub use util::*;
pub use infer::*;
pub use modrinth_app::*;
pub use prism::*;
pub use curseforge_app::*;
pub use atlauncher::*;
use folder::*;
pub use scan::*;
pub(crate) use marks::*;
pub use run::*;

const WARN_GUESSED: &str = "Version und Loader wurden aus den Mods geschätzt – bitte prüfen.";
const WARN_UNKNOWN: &str = "Minecraft-Version unbekannt – bitte vor dem Import angeben.";
const WARN_VERSIONS: &str = "Version aus dem Ordner versions geschätzt (zuletzt gestartet) – bitte prüfen.";

/// Erkannte Instanz inkl. interner Angaben für den Import.
#[derive(Debug, Clone)]
pub struct Found {
    pub info: ExternalInstance,
    /// Spielordner (`.minecraft`)
    pub game_dir: PathBuf,
    pub icon_path: Option<PathBuf>,
    pub pack: Option<PackSource>,
    /// Einstellungen der Instanz im fremden Launcher (siehe [`super::extsettings`])
    pub settings: ExtSettings,
    /// NoRisk: was übernommen/installiert wird
    pub norisk: Option<super::norisk::Plan>,
    /// Zusätzliche Quellen im Spielordner (NoRisk Sync Packs), siehe [`super::srctree`]
    pub overlays: Vec<super::srctree::Overlay>,
}
