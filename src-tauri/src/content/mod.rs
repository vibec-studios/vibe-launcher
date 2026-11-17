//! Inhalte: Modrinth- und CurseForge-Integration (Suche, Details, Versionen, Installation mit
//! Abhängigkeiten, Updates), Verwaltung installierter Mods/Packs/Shader, Welten,
//! Import (mrpack, CurseForge-ZIP, vlpack, Prism/MultiMC) und Export.
//!
//! OWNER: Content-Agent. Öffentliche Typen/Signaturen sind Teil des Vertrags (docs/CONTRACT.md).
use crate::instance::{Loader, LoaderKind};
use crate::paths::Paths;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tauri::AppHandle;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
pub enum Source {
    Modrinth,
    Curseforge,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
pub enum ProjectType {
    Mod,
    Modpack,
    Resourcepack,
    Shader,
    Datapack,
}

/// Ordner-Art in der Instanz.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
pub enum ContentKind {
    /// mods/
    Mod,
    /// resourcepacks/
    Resourcepack,
    /// shaderpacks/
    Shader,
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
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchResult {
    pub hits: Vec<ProjectHit>,
    pub total: u64,
    pub offset: u32,
    pub limit: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GalleryImage {
    pub url: String,
    pub title: Option<String>,
    pub description: Option<String>,
    pub featured: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ProjectLinks {
    pub website: Option<String>,
    pub source: Option<String>,
    pub issues: Option<String>,
    pub wiki: Option<String>,
    pub discord: Option<String>,
}

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

/// Installierter Inhalt in einer Instanz.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContentItem {
    /// Dateiname im Ordner (inkl. ".disabled", falls deaktiviert)
    pub file_name: String,
    pub kind: ContentKind,
    pub enabled: bool,
    /// Anzeigename (aus Metadaten oder Dateiname)
    pub name: String,
    pub version: Option<String>,
    pub description: Option<String>,
    pub authors: Vec<String>,
    /// data:-URL oder http-URL des Icons
    pub icon: Option<String>,
    pub source: Option<Source>,
    pub project_id: Option<String>,
    pub version_id: Option<String>,
    pub size: u64,
    pub modified: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContentUpdate {
    pub file_name: String,
    pub kind: ContentKind,
    pub source: Source,
    pub project_id: String,
    pub current_version: Option<String>,
    pub new_version: ProjectVersion,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct World {
    /// Ordnername in saves/
    pub folder: String,
    pub name: String,
    pub last_played: Option<i64>,
    /// "survival" | "creative" | "adventure" | "spectator" | "hardcore"
    pub game_mode: Option<String>,
    /// data:-URL von icon.png
    pub icon: Option<String>,
    pub size: Option<u64>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum PackFormat {
    Mrpack,
    Curseforge,
    Vlpack,
    Prism,
    Multimc,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImportPreview {
    pub format: PackFormat,
    pub name: String,
    pub version_name: Option<String>,
    pub mc_version: String,
    pub loader: Loader,
    /// Anzahl herunterzuladender Dateien (Mods etc.)
    pub file_count: u32,
    /// data:-URL
    pub icon: Option<String>,
    pub author: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ExportOptions {
    pub format: PackFormat,
    /// Zieldatei (vollständiger Pfad)
    pub dest: String,
    pub name: String,
    pub version: String,
    pub author: Option<String>,
    pub description: Option<String>,
    /// Relative Pfade im Spielordner, die als Overrides/Dateien mitkommen (Ordner oder Dateien)
    pub include: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ExportEntry {
    /// Relativer Pfad im Spielordner
    pub path: String,
    pub is_dir: bool,
    pub size: u64,
    /// Standardmäßig ausgewählt (z. B. config/, mods/; nicht saves/, logs/)
    pub default_selected: bool,
}

/// Datei, die nicht automatisch geladen werden durfte (CurseForge: Drittanbieter-Download gesperrt).
/// Wird je Instanz in `instances/<id>/missing.json` gespeichert.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MissingDownload {
    pub file_name: String,
    pub project_name: String,
    /// Seite, auf der der Nutzer die Datei manuell herunterladen kann
    pub page_url: String,
    pub kind: ContentKind,
}

pub struct ContentState {
    #[allow(dead_code)]
    paths: Paths,
    #[allow(dead_code)]
    app: AppHandle,
}

impl ContentState {
    pub fn new(paths: Paths, app: AppHandle) -> Arc<Self> {
        Arc::new(ContentState { paths, app })
    }
}
