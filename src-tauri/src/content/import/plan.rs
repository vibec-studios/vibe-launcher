use super::*;

#[derive(Debug, Clone)]
pub struct PackFile {
    /// Relativer Pfad im Spielordner
    pub path: String,
    pub url: String,
    pub sha1: Option<String>,
    pub size: Option<u64>,
    /// (Quelle, Projekt-ID, Versions-/Datei-ID), falls bekannt
    pub origin: Option<(Source, String, String)>,
    /// Client/Server laut Pack (mrpack `env`)
    pub side: Option<Side>,
}

#[derive(Debug, Clone, Copy)]
pub struct CfRef {
    pub project_id: u64,
    pub file_id: u64,
    pub required: bool,
}

#[derive(Debug, Clone, Default)]
pub struct PrismSettings {
    pub min_memory_mb: Option<u32>,
    pub max_memory_mb: Option<u32>,
    pub jvm_args: Option<String>,
    pub notes: Option<String>,
}

#[derive(Debug, Clone)]
pub struct PackPlan {
    pub format: PackFormat,
    pub name: String,
    pub version_name: Option<String>,
    pub author: Option<String>,
    pub mc_version: String,
    pub loader: Loader,
    pub icon: Option<Vec<u8>>,
    /// Zip-Präfixe, deren Inhalt in den Spielordner kopiert wird (spätere überschreiben frühere)
    pub overrides: Vec<String>,
    pub files: Vec<PackFile>,
    pub cf_files: Vec<CfRef>,
    pub prism: Option<PrismSettings>,
    /// Anzahl Mods im Prism-Export (für die Vorschau)
    pub embedded_mods: u32,
}

impl PackPlan {
    pub fn file_count(&self) -> u32 {
        (self.files.len() + self.cf_files.iter().filter(|f| f.required).count()) as u32 + self.embedded_mods
    }
}
