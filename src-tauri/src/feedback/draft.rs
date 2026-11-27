use super::*;

#[derive(Debug, Clone, Deserialize)]
pub struct Draft {
    /// "bug" | "idea" | "other"
    pub kind: String,
    pub message: String,
    #[serde(default)]
    pub contact: Option<String>,
    /// z. B. "de" / "en"
    pub locale: String,
    /// Aktuelle Route (nur Pfad, z. B. `/instances/abc`)
    #[serde(default)]
    pub page: Option<String>,
    #[serde(default)]
    pub instance_id: Option<String>,
    #[serde(default)]
    pub attach_logs: bool,
    /// IDs aus [`capture_window`] / [`pick_screenshots`]
    #[serde(default)]
    pub screenshots: Vec<String>,
    /// Mit dem angemeldeten Vibe-Konto verknüpfen (nur wenn Vibe an und angemeldet)
    #[serde(default)]
    pub link_account: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct LogPreview {
    pub name: String,
    /// Größe der Datei auf der Platte
    pub original_bytes: u64,
    /// Gesendete Größe (nach Kürzen und Bereinigen)
    pub bytes: u64,
    pub truncated: bool,
    /// Anzahl ersetzter Stellen
    pub redactions: u32,
    /// Genau der gesendete Text
    pub text: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct ImageInfo {
    pub id: String,
    pub name: String,
    pub mime: String,
    pub bytes: u64,
    pub width: u32,
    pub height: u32,
    /// Kleines Vorschaubild als data:-URL (JPEG)
    pub thumb: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct Preview {
    /// Einmal-Token für [`send`]
    pub token: String,
    /// Ziel-Adresse
    pub endpoint: String,
    /// Genau das gesendete `meta`-Feld
    pub meta: Value,
    pub logs: Vec<LogPreview>,
    pub screenshots: Vec<ImageInfo>,
    /// Minecraft-Name des verknüpften Vibe-Kontos (None = anonym)
    pub account: Option<String>,
    pub total_bytes: u64,
}

#[derive(Debug, Clone, Serialize)]
pub struct AvailableLog {
    pub name: String,
    pub bytes: u64,
    /// "launcher" | "game" | "crash"
    pub kind: String,
}

/// Ergebnis des Sendens (statt Fehler, damit die Oberfläche je Fall passend reagieren kann).
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum SendResult {
    Sent {
        id: String,
        ticket: String,
        #[serde(skip)]
        token: Option<String>,
    },
    /// 429: zu viele Meldungen
    RateLimited { retry_after_secs: Option<u64>, message: Option<String> },
    /// 400/413/sonstige HTTP-Fehler
    Rejected { http: u16, code: Option<String>, message: Option<String> },
    /// Keine Verbindung / Zeitüberschreitung
    Offline { message: String },
}
