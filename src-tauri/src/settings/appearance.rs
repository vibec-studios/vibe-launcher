use super::*;

/// Darstellungs-Optionen des Launchers (wirken sofort, siehe `src/lib/appearance.ts`).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(default)]
pub struct Appearance {
    /// Design-Generation: "v1" (Standard) | "v2" (Beta)
    pub design: String,
    /// Theme-Voreinstellung, z. B. "standard" | "winter" | "ocean" (Einzelwerte bleiben frei anpassbar)
    pub theme: String,
    /// Im Dezember/Januar automatisch das Winter-Theme zeigen
    pub seasonal: bool,
    /// Akzentfarbe als Hex ("#8b6cff")
    pub accent: String,
    /// Hintergrund-Ton: "dark" (Schwarz) | "dim" (Dunkelgrau) | "oled" | "light" (hell)
    pub tone: String,
    /// Ecken: "square" (Standard) | "slight" | "round" | "custom"
    pub radius: String,
    /// Eigener Eckenradius in px (0–24), wirkt bei `radius` = "custom"
    pub radius_px: u32,
    /// Dichte: "compact" | "normal"
    pub density: String,
    /// UI-Skalierung in Prozent (80–130)
    pub ui_scale: u32,
    pub background: Background,
    /// Schrift: "inter" | "inter_tight" | "system" | "mono"
    pub font: String,
    /// Überschriften: "default" | "pixel" | "pixel_all" (auch Knöpfe, Reiter, Beschriftungen)
    pub headings: String,
    /// Schriftgröße in Prozent (90–115), unabhängig von der UI-Skalierung
    pub font_scale: u32,
    /// Kontrast: "normal" | "high"
    pub contrast: String,
    /// Kartenstil: "flat" | "outlined" | "raised" | "pixel"
    pub cards: String,
    /// Glas-Effekt 0–100 (0 = aus)
    pub glass: u32,
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
    /// Selbst gespeicherte Themes
    pub custom_themes: Vec<theme::CustomTheme>,
    /// Id des zuletzt angewendeten eigenen Themes
    pub active_custom: Option<String>,
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
    /// "solid" (auf dem Rahmen) | "floating" (eigene Platte) | "tinted" (Akzent-Tönung)
    pub style: String,
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

/// Bekannte Theme-Voreinstellungen (siehe THEMES in `src/lib/appearance.ts`).
pub const THEME_IDS: &[&str] = &[
    "standard", "winter", "graphite", "light", "midnight", "ocean", "forest", "sunset", "sakura", "nether", "end", "retro", "contrast", "pixel",
    "pixel_light",
];

/// Bekannte Seitenleisten-Einträge (Standard-Reihenfolge).
pub const NAV_KEYS: [&str; 8] = ["home", "instances", "servers", "social", "discover", "skins", "cosmetics", "screenshots"];

impl Default for Sidebar {
    fn default() -> Self {
        Sidebar {
            mode: "compact".into(),
            instances: true,
            order: NAV_KEYS.iter().map(|s| s.to_string()).collect(),
            hidden: Vec::new(),
            style: "solid".into(),
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
    /// "none" | "color" | "gradient" | "image" | "animated"
    pub kind: String,
    /// Verlauf-Vorlage (z. B. "accent", "dusk", "pixel") oder "custom" (eigene Farben)
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
    /// Einfarbiger Hintergrund (Hex)
    pub color: String,
    /// Eigener Verlauf: Start- und Endfarbe (Hex), Winkel 0–360°
    pub gradient_from: String,
    pub gradient_to: String,
    pub gradient_angle: u32,
}

impl Default for Appearance {
    fn default() -> Self {
        Appearance {
            design: "v1".into(),
            theme: "standard".into(),
            seasonal: false,
            accent: "#8b6cff".into(),
            tone: "dark".into(),
            radius: "square".into(),
            radius_px: 6,
            density: "normal".into(),
            ui_scale: 100,
            background: Background::default(),
            font: "inter".into(),
            headings: "default".into(),
            font_scale: 100,
            contrast: "normal".into(),
            cards: "flat".into(),
            glass: 0,
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
            custom_themes: Vec::new(),
            active_custom: None,
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
            color: "#1a1030".into(),
            gradient_from: "#2b1655".into(),
            gradient_to: "#ff9e6d".into(),
            gradient_angle: 160,
        }
    }
}
