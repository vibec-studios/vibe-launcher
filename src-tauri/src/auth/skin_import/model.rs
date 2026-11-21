use super::*;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
pub enum ImportSource {
    Modrinth,
    Norisk,
    Lunar,
}

impl ImportSource {
    pub const ALL: [ImportSource; 3] = [ImportSource::Modrinth, ImportSource::Norisk, ImportSource::Lunar];
    pub fn as_str(self) -> &'static str {
        match self {
            ImportSource::Modrinth => "modrinth",
            ImportSource::Norisk => "norisk",
            ImportSource::Lunar => "lunar",
        }
    }
    pub fn label(self) -> &'static str {
        match self {
            ImportSource::Modrinth => "Modrinth App",
            ImportSource::Norisk => "NoRisk Client",
            ImportSource::Lunar => "Lunar Client",
        }
    }
}

/// Basisordner, aus denen die Pfade gebildet werden (für Tests austauschbar).
#[derive(Debug, Clone)]
pub struct Roots {
    /// `%APPDATA%` bzw. `~/Library/Application Support` bzw. `~/.local/share`
    pub data: Option<PathBuf>,
    pub home: Option<PathBuf>,
    /// `THESEUS_CONFIG_DIR` der Modrinth App
    pub modrinth_override: Option<PathBuf>,
}

impl Roots {
    pub fn system() -> Self {
        Roots {
            data: dirs::data_dir(),
            home: dirs::home_dir(),
            modrinth_override: std::env::var_os("THESEUS_CONFIG_DIR").map(PathBuf::from).filter(|p| !p.as_os_str().is_empty()),
        }
    }

    pub fn file(&self, src: ImportSource) -> Option<PathBuf> {
        match src {
            ImportSource::Modrinth => {
                let dir = self.modrinth_override.clone().or_else(|| self.data.as_ref().map(|d| d.join("ModrinthApp")))?;
                Some(dir.join("app.db"))
            }
            ImportSource::Norisk => {
                let d = self.data.as_ref()?;
                let dir = if cfg!(windows) {
                    d.join("norisk").join("NoRiskClientV3")
                } else if cfg!(target_os = "macos") {
                    d.join("gg.norisk.NoRiskClientV3")
                } else {
                    d.join("noriskclientv3")
                };
                Some(dir.join("minecraft_skins.json"))
            }
            ImportSource::Lunar => Some(self.home.as_ref()?.join(".lunarclient").join("settings").join("game").join("saved_skins.json")),
        }
    }
}

/// Ein gefundener Skin (Rohdaten, PNG schon gelesen bzw. – bei Lunar – noch als URL).
#[derive(Debug, Clone)]
pub struct RawFound {
    pub name: Option<String>,
    pub variant: SkinVariant,
    pub cape_id: Option<String>,
    pub png: Option<Vec<u8>>,
    pub url: Option<String>,
}

/// Für die Vorschau-Auswahl im Frontend.
#[derive(Debug, Clone, Serialize)]
pub struct FoundSkin {
    /// `<quelle>:<bild-hash>` – stabil, Grundlage für Auswahl und „schon gesehen“
    pub key: String,
    pub source: ImportSource,
    pub name: String,
    pub variant: SkinVariant,
    pub cape_id: Option<String>,
    /// Bild-Hash: SHA-1 der dekodierten RGBA-Pixel (gleiches Bild, andere PNG-Kodierung = gleicher Hash)
    pub sha1: String,
    pub data_url: String,
    /// Gleiches Bild liegt schon in der Bibliothek
    pub in_library: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct SourceScan {
    pub source: ImportSource,
    pub label: &'static str,
    pub path: String,
    pub skins: Vec<FoundSkin>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ImportScan {
    pub sources: Vec<SourceScan>,
    /// Neue Skins (noch nicht in der Bibliothek)
    pub new_count: usize,
    pub auto_import: bool,
}
