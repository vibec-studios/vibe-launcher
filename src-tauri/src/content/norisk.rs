//! Import aus dem NoRisk Client Launcher (NoRiskClient/noriskclient-launcher). Nur lesend.
//!
//! - Wurzel: Windows `%APPDATA%\norisk\NoRiskClientV3`, macOS `~/Library/Application Support/gg.norisk.NoRiskClientV3`,
//!   Linux `~/.local/share/noriskclientv3` (`directories::ProjectDirs("gg","norisk","NoRiskClientV3")`).
//! - Profile: SQLite `meta/app.db` (Tabellen `profiles`, `profile_mods`, `profile_disabled_norisk_mods`, Sync Packs),
//!   ältere Versionen `profiles.json` (JSON-Liste). Die DB wird vor dem Lesen samt WAL kopiert, Spalten werden
//!   per `PRAGMA table_info` abgefragt (ältere Schemata).
//! - Spielordner: `<profiles>/<profile.path>`; mit `use_shared_minecraft_folder` (nicht in den Gruppen
//!   SERVER/MODPACKS) der Gruppenordner `noriskclient/new|legacy` bzw. `groups/<gruppe>`.
//!   `<profiles>` = `data/profiles` (Windows) bzw. `profiles`, oder `<custom_game_directory>/profiles`.
//! - Inhalte: Mods der Profil-Mod-Liste (Modrinth- und CurseForge-Quelle), des gewählten NoRisk-Packs
//!   (`norisk_modpacks.json`, `compatibility[mc][loader].identifier` = Modrinth-Versions-ID, mit
//!   `inheritsFrom`/`excludeMods`) und der abonnierten Sync Packs werden per Modrinth/CurseForge installiert.
//!   Pack-Mods aus dem NoRisk-Maven bzw. per URL (NoRisk-Client-Mods, OptiFine) laufen nur im NoRisk-Launcher.
//!   Lose JARs aus `mods/`, `custom_mods/`, dem eigenen `mods/nrc-<mc>-<loader>[-<xxxx>]` und `sync_packs/<id>/mods/` werden
//!   kopiert, wenn sie zu Version/Loader passen und keine NoRisk-Mods sind.
//! - Globale Einstellungen: [`global`] (nur benannte Felder aus `launcher_config.json`), Sync Packs: [`sync`],
//!   [`syncplan`]; Details in docs/IMPORT-SETTINGS.md.
//! - `accounts.json` (Tokens) wird nie gelesen.

pub use run::run_import;

use super::external::{norm, Found};
use super::extsettings::{select_rows, Row};
use super::{deps, ContentKind, Source};
use crate::error::{AppError, AppResult};
use crate::instance::{Loader, LoaderKind, PackSource};
use banner::Banner;
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};

pub mod banner;
pub mod cache;
pub mod folders;
pub mod global;
pub mod mods;
pub mod options;
mod run;
pub mod standard;
pub mod sync;
pub mod syncplan;
mod paths;
mod profile;
mod pack;
mod plan;
mod loader;
mod scan;
#[cfg(test)]
mod tests;

pub use paths::*;
pub use profile::*;
pub use pack::*;
pub use plan::*;
pub use loader::*;
pub use scan::*;

pub const WARN_NRC: &str = "NoRisk-Client-Mods werden nicht übernommen – sie laufen nur im NoRisk-Launcher.";
