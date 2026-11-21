use super::*;

/// Eintrag in der Store-Liste.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct StoreConfig {
    pub id: String,
    pub name: String,
    pub url: String,
    pub enabled: bool,
    #[serde(default)]
    pub icon: Option<String>,
}

/// Online-Dienste von Vibe Craft Studios (alle optional, einzeln abschaltbar).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct VibeServices {
    /// Hauptschalter: aus = der Launcher spricht nie mit dem Vibe-Backend/Relay
    pub enabled: bool,
    /// Freunde, Chats, Einladungen
    pub social: bool,
    /// Online-Status/„spielt gerade“ an Freunde senden
    pub presence: bool,
    /// Welten/Server über den Vibey-Relay hosten
    pub hosting: bool,
    /// Modpacks per Link/Code teilen
    pub sharing: bool,
}

impl Default for VibeServices {
    fn default() -> Self {
        VibeServices {
            enabled: true,
            social: true,
            presence: true,
            hosting: true,
            sharing: true,
        }
    }
}
