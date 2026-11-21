use super::*;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum SkinVariant {
    #[default]
    Classic,
    Slim,
}

impl SkinVariant {
    pub fn api(self) -> &'static str {
        match self {
            SkinVariant::Classic => "classic",
            SkinVariant::Slim => "slim",
        }
    }
    pub fn from_api(s: &str) -> Self {
        if s.eq_ignore_ascii_case("slim") { SkinVariant::Slim } else { SkinVariant::Classic }
    }
}

/// Aktueller Skin eines Accounts.
#[derive(Debug, Clone, Serialize)]
pub struct ActiveSkin {
    pub id: String,
    pub url: String,
    pub variant: SkinVariant,
    /// PNG als data:-URL (None, wenn nicht ladbar)
    pub data_url: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct Cape {
    pub id: String,
    pub alias: String,
    pub url: String,
    /// "ACTIVE" | "INACTIVE"
    pub state: String,
    pub data_url: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct SkinProfile {
    pub account_id: String,
    pub username: String,
    pub skin: Option<ActiveSkin>,
    pub capes: Vec<Cape>,
}

/// Eintrag der Bibliothek, wie ihn das Frontend sieht.
#[derive(Debug, Clone, Serialize)]
pub struct LibrarySkin {
    pub id: String,
    pub name: String,
    pub variant: SkinVariant,
    /// Dateiname im Ordner `skins/`
    pub file: String,
    pub added_at: i64,
    /// Herkunft, z. B. "file", "account:<name>", "player:<name>", "import:modrinth"
    pub source: Option<String>,
    /// Zugeordnetes Mojang-Cape (UUID), z. B. aus der Modrinth App übernommen
    pub cape_id: Option<String>,
    pub data_url: String,
}

