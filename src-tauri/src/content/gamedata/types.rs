use super::*;

// ------------------------------------------------------------------ Vergleich (Nachimport)

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DataKind {
    File,
    Dir,
    World,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DataStatus {
    /// Fehlt in Vibe ganz (war beim Import noch nicht da bzw. wurde damals nicht übernommen)
    Missing,
    /// Ordner da, aber einzelne Dateien fehlen
    Partial,
    /// In der Quelle neuer (nach dem Import im alten Launcher geändert)
    Newer,
    /// Unterschiedlich, die Vibe-Fassung ist neuer (nur [`ALWAYS_COMPARE`])
    Changed,
    /// Kam beim Import mit, wurde in Vibe aber gelöscht – nicht vorausgewählt
    Removed,
}

/// Ein Eintrag im Abschnitt „Dateien“.
#[derive(Debug, Clone, Serialize)]
pub struct DataEntry {
    /// Relativ zum Spielordner, mit `/`: `xaero`, `options.txt`, `saves/Meine Welt`
    pub path: String,
    pub kind: DataKind,
    /// Weltname aus `level.dat`
    pub name: Option<String>,
    pub status: DataStatus,
    /// Größe in der Quelle (Bytes)
    pub size: u64,
    /// Dateien, die beim Hinzufügen kopiert würden
    pub missing_files: u32,
    pub missing_size: u64,
    /// Dateien, die beim ausdrücklichen Überschreiben ersetzt würden
    pub overwrite_files: u32,
    pub overwrite_size: u64,
    /// Vorausgewählt (nur Hinzufügen, nie Überschreiben)
    pub default_on: bool,
}

/// Auswahl im Dialog: Eintrag übernehmen, optional überschreiben.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct DataPick {
    pub path: String,
    #[serde(default)]
    pub overwrite: bool,
}

/// Was beim Import geschah (aus `external.json`).
#[derive(Debug, Clone, Default)]
pub struct Prior {
    pub launcher: Option<LauncherKind>,
    pub imported_at: i64,
    /// Beim Import übernommene Einträge der obersten Ebene; `None` bei älteren Importen
    pub copied: Option<Vec<String>>,
}

impl Prior {
    /// Wurde dieser Eintrag der obersten Ebene beim Import übernommen?
    pub(super) fn took(&self, top: &str) -> bool {
        match &self.copied {
            Some(list) => list.iter().any(|c| c.eq_ignore_ascii_case(top)),
            // Ältere Importe: NoRisk nach fester Liste, alle anderen den ganzen Spielordner
            None if self.launcher == Some(LauncherKind::Norisk) => LEGACY_NORISK_COPY.iter().any(|c| c.eq_ignore_ascii_case(top)),
            None => true,
        }
    }
    /// Gab es die Datei schon beim Import (Erstellzeit, ersatzweise Änderungszeit)?
    pub(super) fn existed(&self, m: &std::fs::Metadata) -> bool {
        if self.imported_at <= 0 {
            return true;
        }
        let t = m.created().or_else(|_| m.modified()).ok().and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_millis() as i64);
        t.map_or(true, |t| t <= self.imported_at)
    }
    /// Kam diese Datei beim Import mit (und fehlt jetzt, weil sie in Vibe gelöscht wurde)?
    pub(super) fn copied_file(&self, top: &str, m: &std::fs::Metadata) -> bool {
        self.took(top) && self.existed(m)
    }
}
