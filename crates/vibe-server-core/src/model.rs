//! Gemeinsame Modelltypen (Loader, Installationszustand).
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
pub enum LoaderKind {
    Vanilla,
    Fabric,
    Quilt,
    Forge,
    Neoforge,
}

impl LoaderKind {
    pub fn as_str(&self) -> &'static str {
        match self {
            LoaderKind::Vanilla => "vanilla",
            LoaderKind::Fabric => "fabric",
            LoaderKind::Quilt => "quilt",
            LoaderKind::Forge => "forge",
            LoaderKind::Neoforge => "neoforge",
        }
    }
    pub fn parse(s: &str) -> Option<Self> {
        Some(match s.to_ascii_lowercase().as_str() {
            "vanilla" | "minecraft" => LoaderKind::Vanilla,
            "fabric" | "fabric-loader" => LoaderKind::Fabric,
            "quilt" | "quilt-loader" => LoaderKind::Quilt,
            "forge" => LoaderKind::Forge,
            "neoforge" | "neo-forge" | "neoforged" => LoaderKind::Neoforge,
            _ => return None,
        })
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Loader {
    pub kind: LoaderKind,
    /// Loader-Version (z. B. "0.16.9" für Fabric, "21.1.77" für NeoForge). `None` bei Vanilla.
    pub version: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum InstallState {
    /// Noch nie installiert / Version geändert
    #[default]
    NotInstalled,
    Installing,
    Installed,
    /// Letzte Installation fehlgeschlagen
    Failed,
}
