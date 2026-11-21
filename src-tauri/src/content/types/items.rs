use super::*;

/// Installierter Inhalt in einer Instanz.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContentItem {
    /// Dateiname im Ordner (inkl. ".disabled", falls deaktiviert)
    pub file_name: String,
    pub kind: ContentKind,
    pub enabled: bool,
    /// Anzeigename (aus Metadaten oder Dateiname)
    pub name: String,
    pub version: Option<String>,
    pub description: Option<String>,
    pub authors: Vec<String>,
    /// data:-URL oder http-URL des Icons
    pub icon: Option<String>,
    pub source: Option<Source>,
    pub project_id: Option<String>,
    pub version_id: Option<String>,
    pub size: u64,
    pub modified: i64,
    /// Version fixiert: kein automatisches Update, nicht bei „Alle aktualisieren“
    #[serde(default)]
    pub pinned: bool,
    /// Client/Server-Einordnung
    #[serde(default = "side_unknown")]
    pub side: Side,
}

fn side_unknown() -> Side {
    Side::Unknown
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContentUpdate {
    pub file_name: String,
    pub kind: ContentKind,
    pub source: Source,
    pub project_id: String,
    pub current_version: Option<String>,
    pub new_version: ProjectVersion,
    /// Neue Datei darf nicht automatisch geladen werden (CurseForge, Autor sperrt Fremd-Downloads, kein
    /// Modrinth-Spiegel) -> nur manuell über `page_url`; „Alle aktualisieren“ überspringt sie.
    #[serde(default)]
    pub manual: bool,
    /// Dateiseite der neuen Version (bei `manual`)
    #[serde(default)]
    pub page_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct World {
    /// Ordnername in saves/
    pub folder: String,
    pub name: String,
    pub last_played: Option<i64>,
    /// "survival" | "creative" | "adventure" | "spectator" | "hardcore"
    pub game_mode: Option<String>,
    /// data:-URL von icon.png
    pub icon: Option<String>,
    pub size: Option<u64>,
}
