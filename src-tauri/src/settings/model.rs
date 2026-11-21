use super::*;

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
    #[serde(default)]
    pub vibe: VibeServices,
    /// Discord Rich Presence
    pub discord_rpc: bool,
    /// Discord: Servernamen und Welt anzeigen (sonst nur „Im Mehrspieler“ usw.)
    pub discord_details: bool,
    /// Discord: großes Bild "logo" | "app_icon" | "head" | "custom" (docs/DISCORD.md)
    pub discord_large: String,
    /// Discord: Modpack-Icon statt des großen Bilds, wenn es eins gibt
    pub discord_pack_icon: bool,
    /// Discord: kleines Bild "head" | "loader" | "none"
    pub discord_small: String,
    /// Discord: eigenes Bild (nach `<daten>/app-icon/` kopiert)
    pub discord_image: Option<String>,
    /// Update-Kanal: "release" (nur GitHub-Releases) oder "dev" (jeder Commit)
    pub update_channel: String,
    /// Wrapper-Befehl vor java (z. B. "prime-run"), optional
    pub wrapper_command: Option<String>,
    /// Konsole beim Start automatisch öffnen
    pub open_log_on_launch: bool,
    /// Eigenes Konsolenfenster beim Spielstart öffnen
    pub console_on_launch: bool,
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
    /// Sicherung vor „Probleme beheben“ und Performance-Mods (welche Bereiche)
    pub fix_backup: FixBackup,
    /// MinecraftCapes-Cape/Ohren des eigenen Accounts anzeigen (aus = keine Anfragen an api.minecraftcapes.net)
    #[serde(default = "legacy_enabled")]
    pub minecraftcapes: bool,
    /// Darstellung: Akzentfarbe, Ton, Ecken, Dichte, Skalierung, Hintergrund
    pub appearance: Appearance,
    /// Bedienung: "simple" (geführt, ohne Fachbegriffe) | "expert" (alle Funktionen).
    /// Fehlt das Feld (Einstellungen von vor dem Simple-Modus), gilt "expert".
    #[serde(default = "legacy_ui_mode")]
    pub ui_mode: String,
    /// Einrichtung beim ersten Start abgeschlossen. Fehlt das Feld (bestehende Einstellungen), gilt sie als erledigt –
    /// nur ganz neue Nutzer sehen das Onboarding.
    #[serde(default = "legacy_onboarding_done")]
    pub onboarding_done: bool,
    /// Hinweis „Neu: Simple-Modus“ (einmalig für bestehende Nutzer) gesehen
    pub simple_hint_seen: bool,
    /// Kurze Einführung (Hinweis-Bubbles) im Simple-Modus gesehen
    pub simple_tour_done: bool,
    /// Weggeklickte Hinweise/Ankündigungen (je `id`, z. B. "domain-move-2026-11"; docs/DOMAINS.md)
    pub dismissed_notices: Vec<String>,
    pub prefer_dgpu: bool,
    pub java_cds: bool,
    pub afk: crate::afk::AfkSettings,
}

/// Sicherung vor automatischen Mod-Änderungen. `mode`: "recommended" (Mods, Configs, Optionen) | "mods" | "all" |
/// "custom" (Bereiche aus `areas`, siehe `snapshots::SCOPES`) | "none" (keine Sicherung, „Rückgängig“ eingeschränkt).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(default)]
pub struct FixBackup {
    pub mode: String,
    pub areas: Vec<String>,
}

impl FixBackup {
    /// Was „Probleme beheben“ verändern kann (Mods, beim nächsten Start auch deren Configs und Tastenbelegungen) –
    /// ohne Resourcepacks/Shader, die ein späteres „Rückgängig“ sonst mit zurückdrehen würde.
    pub const RECOMMENDED: [&'static str; 3] = ["mods", "configs", "options"];
}

impl Default for FixBackup {
    fn default() -> Self {
        FixBackup { mode: "recommended".into(), areas: Self::RECOMMENDED.iter().map(|s| s.to_string()).collect() }
    }
}

pub(super) fn legacy_ui_mode() -> String {
    "expert".into()
}

pub(super) fn legacy_onboarding_done() -> bool {
    true
}

pub(super) fn legacy_enabled() -> bool {
    true
}
