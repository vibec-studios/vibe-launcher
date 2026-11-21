//! Eigene Themes (Einstellungen → Darstellung → „Eigene Themes“): gespeicherte Darstellungs-Werte.
use super::{Appearance, Background, StatusColors};
use serde::{Deserialize, Serialize};

pub const MAX_CUSTOM_THEMES: usize = 24;
const MAX_NAME_CHARS: usize = 40;
const MAX_ID_CHARS: usize = 40;

/// Ein gespeichertes Theme.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(default)]
pub struct CustomTheme {
    pub id: String,
    pub name: String,
    pub values: ThemeValues,
}

/// Werte, die ein eigenes Theme festhält (Layout wie Seitenleisten-Reihenfolge oder App-Icon gehört nicht dazu).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(default)]
pub struct ThemeValues {
    pub theme: String,
    pub accent: String,
    pub tone: String,
    pub radius: String,
    pub radius_px: u32,
    pub contrast: String,
    pub cards: String,
    pub headings: String,
    pub font: String,
    pub font_scale: u32,
    pub status: StatusColors,
    pub glass: u32,
    pub sidebar_style: String,
    pub background: Background,
}

impl Default for CustomTheme {
    fn default() -> Self {
        CustomTheme { id: String::new(), name: String::new(), values: ThemeValues::default() }
    }
}

impl Default for ThemeValues {
    fn default() -> Self {
        let a = Appearance::default();
        ThemeValues {
            theme: a.theme,
            accent: a.accent,
            tone: a.tone,
            radius: a.radius,
            radius_px: a.radius_px,
            contrast: a.contrast,
            cards: a.cards,
            headings: a.headings,
            font: a.font,
            font_scale: a.font_scale,
            status: a.status,
            glass: a.glass,
            sidebar_style: a.sidebar.style,
            background: Background { image: None, video: None, ..a.background },
        }
    }
}

impl ThemeValues {
    fn sanitize(&mut self) {
        let mut a = Appearance {
            theme: std::mem::take(&mut self.theme),
            accent: std::mem::take(&mut self.accent),
            tone: std::mem::take(&mut self.tone),
            radius: std::mem::take(&mut self.radius),
            radius_px: self.radius_px,
            contrast: std::mem::take(&mut self.contrast),
            cards: std::mem::take(&mut self.cards),
            headings: std::mem::take(&mut self.headings),
            font: std::mem::take(&mut self.font),
            font_scale: self.font_scale,
            status: std::mem::take(&mut self.status),
            glass: self.glass,
            background: std::mem::take(&mut self.background),
            ..Appearance::default()
        };
        a.sidebar.style = std::mem::take(&mut self.sidebar_style);
        a.sanitize_values();
        self.theme = a.theme;
        self.accent = a.accent;
        self.tone = a.tone;
        self.radius = a.radius;
        self.radius_px = a.radius_px;
        self.contrast = a.contrast;
        self.cards = a.cards;
        self.headings = a.headings;
        self.font = a.font;
        self.font_scale = a.font_scale;
        self.status = a.status;
        self.glass = a.glass;
        self.sidebar_style = a.sidebar.style;
        self.background = a.background;
        self.background.video = None;
        if self.background.animated == "custom" {
            self.background.animated = "aurora".into();
        }
    }
}

fn clean_name(name: &str) -> String {
    let n: String = name.chars().filter(|c| !c.is_control()).collect();
    let n: String = n.trim().chars().take(MAX_NAME_CHARS).collect();
    if n.is_empty() {
        "Theme".into()
    } else {
        n
    }
}

fn valid_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= MAX_ID_CHARS && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

/// Eigene Themes bereinigen: gültige Ids (einmalig), Namen begrenzt, Werte wie bei der Darstellung, höchstens
/// `MAX_CUSTOM_THEMES`. Unbekanntes aktives Theme wird zurückgesetzt.
pub fn sanitize(a: &mut Appearance) {
    let mut out: Vec<CustomTheme> = Vec::new();
    for mut t in std::mem::take(&mut a.custom_themes) {
        if !valid_id(&t.id) || out.iter().any(|o| o.id == t.id) {
            continue;
        }
        t.name = clean_name(&t.name);
        t.values.sanitize();
        out.push(t);
        if out.len() >= MAX_CUSTOM_THEMES {
            break;
        }
    }
    a.custom_themes = out;
    if let Some(id) = &a.active_custom {
        if !a.custom_themes.iter().any(|t| &t.id == id) {
            a.active_custom = None;
        }
    }
}
