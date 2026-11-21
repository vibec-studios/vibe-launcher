use super::*;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct LinkLoader {
    pub kind: String,
    #[serde(default)]
    pub version: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct LinkPack {
    pub source: String,
    pub project_id: String,
    pub version_id: String,
    #[serde(default)]
    pub title: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct LinkMod {
    pub source: String,
    pub project_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub version_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub kind: Option<String>,
    /// Nur lokal in `instance.json` (nicht ans Backend): Dateiname im Ordner, damit der Client manuelle Mods erkennt
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub file: Option<String>,
}

/// Geteiltes Vibe-Pack (Share-Code und installierte Version) in `instance.json`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct LinkVibePackRef {
    pub code: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub version_id: Option<String>,
}

/// Vibe-Pack am Spiel-Link (`vibe_pack`, feste Version).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct LinkVibePack {
    pub code: String,
    pub version_id: String,
    #[serde(default)]
    pub version: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub icon_url: Option<String>,
    #[serde(default)]
    pub mc_version: String,
    #[serde(default)]
    pub loader: String,
    #[serde(default)]
    pub loader_version: Option<String>,
    #[serde(default)]
    pub file_count: u32,
    #[serde(default)]
    pub latest_version_id: Option<String>,
    #[serde(default = "yes")]
    pub available: bool,
}

pub(super) fn yes() -> bool {
    true
}

/// `<spielordner>/.vibe/instance.json` (schema 1).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct InstanceFile {
    pub schema: u32,
    pub name: String,
    pub mc_version: String,
    pub loader: LinkLoader,
    pub pack: Option<LinkPack>,
    pub mods: Vec<LinkMod>,
    pub client_pack: Option<String>,
    /// Geteiltes Vibe-Pack der Instanz (eigenes oder gefolgtes); der Client reicht es an `POST /play-links` weiter
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub vibe_pack: Option<LinkVibePackRef>,
    /// Nur lokal: weitere Dateien mit bekannter Quelle (Pfade relativ zum Spielordner). Bei Modpacks leer, weil
    /// Override-Dateien nicht im Index stehen – der Client zeigt dann keinen Hinweis auf manuelle Mods.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub known_files: Vec<String>,
}

/// `<spielordner>/.vibe/session.json` (schema 1), geschrieben vom Vibey Client.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub struct Session {
    pub schema: u32,
    /// menu | singleplayer | hosting | multiplayer
    pub state: String,
    #[serde(default)]
    pub server: Option<String>,
    #[serde(default)]
    pub world: Option<String>,
    #[serde(default)]
    pub play_link: Option<String>,
    #[serde(default)]
    pub players: Option<u32>,
    #[serde(default)]
    pub max_players: Option<u32>,
    #[serde(default)]
    pub updated_at: i64,
}

/// Spiel-Link vom Backend (`GET /api/v1/play-links/<code>`).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct PlayLink {
    pub code: String,
    pub url: String,
    pub host: LinkHost,
    pub relay_host: String,
    pub mc_version: String,
    pub loader: LinkLoader,
    #[serde(default)]
    pub pack: Option<LinkPack>,
    #[serde(default)]
    pub mods: Vec<LinkMod>,
    #[serde(default)]
    pub client_pack: Option<String>,
    #[serde(default)]
    pub world_name: Option<String>,
    #[serde(default)]
    pub max_players: Option<u32>,
    #[serde(default)]
    pub active: bool,
    pub expires_at: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub vibe_pack: Option<LinkVibePack>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct LinkHost {
    pub uuid: String,
    pub name: String,
}
