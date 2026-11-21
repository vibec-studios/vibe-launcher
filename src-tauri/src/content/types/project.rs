use super::*;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectDetails {
    #[serde(flatten)]
    pub hit: ProjectHit,
    /// Beschreibung (Markdown bei Modrinth, HTML bei CurseForge)
    pub body: String,
    /// "markdown" | "html"
    pub body_format: String,
    pub gallery: Vec<GalleryImage>,
    pub links: ProjectLinks,
    pub license: Option<String>,
    pub published: Option<String>,
    /// Webseite des Projekts auf modrinth.com / curseforge.com
    pub page_url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VersionFile {
    /// `None`, wenn CurseForge den Download für Drittanbieter sperrt
    pub url: Option<String>,
    pub filename: String,
    pub size: u64,
    pub sha1: Option<String>,
    pub primary: bool,
    /// SHA-512 (nur Modrinth), für mrpack-Export
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sha512: Option<String>,
    /// CurseForge-Fingerprint (MurmurHash2), zum Wiedererkennen manuell geladener Dateien
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fingerprint: Option<u32>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum DependencyKind {
    Required,
    Optional,
    Incompatible,
    Embedded,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Dependency {
    pub project_id: Option<String>,
    pub version_id: Option<String>,
    pub kind: DependencyKind,
    /// Quelle der Abhängigkeit, falls sie von der Quelle des Projekts abweicht (Stores -> Modrinth)
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source: Option<Source>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectVersion {
    pub source: Source,
    pub id: String,
    pub project_id: String,
    pub name: String,
    pub version_number: String,
    pub game_versions: Vec<String>,
    pub loaders: Vec<String>,
    /// "release" | "beta" | "alpha"
    pub release_type: String,
    /// ISO-8601
    pub date: String,
    pub downloads: u64,
    pub files: Vec<VersionFile>,
    pub dependencies: Vec<Dependency>,
    pub changelog: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Category {
    pub id: String,
    pub name: String,
    /// SVG-Markup oder URL
    pub icon: Option<String>,
}
