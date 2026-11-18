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
    /// Vibe-Online-Dienste (optional)
    pub vibe: VibeServices,
    /// Discord Rich Presence
    pub discord_rpc: bool,
    /// Update-Kanal: "release" (nur GitHub-Releases) oder "dev" (jeder Commit)
    pub update_channel: String,
    /// Wrapper-Befehl vor java (z. B. "prime-run"), optional
    pub wrapper_command: Option<String>,
    /// Konsole beim Start automatisch öffnen
    pub open_log_on_launch: bool,
    /// Animationen reduzieren (zusätzlich zur System-Einstellung)
    pub reduce_motion: bool,
    /// Mods/Resourcepacks/Shader vor jedem Spielstart automatisch aktualisieren (je Instanz überschreibbar)
    pub auto_update_content: bool,
    /// Eigene Inhalte-Stores (Vibe Store v1, siehe docs/STORE.md). Der Standard-Store ist immer enthalten.
    pub stores: Vec<StoreConfig>,
    /// Aufbewahrte automatische Snapshots je Instanz
    pub snapshot_keep: u32,
    /// Vor jedem Spielstart geänderte Welten sichern
    pub world_backup_on_launch: bool,
    /// Aufbewahrte automatische Backups je Welt
    pub world_backups_keep: u32,
    /// MinecraftCapes-Cape/Ohren des eigenen Accounts anzeigen (aus = keine Anfragen an api.minecraftcapes.net)
    pub minecraftcapes: bool,
    /// Darstellung: Akzentfarbe, Ton, Ecken, Dichte, Skalierung, Hintergrund
    pub appearance: Appearance,
}

/// Darstellungs-Optionen des Launchers (wirken sofort, siehe `src/lib/appearance.ts`).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(default)]
pub struct Appearance {
    /// Akzentfarbe als Hex ("#8b6cff")
    pub accent: String,
    /// Hintergrund-Ton: "dark" | "darker" | "oled"
    pub tone: String,
    /// Ecken: "square" | "slight" | "round"
    pub radius: String,
    /// Dichte: "compact" | "normal"
    pub density: String,
    /// UI-Skalierung in Prozent (80–130)
    pub ui_scale: u32,
    pub background: Background,
}

/// Fensterhintergrund hinter allen Flächen.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(default)]
pub struct Background {
    /// "none" | "gradient" | "image" | "animated"
    pub kind: String,
    /// Verlauf-Vorlage (z. B. "accent", "dusk", "ocean", "ember")
    pub gradient: String,
    /// Animierte Vorlage ("aurora", "particles", "waves", "blocks") oder "custom" (eigene Datei)
    pub animated: String,
    /// Eigenes Bild (in `<daten>/backgrounds/` kopiert)
    pub image: Option<String>,
    /// Eigenes Video/GIF/WebP (in `<daten>/backgrounds/` kopiert)
    pub video: Option<String>,
    /// Abdunklung in Prozent (0–90)
    pub dim: u32,
    /// Unschärfe in Pixeln (0–40)
    pub blur: u32,
}

impl Default for Appearance {
    fn default() -> Self {
        Appearance {
            accent: "#8b6cff".into(),
            tone: "dark".into(),
            radius: "slight".into(),
            density: "normal".into(),
            ui_scale: 100,
            background: Background::default(),
        }
    }
}

impl Default for Background {
    fn default() -> Self {
        Background {
            kind: "none".into(),
            gradient: "accent".into(),
            animated: "aurora".into(),
            image: None,
            video: None,
            dim: 45,
            blur: 0,
        }
    }
}

impl Appearance {
    /// Unbekannte Werte auf Standard zurücksetzen, Zahlen begrenzen.
    pub fn sanitize(&mut self) {
        let d = Appearance::default();
        let pick = |v: &mut String, allowed: &[&str], def: &str| {
            if !allowed.contains(&v.as_str()) {
                *v = def.to_string();
            }
        };
        let hex = self.accent.trim_start_matches('#');
        if hex.len() != 6 || !hex.chars().all(|c| c.is_ascii_hexdigit()) {
            self.accent = d.accent.clone();
        } else {
            self.accent = format!("#{}", hex.to_ascii_lowercase());
        }
        pick(&mut self.tone, &["dark", "darker", "oled"], &d.tone);
        pick(&mut self.radius, &["square", "slight", "round"], &d.radius);
        pick(&mut self.density, &["compact", "normal"], &d.density);
        self.ui_scale = self.ui_scale.clamp(80, 130);
        let b = &mut self.background;
        let db = Background::default();
        pick(&mut b.kind, &["none", "gradient", "image", "animated"], &db.kind);
        pick(&mut b.gradient, &["accent", "dusk", "ocean", "ember", "forest"], &db.gradient);
        pick(&mut b.animated, &["aurora", "particles", "waves", "blocks", "custom"], &db.animated);
        b.dim = b.dim.min(90);
        b.blur = b.blur.min(40);
    }
}

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
            update_channel: crate::updater::default_channel(),
            vibe: VibeServices::default(),
            discord_rpc: true,
            wrapper_command: None,
            open_log_on_launch: false,
            reduce_motion: false,
            auto_update_content: false,
            stores: crate::content::store::default_stores(),
            snapshot_keep: 10,
            world_backup_on_launch: false,
            world_backups_keep: 5,
            minecraftcapes: true,
            appearance: Appearance::default(),
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
            .map(|k| k.trim().to_string())
            .filter(|k| !k.is_empty())
    }

    /// Effektive Azure-Client-ID: Einstellung > Build-Zeit (`VIBE_MSA_CLIENT_ID`).
    pub fn msa_client(&self) -> Option<String> {
        self.msa_client_id
            .clone()
            .filter(|k| !k.trim().is_empty())
            .or_else(|| option_env!("VIBE_MSA_CLIENT_ID").map(str::to_string))
            .map(|k| k.trim().to_string())
            .filter(|k| !k.is_empty())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn old_settings_get_default_appearance() {
        let s: Settings = serde_json::from_str(r#"{"language":"de","reduce_motion":true}"#).unwrap();
        assert_eq!(s.appearance, Appearance::default());
        assert!(s.reduce_motion);
    }

    #[test]
    fn appearance_sanitize() {
        let mut a = Appearance {
            accent: "FF00AA".into(),
            tone: "light".into(),
            radius: "round".into(),
            density: "dense".into(),
            ui_scale: 400,
            background: Background { kind: "video".into(), dim: 120, blur: 99, ..Background::default() },
        };
        a.sanitize();
        assert_eq!(a.accent, "#ff00aa");
        assert_eq!(a.tone, "dark");
        assert_eq!(a.radius, "round");
        assert_eq!(a.density, "normal");
        assert_eq!(a.ui_scale, 130);
        assert_eq!(a.background.kind, "none");
        assert_eq!(a.background.dim, 90);
        assert_eq!(a.background.blur, 40);

        let mut bad = Appearance { accent: "#12345z".into(), ..Appearance::default() };
        bad.sanitize();
        assert_eq!(bad.accent, "#8b6cff");
    }
}
