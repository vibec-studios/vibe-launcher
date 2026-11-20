//! Inhalte: Modrinth- und CurseForge-Integration (Suche, Details, Versionen, Installation mit
//! Abhängigkeiten, Updates), Verwaltung installierter Mods/Packs/Shader, Welten,
//! Import (mrpack, CurseForge-ZIP, vlpack, Prism/MultiMC) und Export.
//!
//! OWNER: Content-Agent. Öffentliche Typen/Signaturen sind Teil des Vertrags (docs/CONTRACT.md).
use crate::instance::{Loader, LoaderKind};
use crate::paths::Paths;
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tauri::AppHandle;

pub mod curseforge;
pub mod datapacks;
pub mod export;
pub mod external;
pub mod gamedata;
pub mod extsettings;
pub mod http;
pub mod import;
pub mod index;
pub mod install;
pub mod local;
pub mod meta;
pub mod missing;
pub mod modrinth;
pub mod norisk;
pub mod murmur;
pub mod nbt;
pub mod provider;
pub mod store;
pub mod snapshots;
pub mod deps;
pub mod autofix;
pub mod loaderfix;
pub mod refresh;
pub mod sides;
pub mod modsets;
pub mod sets;
pub mod sets_apply;
pub mod perf;
pub mod modpack;
pub mod autoupdate;
pub mod worlds;
pub mod worldbackup;

/// Herkunft: Modrinth, CurseForge oder ein eigener Store (serialisiert als `"store:<id>"`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Source {
    Modrinth,
    Curseforge,
    Store(StoreKey),
}

/// Internierte Store-ID (hält `Source` klein und `Copy`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct StoreKey(u32);

static STORE_IDS: std::sync::OnceLock<parking_lot::RwLock<Vec<String>>> = std::sync::OnceLock::new();

impl StoreKey {
    pub fn intern(id: &str) -> StoreKey {
        let reg = STORE_IDS.get_or_init(Default::default);
        if let Some(i) = reg.read().iter().position(|s| s == id) {
            return StoreKey(i as u32);
        }
        let mut w = reg.write();
        if let Some(i) = w.iter().position(|s| s == id) {
            return StoreKey(i as u32);
        }
        w.push(id.to_string());
        StoreKey((w.len() - 1) as u32)
    }
    pub fn id(&self) -> String {
        STORE_IDS.get_or_init(Default::default).read().get(self.0 as usize).cloned().unwrap_or_default()
    }
}

impl Source {
    pub fn store(id: &str) -> Source {
        Source::Store(StoreKey::intern(id))
    }
    pub fn as_string(&self) -> String {
        match self {
            Source::Modrinth => "modrinth".into(),
            Source::Curseforge => "curseforge".into(),
            Source::Store(k) => format!("store:{}", k.id()),
        }
    }
    pub fn parse(s: &str) -> Option<Source> {
        match s {
            "modrinth" => Some(Source::Modrinth),
            "curseforge" => Some(Source::Curseforge),
            _ => s.strip_prefix("store:").filter(|id| !id.is_empty()).map(Source::store),
        }
    }
}

impl Serialize for Source {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&self.as_string())
    }
}

impl<'de> Deserialize<'de> for Source {
    fn deserialize<D: serde::Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        let s = String::deserialize(d)?;
        Source::parse(&s).ok_or_else(|| serde::de::Error::custom(format!("unbekannte Quelle: {s}")))
    }
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
    /// datapacks/ im Spielordner (siehe docs/CONTRACT.md: global, nicht je Welt)
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
    /// Version fixiert: kein automatisches Update, nicht bei „Alle aktualisieren“
    #[serde(default)]
    pub pinned: bool,
    /// Client/Server-Einordnung
    #[serde(default = "side_unknown")]
    pub side: Side,
}

fn side_unknown() -> Side {
    Side::Unknown
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContentUpdate {
    pub file_name: String,
    pub kind: ContentKind,
    pub source: Source,
    pub project_id: String,
    pub current_version: Option<String>,
    pub new_version: ProjectVersion,
    /// Neue Datei darf nicht automatisch geladen werden (CurseForge, Autor sperrt Fremd-Downloads, kein
    /// Modrinth-Spiegel) -> nur manuell über `page_url`; „Alle aktualisieren“ überspringt sie.
    #[serde(default)]
    pub manual: bool,
    /// Dateiseite der neuen Version (bei `manual`)
    #[serde(default)]
    pub page_url: Option<String>,
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
    /// Herunterzuladende Dateien mit Client/Server-Einordnung (mrpack `env`; sonst unbekannt)
    #[serde(default)]
    pub files: Vec<ImportFile>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImportFile {
    pub path: String,
    pub side: Side,
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
    /// Versionsnummer der erwarteten Datei (falls bekannt)
    #[serde(default)]
    pub version_number: Option<String>,
    /// Ersetzt beim Eintreffen eine ältere Version (manuelles Update)
    #[serde(default)]
    pub is_update: bool,
}

/// Ziel eines manuellen Downloads (für „Auf CurseForge herunterladen“).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ManualTarget {
    /// Dateiseite der passenden Version auf curseforge.com
    pub page_url: String,
    pub file_name: String,
    pub version_id: String,
    pub version_number: String,
    /// Doch automatisch ladbar (Datei freigegeben oder identisch auf Modrinth) -> normal installieren
    pub downloadable: bool,
}

/// Manuell geladene Datei wurde im Download-Ordner gefunden und in die Instanz übernommen
/// (Event `content://manual-arrived`).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ManualArrived {
    pub instance_id: String,
    pub project_id: Option<String>,
    pub project_name: String,
    pub file_name: String,
    pub kind: ContentKind,
}

/// Ergebnis von `content_missing_scan`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MissingScan {
    /// Übernommene Dateien
    pub found: Vec<MissingDownload>,
    /// Noch fehlende Dateien
    pub remaining: Vec<MissingDownload>,
    /// Durchsuchter Ordner (System-Downloads), falls vorhanden
    pub folder: Option<String>,
    /// Download-Ordner wird bis zu diesem Zeitpunkt (ms seit Epoch) weiter beobachtet
    pub watching_until: Option<i64>,
}

/// Wo ein Inhalt gebraucht wird.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
pub enum Side {
    /// nur Client (z. B. Shader, Minimap)
    Client,
    /// Client und Server
    Both,
    /// nur Server
    Server,
    /// unbekannt
    Unknown,
}

/// Anderer Launcher, aus dem Instanzen übernommen werden können.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
pub enum LauncherKind {
    Modrinth,
    Prism,
    Multimc,
    Curseforge,
    Atlauncher,
    /// NoRisk Client Launcher (Profile aus `meta/app.db`)
    Norisk,
    /// Beliebiger Spielordner ohne Launcher-Metadaten (nur über `launcher_scan_dir`)
    Folder,
}

#[derive(Debug, Clone, Serialize)]
pub struct ExternalInstance {
    /// Instanzordner im fremden Launcher (Kennung für `import_external`)
    pub source_path: String,
    pub name: String,
    /// Leer, wenn unbekannt (dann `warning` gesetzt)
    pub mc_version: String,
    pub loader: Loader,
    /// data:-URL
    pub icon: Option<String>,
    pub mod_count: u32,
    /// ms seit Epoch
    pub last_played: Option<i64>,
    pub play_time_secs: Option<u64>,
    /// Größe in Bytes (bei der Erkennung nicht berechnet)
    pub size: Option<u64>,
    /// z. B. "Version/Loader aus den Mods geschätzt – bitte prüfen"
    pub warning: Option<String>,
    /// ID der Vibe-Instanz, falls diese Instanz schon importiert wurde
    pub imported_as: Option<String>,
    /// Einstellungen der Instanz im fremden Launcher (RAM, Java, Fenster …), `None` = keine gefunden
    pub settings: Option<extsettings::ExtSettings>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ExternalLauncher {
    pub id: LauncherKind,
    pub name: String,
    /// Wurzelordner des Launchers bzw. gewählter Ordner
    pub path: String,
    pub instances: Vec<ExternalInstance>,
}

impl ContentKind {
    pub const ALL: [ContentKind; 4] = [ContentKind::Mod, ContentKind::Resourcepack, ContentKind::Shader, ContentKind::Datapack];

    /// Ordner im Spielordner.
    pub fn folder(&self) -> &'static str {
        match self {
            ContentKind::Mod => "mods",
            ContentKind::Resourcepack => "resourcepacks",
            ContentKind::Shader => "shaderpacks",
            ContentKind::Datapack => "datapacks",
        }
    }

    pub fn from_folder(folder: &str) -> Option<ContentKind> {
        ContentKind::ALL.into_iter().find(|k| k.folder() == folder)
    }
}

const CACHE_TTL: Duration = Duration::from_secs(10 * 60);
const CACHE_MAX: usize = 600;

/// Laufzeit-Zustand des Content-Moduls: kurzlebiger API-Cache, Sperren je Instanz für `content.json`,
/// laufende Hash-Zuordnungen.
pub struct ContentState {
    /// Datenordner (Kopie aus `AppState`, für Hintergrundarbeit ohne AppState)
    pub paths: Paths,
    pub(crate) app: AppHandle,
    cache: Mutex<HashMap<String, (Instant, bytes::Bytes)>>,
    locks: Mutex<HashMap<String, Arc<tokio::sync::Mutex<()>>>>,
    /// Instanzen, für die gerade eine Hash-Zuordnung im Hintergrund läuft
    pub(crate) identifying: Mutex<HashSet<String>>,
    /// Letzter fehlgeschlagener Zuordnungsversuch je Instanz (Netzwerk) – nicht sofort wiederholen
    pub(crate) identify_backoff: Mutex<HashMap<String, Instant>>,
    /// Geladene Store-Dateien (Vibe Store v1)
    pub(crate) stores: Mutex<HashMap<String, store::CacheEntry>>,
    /// Anzahl verfügbarer Updates je Instanz (Hintergrundprüfung nach dem Start)
    pub(crate) update_counts: Mutex<HashMap<String, u32>>,
    /// Download-Ordner auf manuelle Downloads beobachten: Instanz -> Ende der Beobachtung
    pub(crate) manual_watch: Mutex<HashMap<String, Instant>>,
    /// Läuft die Beobachtungsschleife?
    pub(crate) manual_watch_running: std::sync::atomic::AtomicBool,
}

impl ContentState {
    pub fn new(paths: Paths, app: AppHandle) -> Arc<Self> {
        Arc::new(ContentState {
            paths,
            app,
            cache: Mutex::new(HashMap::new()),
            locks: Mutex::new(HashMap::new()),
            identifying: Mutex::new(HashSet::new()),
            identify_backoff: Mutex::new(HashMap::new()),
            stores: Mutex::new(HashMap::new()),
            update_counts: Mutex::new(HashMap::new()),
            manual_watch: Mutex::new(HashMap::new()),
            manual_watch_running: std::sync::atomic::AtomicBool::new(false),
        })
    }

    pub(crate) fn cache_get(&self, key: &str) -> Option<bytes::Bytes> {
        let map = self.cache.lock();
        map.get(key).filter(|(t, _)| t.elapsed() < CACHE_TTL).map(|(_, b)| b.clone())
    }

    pub(crate) fn cache_put(&self, key: String, value: bytes::Bytes) {
        let mut map = self.cache.lock();
        if map.len() >= CACHE_MAX {
            map.retain(|_, (t, _)| t.elapsed() < CACHE_TTL);
            if map.len() >= CACHE_MAX {
                let mut v: Vec<(String, Instant)> = map.iter().map(|(k, (t, _))| (k.clone(), *t)).collect();
                v.sort_by_key(|(_, t)| *t);
                for (k, _) in v.into_iter().take(CACHE_MAX / 2) {
                    map.remove(&k);
                }
            }
        }
        map.insert(key, (Instant::now(), value));
    }

    /// Kurzzeit-Cache der Plattform-APIs und geladene Store-Dateien verwerfen („Neu prüfen“).
    pub(crate) fn clear_api_cache(&self) {
        self.cache.lock().clear();
        self.stores.lock().clear();
    }

    /// Sperre für Lese-Ändere-Schreibe-Zyklen an `content.json` einer Instanz.
    pub(crate) fn lock(&self, instance_id: &str) -> Arc<tokio::sync::Mutex<()>> {
        self.locks.lock().entry(instance_id.to_string()).or_default().clone()
    }

    pub(crate) fn emit_changed(&self, instance_id: &str) {
        crate::events::emit(&self.app, crate::events::CONTENT_CHANGED, &serde_json::json!({ "instance_id": instance_id }));
    }
}

