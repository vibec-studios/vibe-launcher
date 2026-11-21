//! Erweiterungen eines Servers: Plugins (`plugins/`, Paper/Purpur/Folia) bzw. Mods (`mods/`, Fabric & Co.).
//! Liste mit Metadaten (plugin.yml / paper-plugin.yml / fabric.mod.json …), Suche und Installation über
//! Modrinth (Projekttyp „plugin“ bzw. „mod“) und Hangar (hangar.papermc.io, nur Plugins), Updates,
//! Aktivieren/Deaktivieren (`.disabled`), Entfernen.
//!
//! Herkunft installierter Dateien steht in `<server>/vibe-addons.json` (nicht im Plugin-Ordner, damit
//! der Server sie nicht sieht). Modrinth-Dateien werden zusätzlich per SHA-1 erkannt.
use super::{server_dir, Server};
use crate::content::{http, meta, modrinth as mr, ContentKind};
use crate::error::{AppError, AppResult};
use crate::model::LoaderKind;
use crate::net::DownloadItem;
use crate::Core;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};

mod yml;
pub use yml::*;
mod local;
pub use local::*;
mod search;
pub use search::*;
mod project;
pub use project::*;
mod resolve;
pub use resolve::*;
mod install;
pub use install::*;

const INDEX_FILE: &str = "vibe-addons.json";
const HANGAR: &str = "https://hangar.papermc.io/api/v1";

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AddonSource {
    Modrinth,
    Hangar,
}

/// Was der Server lädt und wo es liegt.
#[derive(Debug, Clone, Serialize)]
pub struct AddonTarget {
    /// "plugins" | "mods"
    pub folder: &'static str,
    pub plugins: bool,
    /// Modrinth-Loader (Reihenfolge = Vorzug)
    pub loaders: Vec<String>,
    pub mc: String,
    /// Hangar-Plattform (nur Paper/Purpur)
    pub hangar: Option<&'static str>,
}

pub fn target(s: &Server) -> Option<AddonTarget> {
    target_for(&s.mc_version, s.loader.kind, s.platform.as_ref().map(|p| p.kind))
}

pub fn target_for(mc: &str, loader: LoaderKind, platform: Option<super::platform::PlatformKind>) -> Option<AddonTarget> {
    let (folder, plugins, loaders, hangar): (&'static str, bool, Vec<String>, Option<&'static str>) = match platform {
        Some(p) => ("plugins", true, p.plugin_loaders().iter().map(|l| l.to_string()).collect(), (p != super::platform::PlatformKind::Folia).then_some("PAPER")),
        None => {
            let l: Vec<String> = match loader {
                LoaderKind::Vanilla => return None,
                LoaderKind::Quilt => vec!["quilt".into(), "fabric".into()],
                k => vec![k.as_str().to_string()],
            };
            ("mods", false, l, None)
        }
    };
    Some(AddonTarget { folder, plugins, loaders, mc: mc.to_string(), hangar })
}

// ------------------------------------------------------------------ Herkunfts-Index

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct IndexEntry {
    pub source: Option<AddonSource>,
    pub project_id: Option<String>,
    pub slug: Option<String>,
    pub version_id: Option<String>,
    pub version_name: Option<String>,
    pub title: Option<String>,
    pub icon_url: Option<String>,
}

#[derive(Debug, Default, Serialize, Deserialize)]
struct IndexFile {
    #[serde(default)]
    files: HashMap<String, IndexEntry>,
}

pub fn base_name(file: &str) -> &str {
    file.strip_suffix(".disabled").unwrap_or(file)
}

fn load_index(dir: &Path) -> HashMap<String, IndexEntry> {
    std::fs::read(dir.join(INDEX_FILE)).ok().and_then(|b| serde_json::from_slice::<IndexFile>(&b).ok()).map(|f| f.files).unwrap_or_default()
}

fn save_index(dir: &Path, files: &HashMap<String, IndexEntry>) -> AppResult<()> {
    crate::util::write_json_atomic(&dir.join(INDEX_FILE), &IndexFile { files: files.clone() })
}

#[cfg(test)]
mod tests;
