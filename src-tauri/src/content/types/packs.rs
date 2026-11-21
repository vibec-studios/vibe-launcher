use super::*;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum PackFormat {
    Mrpack,
    Curseforge,
    Vlpack,
    Prism,
    Multimc,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImportPreview {
    pub format: PackFormat,
    pub name: String,
    pub version_name: Option<String>,
    pub mc_version: String,
    pub loader: Loader,
    /// Anzahl herunterzuladender Dateien (Mods etc.)
    pub file_count: u32,
    /// data:-URL
    pub icon: Option<String>,
    pub author: Option<String>,
    /// Herunterzuladende Dateien mit Client/Server-Einordnung (mrpack `env`; sonst unbekannt)
    #[serde(default)]
    pub files: Vec<ImportFile>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImportFile {
    pub path: String,
    pub side: Side,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ExportOptions {
    pub format: PackFormat,
    /// Zieldatei (vollständiger Pfad)
    pub dest: String,
    pub name: String,
    pub version: String,
    pub author: Option<String>,
    pub description: Option<String>,
    /// Relative Pfade im Spielordner, die als Overrides/Dateien mitkommen (Ordner oder Dateien)
    pub include: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ExportEntry {
    /// Relativer Pfad im Spielordner
    pub path: String,
    pub is_dir: bool,
    pub size: u64,
    /// Standardmäßig ausgewählt (z. B. config/, mods/; nicht saves/, logs/)
    pub default_selected: bool,
}
