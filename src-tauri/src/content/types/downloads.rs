use super::*;

/// Datei, die nicht automatisch geladen werden durfte (CurseForge: Drittanbieter-Download gesperrt).
/// Wird je Instanz in `instances/<id>/missing.json` gespeichert.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MissingDownload {
    pub file_name: String,
    pub project_name: String,
    /// Seite, auf der der Nutzer die Datei manuell herunterladen kann
    pub page_url: String,
    pub kind: ContentKind,
    /// Versionsnummer der erwarteten Datei (falls bekannt)
    #[serde(default)]
    pub version_number: Option<String>,
    /// Ersetzt beim Eintreffen eine ältere Version (manuelles Update)
    #[serde(default)]
    pub is_update: bool,
}

/// Ziel eines manuellen Downloads (für „Auf CurseForge herunterladen“).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ManualTarget {
    /// Dateiseite der passenden Version auf curseforge.com
    pub page_url: String,
    pub file_name: String,
    pub version_id: String,
    pub version_number: String,
    /// Doch automatisch ladbar (Datei freigegeben oder identisch auf Modrinth) -> normal installieren
    pub downloadable: bool,
}

/// Manuell geladene Datei wurde im Download-Ordner gefunden und in die Instanz übernommen
/// (Event `content://manual-arrived`).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ManualArrived {
    pub instance_id: String,
    pub project_id: Option<String>,
    pub project_name: String,
    pub file_name: String,
    pub kind: ContentKind,
}

/// Ergebnis von `content_missing_scan`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MissingScan {
    /// Übernommene Dateien
    pub found: Vec<MissingDownload>,
    /// Noch fehlende Dateien
    pub remaining: Vec<MissingDownload>,
    /// Durchsuchter Ordner (System-Downloads), falls vorhanden
    pub folder: Option<String>,
    /// Download-Ordner wird bis zu diesem Zeitpunkt (ms seit Epoch) weiter beobachtet
    pub watching_until: Option<i64>,
}
