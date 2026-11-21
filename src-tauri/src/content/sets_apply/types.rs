use super::*;

// ------------------------------------------------------------------ Vorschau

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ItemStatus {
    /// Wird installiert
    Install,
    /// Schon vorhanden
    Installed,
    /// Für diese Version/diesen Loader nicht verfügbar
    Unavailable,
    /// Verfügbar, verträgt sich aber nicht mit einem vorhandenen Mod (standardmäßig abgewählt)
    Conflict,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AltKind {
    /// Dasselbe Projekt für eine ältere Minecraft-Version
    OlderMc,
    /// Ein anderes Projekt mit demselben Zweck
    OtherProject,
}

#[derive(Debug, Clone, Serialize)]
pub struct Alternative {
    pub kind: AltKind,
    pub source: Source,
    pub project_id: String,
    pub title: String,
    pub icon_url: Option<String>,
    pub version_id: String,
    pub version_number: String,
    /// Bei `older_mc`: Minecraft-Version der Datei
    pub mc_version: Option<String>,
    /// Bekannter, bewährter Ersatz -> vorausgewählt
    pub recommended: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct DepInfo {
    pub key: String,
    pub title: String,
    pub icon_url: Option<String>,
    pub version_number: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct PreviewItem {
    pub key: String,
    pub entry: SetEntry,
    /// Sets, aus denen der Eintrag stammt
    pub set_ids: Vec<String>,
    pub status: ItemStatus,
    pub version_id: Option<String>,
    pub version_number: Option<String>,
    pub file_name: Option<String>,
    pub kind: Option<ContentKind>,
    pub reason: Option<Reason>,
    /// Fehlertext bei `failed`
    pub message: Option<String>,
    pub loaders: Vec<String>,
    pub mc_range: Option<(String, String)>,
    pub alternatives: Vec<Alternative>,
    /// Namen vorhandener Mods, mit denen es sich beißt
    pub conflicts: Vec<String>,
    /// Pflicht-Abhängigkeiten, die zusätzlich installiert werden
    pub deps: Vec<DepInfo>,
    /// Datei muss evtl. von Hand auf CurseForge geladen werden
    pub manual: bool,
    /// Bei `installed`: Name der vorhandenen Datei, falls nicht über Vibe zugeordnet
    pub installed_as: Option<String>,
    /// Bei `installed`: nicht nötig, weil ein Ersatzprojekt mit demselben Zweck schon installiert ist
    pub covered_by: Option<String>,
    /// Standardauswahl
    pub selected: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct SetPreview {
    pub instance_id: String,
    pub mc_version: String,
    pub loader: LoaderKind,
    pub items: Vec<PreviewItem>,
}

/// Was in der Instanz schon liegt (für „schon da“ und Konflikte).
pub(super) struct Present {
    pub(super) idx: ContentIndex,
    pub(super) mod_ids: HashSet<String>,
    pub(super) names: HashMap<String, String>,
}
