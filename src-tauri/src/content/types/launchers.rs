use super::*;

/// Anderer Launcher, aus dem Instanzen übernommen werden können.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
pub enum LauncherKind {
    Modrinth,
    Prism,
    Multimc,
    Curseforge,
    Atlauncher,
    Gdlauncher,
    /// NoRisk Client Launcher (Profile aus `meta/app.db`)
    Norisk,
    /// Beliebiger Spielordner ohne Launcher-Metadaten (nur über `launcher_scan_dir`)
    Folder,
}

#[derive(Debug, Clone, Serialize)]
pub struct ExternalInstance {
    /// Instanzordner im fremden Launcher (Kennung für `import_external`)
    pub source_path: String,
    pub name: String,
    /// Leer, wenn unbekannt (dann `warning` gesetzt)
    pub mc_version: String,
    pub loader: Loader,
    /// data:-URL
    pub icon: Option<String>,
    pub mod_count: u32,
    /// ms seit Epoch
    pub last_played: Option<i64>,
    pub play_time_secs: Option<u64>,
    /// Größe in Bytes (bei der Erkennung nicht berechnet)
    pub size: Option<u64>,
    /// z. B. "Version/Loader aus den Mods geschätzt – bitte prüfen"
    pub warning: Option<String>,
    /// ID der Vibe-Instanz, falls diese Instanz schon importiert wurde
    pub imported_as: Option<String>,
    /// Einstellungen der Instanz im fremden Launcher (RAM, Java, Fenster …), `None` = keine gefunden
    pub settings: Option<extsettings::ExtSettings>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ExternalLauncher {
    pub id: LauncherKind,
    pub name: String,
    /// Wurzelordner des Launchers bzw. gewählter Ordner
    pub path: String,
    pub instances: Vec<ExternalInstance>,
}
