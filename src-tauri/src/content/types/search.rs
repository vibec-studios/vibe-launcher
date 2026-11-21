use super::*;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
pub enum ProjectType {
    Mod,
    Modpack,
    Resourcepack,
    Shader,
    Datapack,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SortOrder {
    Relevance,
    Downloads,
    Follows,
    Newest,
    Updated,
}

#[derive(Debug, Clone, Deserialize)]
pub struct SearchQuery {
    pub source: Source,
    pub query: String,
    pub project_type: ProjectType,
    pub game_version: Option<String>,
    pub loader: Option<LoaderKind>,
    #[serde(default)]
    pub categories: Vec<String>,
    pub sort: SortOrder,
    pub offset: u32,
    pub limit: u32,
    /// Nur Projekte, die nach diesem Zeitpunkt (Unix-Sekunden) angelegt wurden (Modrinth; „Im Trend“)
    #[serde(default)]
    pub created_after: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectHit {
    pub source: Source,
    pub id: String,
    pub slug: String,
    pub title: String,
    pub description: String,
    pub author: String,
    pub icon_url: Option<String>,
    pub downloads: u64,
    pub follows: u64,
    pub categories: Vec<String>,
    pub project_type: ProjectType,
    /// ISO-8601
    pub updated: Option<String>,
    pub game_versions: Vec<String>,
    pub loaders: Vec<String>,
    /// Vorschaubild (hervorgehobenes Galerie-Bild bzw. erstes Bild), falls vorhanden
    #[serde(default)]
    pub banner_url: Option<String>,
    /// Markenfarbe des Projekts (RGB als Zahl, Modrinth)
    #[serde(default)]
    pub color: Option<u32>,
    /// ISO-8601, angelegt
    #[serde(default)]
    pub created: Option<String>,
    /// CurseForge: Der Autor erlaubt keine Downloads über andere Launcher (`allowModDistribution == false`).
    /// Dateien müssen auf curseforge.com geladen werden (siehe `content_manual_target`).
    #[serde(default)]
    pub manual_download: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchResult {
    pub hits: Vec<ProjectHit>,
    pub total: u64,
    pub offset: u32,
    pub limit: u32,
}
