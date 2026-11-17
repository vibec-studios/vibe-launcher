//! Globale Launcher-Einstellungen (`settings.json`).
use crate::error::AppResult;
use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum LaunchBehavior {
    /// Launcher bleibt offen
    Keep,
    /// Launcher wird minimiert
    Minimize,
    /// Launcher wird geschlossen (ins Hintergrund-Fenster versteckt), kommt nach Spielende zurück
    Hide,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct Settings {
    /// "de" | "en"
    pub language: String,
    /// Standard-RAM in MiB
    pub min_memory_mb: u32,
    pub max_memory_mb: u32,
    /// Zusätzliche JVM-Argumente (global), durch Leerzeichen getrennt
    pub jvm_args: String,
    /// Fenstergröße des Spiels
    pub game_width: u32,
    pub game_height: u32,
    pub fullscreen: bool,
    /// Feste Java-Pfade je Hauptversion (z. B. "21" -> "C:\\...\\javaw.exe"). Leer = automatisch.
    pub java_overrides: std::collections::BTreeMap<String, String>,
    /// Java automatisch herunterladen, wenn keine passende gefunden wird
    pub auto_java: bool,
    pub launch_behavior: LaunchBehavior,
    pub show_snapshots: bool,
    /// Gleichzeitige Downloads
    pub concurrent_downloads: u32,
    /// Optionaler eigener CurseForge-API-Key (überschreibt den eingebauten)
    pub curseforge_api_key: Option<String>,
    /// Optionale eigene Azure-Client-ID für den Microsoft-Login (überschreibt die eingebaute)
    pub msa_client_id: Option<String>,
    /// Nach Launcher-Updates suchen
    pub check_updates: bool,
    /// Wrapper-Befehl vor java (z. B. "prime-run"), optional
    pub wrapper_command: Option<String>,
    /// Konsole beim Start automatisch öffnen
    pub open_log_on_launch: bool,
    /// Animationen reduzieren (zusätzlich zur System-Einstellung)
    pub reduce_motion: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Settings {
            language: default_language(),
            min_memory_mb: 512,
            max_memory_mb: default_max_memory(),
            jvm_args: String::new(),
            game_width: 1280,
            game_height: 720,
            fullscreen: false,
            java_overrides: Default::default(),
            auto_java: true,
            launch_behavior: LaunchBehavior::Keep,
            show_snapshots: false,
            concurrent_downloads: 16,
            curseforge_api_key: None,
            msa_client_id: None,
            check_updates: true,
            wrapper_command: None,
            open_log_on_launch: false,
            reduce_motion: false,
        }
    }
}

fn default_language() -> String {
    let lang = std::env::var("LANG").unwrap_or_default().to_lowercase();
    if lang.starts_with("en") {
        return "en".into();
    }
    #[cfg(windows)]
    {
        // Windows: Benutzersprache über die Umgebung ist unzuverlässig – Deutsch als Standard,
        // umschaltbar in den Einstellungen.
    }
    "de".into()
}

fn default_max_memory() -> u32 {
    let mut sys = sysinfo::System::new();
    sys.refresh_memory();
    let total_mb = (sys.total_memory() / 1024 / 1024) as u32;
    // Ein Viertel des RAMs, zwischen 2 und 8 GiB, auf 512 MiB gerundet
    let v = (total_mb / 4).clamp(2048, 8192);
    v / 512 * 512
}

/// Gesamter Arbeitsspeicher des Systems in MiB (für Regler im Frontend).
pub fn system_memory_mb() -> u64 {
    let mut sys = sysinfo::System::new();
    sys.refresh_memory();
    sys.total_memory() / 1024 / 1024
}

impl Settings {
    pub fn load(path: &Path) -> Settings {
        match std::fs::read(path) {
            Ok(b) => serde_json::from_slice(&b).unwrap_or_else(|e| {
                tracing::warn!("settings.json unlesbar, Standardwerte: {e}");
                Settings::default()
            }),
            Err(_) => Settings::default(),
        }
    }

    pub fn save(&self, path: &Path) -> AppResult<()> {
        crate::util::write_json_atomic(path, self)
    }

    /// Effektiver CurseForge-Key: Einstellung > Build-Zeit (`CURSEFORGE_API_KEY`).
    pub fn curseforge_key(&self) -> Option<String> {
        self.curseforge_api_key
            .clone()
            .filter(|k| !k.trim().is_empty())
            .or_else(|| option_env!("CURSEFORGE_API_KEY").map(str::to_string))
            .filter(|k| !k.trim().is_empty())
    }

    /// Effektive Azure-Client-ID: Einstellung > Build-Zeit (`VIBE_MSA_CLIENT_ID`).
    pub fn msa_client(&self) -> Option<String> {
        self.msa_client_id
            .clone()
            .filter(|k| !k.trim().is_empty())
            .or_else(|| option_env!("VIBE_MSA_CLIENT_ID").map(str::to_string))
            .filter(|k| !k.trim().is_empty())
    }
}
