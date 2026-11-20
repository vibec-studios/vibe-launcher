//! Globale Launcher-Einstellungen (`settings.json`).
mod syslang;
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
    /// Discord: Servernamen und Welt anzeigen (sonst nur „Im Mehrspieler“ usw.)
    pub discord_details: bool,
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
    /// Sicherung vor „Probleme beheben“ und Performance-Mods (welche Bereiche)
    pub fix_backup: FixBackup,
    /// MinecraftCapes-Cape/Ohren des eigenen Accounts anzeigen (aus = keine Anfragen an api.minecraftcapes.net)
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

fn legacy_ui_mode() -> String {
    "expert".into()
}

fn legacy_onboarding_done() -> bool {
    true
}

/// Darstellungs-Optionen des Launchers (wirken sofort, siehe `src/lib/appearance.ts`).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(default)]
pub struct Appearance {
    /// Theme-Voreinstellung: "standard" | "winter" | "graphite" (Einzelwerte bleiben frei anpassbar)
    pub theme: String,
    /// Im Dezember/Januar automatisch das Winter-Theme zeigen
    pub seasonal: bool,
    /// Akzentfarbe als Hex ("#8b6cff")
    pub accent: String,
    /// Hintergrund-Ton: "dark" (Schwarz) | "dim" (Dunkelgrau) | "oled"
    pub tone: String,
    /// Ecken: "square" (Standard) | "slight" | "round"
    pub radius: String,
    /// Dichte: "compact" | "normal"
    pub density: String,
    /// UI-Skalierung in Prozent (80–130)
    pub ui_scale: u32,
    pub background: Background,
    /// Schrift: "inter" | "system"
    pub font: String,
    /// Überschriften: "default" | "pixel"
    pub headings: String,
    /// Schriftgröße in Prozent (90–115), unabhängig von der UI-Skalierung
    pub font_scale: u32,
    /// Kontrast: "normal" | "high"
    pub contrast: String,
    /// Kartenstil: "flat" | "outlined"
    pub cards: String,
    pub sidebar: Sidebar,
    /// Instanz-Kacheln: "large" | "small"
    pub icon_size: String,
    /// Standardansicht der Bibliothek: "grid" | "list"
    pub library_view: String,
    pub status: StatusColors,
    /// Animationen: "normal" | "more" (reduziert = `Settings::reduce_motion`)
    pub motion: String,
    /// Übergang beim Seitenwechsel
    pub nav_animations: bool,
    pub effects: Effects,
    /// App-Icon (Taskleiste, Fenster, Verknüpfungen): "seal" | "penguin" | "custom"
    pub app_icon: String,
    /// Kachelfarbe des App-Icons als Hex
    pub app_icon_color: String,
    /// Eigenes Bild fürs App-Icon (in `<daten>/app-icon/` kopiert)
    pub app_icon_image: Option<String>,
}

/// Seitenleiste.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(default)]
pub struct Sidebar {
    /// "compact" (nur Icons) | "wide" (mit Beschriftung)
    pub mode: String,
    /// Zuletzt gespielte Instanzen anzeigen
    pub instances: bool,
    /// Reihenfolge der Einträge (Schlüssel wie "home", "instances" …)
    pub order: Vec<String>,
    /// Ausgeblendete Einträge
    pub hidden: Vec<String>,
}

/// Statusfarben als Hex.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(default)]
pub struct StatusColors {
    pub ok: String,
    pub warn: String,
    pub danger: String,
}

/// Theme-Extras (wirken nur bei Themes, die sie haben, z. B. Winter).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(default)]
pub struct Effects {
    pub snow: bool,
    /// Schneemenge in Prozent (10–100)
    pub snow_amount: u32,
    pub snow_settle: bool,
    pub mascot: bool,
    pub frost: bool,
}

/// Bekannte Seitenleisten-Einträge (Standard-Reihenfolge).
pub const NAV_KEYS: [&str; 8] = ["home", "instances", "servers", "social", "discover", "skins", "cosmetics", "screenshots"];

impl Default for Sidebar {
    fn default() -> Self {
        Sidebar {
            mode: "compact".into(),
            instances: true,
            order: NAV_KEYS.iter().map(|s| s.to_string()).collect(),
            hidden: Vec::new(),
        }
    }
}

impl Default for StatusColors {
    fn default() -> Self {
        StatusColors { ok: "#3fe0c5".into(), warn: "#ffb547".into(), danger: "#ff5470".into() }
    }
}

impl Default for Effects {
    fn default() -> Self {
        Effects { snow: true, snow_amount: 50, snow_settle: true, mascot: true, frost: true }
    }
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
            theme: "standard".into(),
            seasonal: false,
            accent: "#8b6cff".into(),
            tone: "dark".into(),
            radius: "square".into(),
            density: "normal".into(),
            ui_scale: 100,
            background: Background::default(),
            font: "inter".into(),
            headings: "default".into(),
            font_scale: 100,
            contrast: "normal".into(),
            cards: "flat".into(),
            sidebar: Sidebar::default(),
            icon_size: "large".into(),
            library_view: "grid".into(),
            status: StatusColors::default(),
            motion: "normal".into(),
            nav_animations: true,
            effects: Effects::default(),
            app_icon: "seal".into(),
            app_icon_color: crate::platform::app_icon::DEFAULT_COLOR.into(),
            app_icon_image: None,
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
        fix_hex(&mut self.accent, &d.accent);
        pick(&mut self.theme, &["standard", "winter", "graphite"], &d.theme);
        pick(&mut self.app_icon, crate::platform::app_icon::MOTIFS, &d.app_icon);
        fix_hex(&mut self.app_icon_color, &d.app_icon_color);
        pick(&mut self.font, &["inter", "system"], &d.font);
        pick(&mut self.headings, &["default", "pixel"], &d.headings);
        self.font_scale = self.font_scale.clamp(90, 115);
        pick(&mut self.contrast, &["normal", "high"], &d.contrast);
        pick(&mut self.cards, &["flat", "outlined"], &d.cards);
        pick(&mut self.icon_size, &["large", "small"], &d.icon_size);
        pick(&mut self.library_view, &["grid", "list"], &d.library_view);
        pick(&mut self.motion, &["normal", "more"], &d.motion);
        pick(&mut self.sidebar.mode, &["compact", "wide"], &d.sidebar.mode);
        // Reihenfolge: nur bekannte Einträge, jeder genau einmal; fehlende hinten anhängen
        let mut order: Vec<String> = Vec::new();
        for k in self.sidebar.order.iter().chain(d.sidebar.order.iter()) {
            if NAV_KEYS.contains(&k.as_str()) && !order.contains(k) {
                order.push(k.clone());
            }
        }
        self.sidebar.order = order;
        // „Start“ bleibt immer sichtbar
        let mut hidden: Vec<String> = Vec::new();
        for k in &self.sidebar.hidden {
            if NAV_KEYS.contains(&k.as_str()) && k != "home" && !hidden.contains(k) {
                hidden.push(k.clone());
            }
        }
        self.sidebar.hidden = hidden;
        fix_hex(&mut self.status.ok, &d.status.ok);
        fix_hex(&mut self.status.warn, &d.status.warn);
        fix_hex(&mut self.status.danger, &d.status.danger);
        self.effects.snow_amount = self.effects.snow_amount.clamp(10, 100);
        pick(&mut self.tone, &["dark", "dim", "oled"], &d.tone);
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

/// Hex-Farbe normalisieren ("FF00AA" -> "#ff00aa"), ungültig -> Standard.
fn fix_hex(v: &mut String, def: &str) {
    let hex = v.trim_start_matches('#');
    if hex.len() != 6 || !hex.chars().all(|c| c.is_ascii_hexdigit()) {
        *v = def.to_string();
    } else {
        *v = format!("#{}", hex.to_ascii_lowercase());
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
            discord_details: true,
            wrapper_command: None,
            open_log_on_launch: false,
            reduce_motion: false,
            auto_update_content: false,
            stores: crate::content::store::default_stores(),
            snapshot_keep: 10,
            world_backup_on_launch: false,
            world_backups_keep: 5,
            fix_backup: FixBackup::default(),
            minecraftcapes: true,
            appearance: Appearance::default(),
            // Neue Nutzer wählen den Modus im Onboarding
            ui_mode: "expert".into(),
            onboarding_done: false,
            simple_hint_seen: false,
            simple_tour_done: false,
            dismissed_notices: Vec::new(),
            prefer_dgpu: false,
        }
    }
}

fn default_language() -> String {
    syslang::system().into()
}

fn default_max_memory() -> u32 {
    let mut sys = sysinfo::System::new();
    sys.refresh_memory();
    let total_mb = (sys.total_memory() / 1024 / 1024) as u32;
    // Ein Viertel des RAMs, zwischen 2 und 8 GiB, auf 512 MiB gerundet
    let v = (total_mb / 4).clamp(2048, 8192);
    v / 512 * 512
}

/// Gibt es schon Konten oder Instanzen? (Erkennung bestehender Nutzer ohne `settings.json`)
fn has_existing_data(paths: &crate::paths::Paths) -> bool {
    if paths.accounts_file().exists() {
        return true;
    }
    std::fs::read_dir(paths.instances())
        .map(|mut it| it.any(|e| e.map(|e| e.path().join("instance.json").exists()).unwrap_or(false)))
        .unwrap_or(false)
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
                // Kaputte Datei = bestehender Nutzer: kein Onboarding, Expert bleibt
                Settings { onboarding_done: true, ..Settings::default() }
            }),
            Err(_) => Settings::default(),
        }
    }

    /// Wie `load`, erkennt aber bestehende Nutzer ohne `settings.json` (nie etwas eingestellt, aber schon Konten
    /// oder Instanzen): für sie gilt das Onboarding als erledigt, der Modus bleibt Expert.
    pub fn load_for(paths: &crate::paths::Paths) -> Settings {
        let file = paths.settings_file();
        let mut s = Settings::load(&file);
        if !file.exists() && !s.onboarding_done && has_existing_data(paths) {
            s.onboarding_done = true;
        }
        s.sanitize_mode();
        s.migrate_stores();
        s
    }

    /// Gespeicherte Adresse des offiziellen Stores (GitHub Pages) still auf die neue umstellen; eigene Stores bleiben.
    pub fn migrate_stores(&mut self) {
        for st in &mut self.stores {
            st.url = crate::domains::migrate_store_url(&st.url);
        }
    }

    /// Weggeklickte Hinweise: nur gültige IDs, ohne Doppelte, höchstens 200 (die neuesten).
    pub fn sanitize_notices(&mut self) {
        let mut out: Vec<String> = Vec::new();
        for id in &self.dismissed_notices {
            let id = id.trim();
            if crate::vibe::announcements::valid_id(id) && !out.iter().any(|x| x == id) {
                out.push(id.to_string());
            }
        }
        let n = out.len();
        if n > 200 {
            out.drain(..n - 200);
        }
        self.dismissed_notices = out;
    }

    /// Unbekannten Modus auf "expert" setzen.
    pub fn sanitize_mode(&mut self) {
        if self.ui_mode != "simple" {
            self.ui_mode = "expert".into();
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
    fn old_settings_are_expert_without_onboarding() {
        let s: Settings = serde_json::from_str(r#"{"language":"de"}"#).unwrap();
        assert_eq!(s.ui_mode, "expert");
        assert!(s.onboarding_done);
        assert!(!s.simple_hint_seen);
        assert!(!s.simple_tour_done);
    }

    #[test]
    fn fresh_settings_need_onboarding() {
        let s = Settings::default();
        assert!(!s.onboarding_done);
        let back: Settings = serde_json::from_str(&serde_json::to_string(&s).unwrap()).unwrap();
        assert!(!back.onboarding_done, "gespeichertes false bleibt false");
    }

    #[test]
    fn existing_data_skips_onboarding() {
        let dir = std::env::temp_dir().join(format!("vl-onb-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let paths = crate::paths::Paths { root: dir.clone() };
        assert!(!Settings::load_for(&paths).onboarding_done, "leerer Ordner = neuer Nutzer");
        std::fs::create_dir_all(paths.instance_dir("a")).unwrap();
        std::fs::write(paths.instance_json("a"), "{}").unwrap();
        assert!(Settings::load_for(&paths).onboarding_done, "Instanz vorhanden = bestehender Nutzer");
        let s = Settings { ui_mode: "simple".into(), ..Default::default() };
        s.save(&paths.settings_file()).unwrap();
        let loaded = Settings::load_for(&paths);
        assert_eq!(loaded.ui_mode, "simple");
        assert!(!loaded.onboarding_done, "gespeicherte Einstellungen gewinnen");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn dismissed_notices() {
        let old: Settings = serde_json::from_str(r#"{"language":"de"}"#).unwrap();
        assert!(old.dismissed_notices.is_empty(), "alte Einstellungen: nichts weggeklickt");
        let mut s: Settings = serde_json::from_str(r#"{"dismissed_notices":["domain-move-2026-11","domain-move-2026-11"," x ","böse id",""]}"#).unwrap();
        s.sanitize_notices();
        assert_eq!(s.dismissed_notices, vec!["domain-move-2026-11".to_string(), "x".to_string()]);
        s.dismissed_notices = (0..250).map(|i| format!("n{i}")).collect();
        s.sanitize_notices();
        assert_eq!(s.dismissed_notices.len(), 200);
        assert_eq!(s.dismissed_notices[0], "n50");
    }

    #[test]
    fn saved_legacy_store_url_is_migrated_on_load() {
        let dir = std::env::temp_dir().join(format!("vl-store-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let paths = crate::paths::Paths { root: dir.clone() };
        std::fs::write(
            paths.settings_file(),
            r#"{"onboarding_done":true,"stores":[
              {"id":"vibe-craft-studios","name":"Vibe Craft Studios","url":"https://vibec-studios.github.io/data/store.json","enabled":false},
              {"id":"mein-store","name":"Mein Store","url":"https://example.org/store.json","enabled":true}]}"#,
        )
        .unwrap();
        let s = Settings::load_for(&paths);
        assert_eq!(s.stores[0].url, crate::domains::STORE_URL);
        assert!(!s.stores[0].enabled, "deaktiviert bleibt deaktiviert");
        assert_eq!(s.stores[1].url, "https://example.org/store.json", "eigene Stores bleiben");
        // neue Installation: gleich die neue Adresse
        assert_eq!(Settings::default().stores[0].url, crate::domains::STORE_URL);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn unknown_mode_falls_back_to_expert() {
        let mut s: Settings = serde_json::from_str(r#"{"ui_mode":"wizard"}"#).unwrap();
        s.sanitize_mode();
        assert_eq!(s.ui_mode, "expert");
    }

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
            ..Appearance::default()
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

    #[test]
    fn appearance_customize_sanitize() {
        let mut a = Appearance {
            theme: "summer".into(),
            font_scale: 200,
            motion: "wild".into(),
            sidebar: Sidebar {
                mode: "huge".into(),
                instances: false,
                order: vec!["skins".into(), "bogus".into(), "home".into(), "skins".into()],
                hidden: vec!["home".into(), "servers".into(), "nope".into()],
            },
            status: StatusColors { ok: "00FF00".into(), warn: "zzz".into(), danger: "#FF0000".into() },
            effects: Effects { snow_amount: 0, ..Effects::default() },
            ..Appearance::default()
        };
        a.sanitize();
        assert_eq!(a.theme, "standard");
        assert_eq!(a.font_scale, 115);
        assert_eq!(a.motion, "normal");
        assert_eq!(a.sidebar.mode, "compact");
        assert!(!a.sidebar.instances);
        // gewählte Reihenfolge zuerst, Rest angehängt, keine Doppelten
        assert_eq!(a.sidebar.order[0], "skins");
        assert_eq!(a.sidebar.order[1], "home");
        assert_eq!(a.sidebar.order.len(), NAV_KEYS.len());
        // „Start“ lässt sich nicht ausblenden
        assert_eq!(a.sidebar.hidden, vec!["servers".to_string()]);
        assert_eq!(a.status.ok, "#00ff00");
        assert_eq!(a.status.warn, "#ffb547");
        assert_eq!(a.status.danger, "#ff0000");
        assert_eq!(a.effects.snow_amount, 10);
    }

    #[test]
    fn appearance_partial_json_gets_new_defaults() {
        let a: Appearance = serde_json::from_str(r##"{"accent":"#5aa9ff","sidebar":{"mode":"wide"}}"##).unwrap();
        assert_eq!(a.accent, "#5aa9ff");
        assert_eq!(a.theme, "standard");
        assert_eq!(a.sidebar.mode, "wide");
        assert!(a.sidebar.instances);
        assert_eq!(a.sidebar.order.len(), NAV_KEYS.len());
        assert!(a.effects.snow);
    }
}
