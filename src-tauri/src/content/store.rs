//! Eigene Stores im Format „Vibe Store v1“ (docs/STORE.md): eine JSON-Datei per URL.
//!
//! Die Datei wird mit ETag/If-Modified-Since geladen, ~10 Minuten im Speicher und zusätzlich unter
//! `cache/stores/<id>.json` gehalten (Offline-Fallback). Suche/Filter laufen clientseitig über den Cache.
use super::provider::Brief;
use super::*;
use crate::error::{AppError, AppResult};
use crate::settings::StoreConfig;
use crate::state::AppState;
use serde::Deserialize;
use std::path::PathBuf;

pub const DEFAULT_ID: &str = "vibe-craft-studios";
pub const DEFAULT_NAME: &str = "Vibe Craft Studios";
pub const DEFAULT_URL: &str = "https://vibec-studios.github.io/data/store.json";
const TTL: Duration = Duration::from_secs(10 * 60);

pub fn default_stores() -> Vec<StoreConfig> {
    vec![StoreConfig { id: DEFAULT_ID.into(), name: DEFAULT_NAME.into(), url: DEFAULT_URL.into(), enabled: true, icon: None }]
}

/// Konfigurierte Stores; der Standard-Store ist immer enthalten.
pub fn configured(settings: &crate::settings::Settings) -> Vec<StoreConfig> {
    let mut v = settings.stores.clone();
    if !v.iter().any(|s| s.id == DEFAULT_ID) {
        v.insert(0, default_stores().remove(0));
    }
    v
}

fn config(state: &AppState, id: &str) -> AppResult<StoreConfig> {
    configured(&state.settings()).into_iter().find(|s| s.id == id).ok_or_else(|| AppError::NotFound(format!("Store {id}")))
}

// ------------------------------------------------------------------ Format

#[derive(Debug, Clone, Deserialize, Serialize, Default)]
#[serde(default)]
pub struct StoreFile {
    pub format: String,
    pub version: u32,
    pub id: String,
    pub name: String,
    pub icon: Option<String>,
    pub homepage: Option<String>,
    pub description: Option<String>,
    pub projects: Vec<StoreProject>,
}

#[derive(Debug, Clone, Deserialize, Serialize, Default)]
#[serde(default)]
pub struct StoreGallery {
    pub url: String,
    pub title: Option<String>,
    pub description: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize, Default)]
#[serde(default)]
pub struct StoreLinks {
    pub website: Option<String>,
    pub source: Option<String>,
    pub issues: Option<String>,
    pub wiki: Option<String>,
    pub discord: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize, Default)]
#[serde(default)]
pub struct StoreProject {
    pub id: String,
    pub slug: Option<String>,
    pub title: String,
    pub description: String,
    pub author: Option<String>,
    pub icon: Option<String>,
    pub project_type: Option<String>,
    pub categories: Vec<String>,
    pub body: Option<String>,
    pub gallery: Vec<StoreGallery>,
    pub links: StoreLinks,
    pub license: Option<String>,
    pub downloads: Option<u64>,
    pub published: Option<String>,
    pub updated: Option<String>,
    /// "required" | "optional" | "unsupported" (wie Modrinth)
    pub client_side: Option<String>,
    pub server_side: Option<String>,
    pub versions: Vec<StoreVersion>,
}

#[derive(Debug, Clone, Deserialize, Serialize, Default)]
#[serde(default)]
pub struct StoreFileEntry {
    pub url: String,
    pub filename: String,
    pub size: u64,
    pub sha1: Option<String>,
    pub sha256: Option<String>,
    pub sha512: Option<String>,
    pub primary: Option<bool>,
}

#[derive(Debug, Clone, Deserialize, Serialize, Default)]
#[serde(default)]
pub struct StoreDep {
    pub source: Option<String>,
    pub project_id: String,
    pub version_id: Option<String>,
    pub kind: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize, Default)]
#[serde(default)]
pub struct StoreVersion {
    pub id: String,
    pub version_number: String,
    pub name: Option<String>,
    pub release_type: Option<String>,
    pub date: String,
    pub game_versions: Vec<String>,
    pub loaders: Vec<String>,
    pub changelog: Option<String>,
    pub files: Vec<StoreFileEntry>,
    pub dependencies: Vec<StoreDep>,
    pub downloads: Option<u64>,
}

/// Format prüfen (Pflichtfelder, Version).
pub fn validate(f: &StoreFile) -> AppResult<()> {
    if f.format != "vibe-store" {
        return Err(AppError::Invalid("Keine Vibe-Store-Datei (\"format\": \"vibe-store\" fehlt)".into()));
    }
    if f.version == 0 || f.version > 1 {
        return Err(AppError::Invalid(format!("Store-Format Version {} wird nicht unterstützt – bitte Launcher aktualisieren", f.version)));
    }
    if f.id.trim().is_empty() || !f.id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_') {
        return Err(AppError::Invalid("Store-ID fehlt oder enthält ungültige Zeichen (erlaubt: a-z, 0-9, -)".into()));
    }
    if f.name.trim().is_empty() {
        return Err(AppError::Invalid("Store-Name fehlt".into()));
    }
    Ok(())
}

// ------------------------------------------------------------------ Laden + Cache

#[derive(Clone)]
pub struct CacheEntry {
    url: String,
    fetched: Instant,
    etag: Option<String>,
    last_modified: Option<String>,
    pub data: Arc<StoreFile>,
}

#[derive(Serialize, Deserialize)]
struct DiskMeta {
    url: String,
    etag: Option<String>,
    last_modified: Option<String>,
}

fn disk_paths(state: &AppState, id: &str) -> (PathBuf, PathBuf) {
    let dir = state.paths.cache().join("stores");
    (dir.join(format!("{id}.json")), dir.join(format!("{id}.meta.json")))
}

/// Datei laden (bedingt, mit Cache). `force` ignoriert die Frist.
async fn fetch(state: &AppState, id: &str, url: &str, force: bool) -> AppResult<Arc<StoreFile>> {
    let cached = state.content.stores.lock().get(id).cloned().filter(|c| c.url == url);
    if let Some(c) = &cached {
        if !force && c.fetched.elapsed() < TTL {
            return Ok(c.data.clone());
        }
    }
    // Plattencache als Grundlage für bedingte Anfragen / Offline
    let (data_p, meta_p) = disk_paths(state, id);
    let disk: Option<(DiskMeta, Arc<StoreFile>)> = if cached.is_none() {
        let m = std::fs::read(&meta_p).ok().and_then(|b| serde_json::from_slice::<DiskMeta>(&b).ok()).filter(|m| m.url == url);
        let d = std::fs::read(&data_p).ok().and_then(|b| serde_json::from_slice::<StoreFile>(&b).ok());
        m.zip(d).map(|(m, d)| (m, Arc::new(d)))
    } else {
        None
    };
    let (etag, lm, prev) = match (&cached, &disk) {
        (Some(c), _) => (c.etag.clone(), c.last_modified.clone(), Some(c.data.clone())),
        (None, Some((m, d))) => (m.etag.clone(), m.last_modified.clone(), Some(d.clone())),
        _ => (None, None, None),
    };
    let mut rb = state.net.client.get(url).header("Accept", "application/json").timeout(Duration::from_secs(30));
    if prev.is_some() {
        if let Some(e) = &etag {
            rb = rb.header("If-None-Match", e);
        }
        if let Some(l) = &lm {
            rb = rb.header("If-Modified-Since", l);
        }
    }
    let res = rb.send().await;
    let store_entry = |data: Arc<StoreFile>, etag: Option<String>, lm: Option<String>| {
        state.content.stores.lock().insert(id.to_string(), CacheEntry { url: url.to_string(), fetched: Instant::now(), etag, last_modified: lm, data: data.clone() });
        data
    };
    match res {
        Ok(r) if r.status().as_u16() == 304 && prev.is_some() => Ok(store_entry(prev.unwrap_or_default(), etag, lm)),
        Ok(r) if r.status().is_success() => {
            let h = |n: &str| r.headers().get(n).and_then(|v| v.to_str().ok()).map(str::to_string);
            let (etag, lm) = (h("etag"), h("last-modified"));
            let bytes = r.bytes().await?;
            let file: StoreFile = serde_json::from_slice(&bytes).map_err(|e| AppError::Invalid(format!("Store-Datei ist kein gültiges JSON: {e}")))?;
            validate(&file)?;
            if let Some(dir) = data_p.parent() {
                let _ = std::fs::create_dir_all(dir);
            }
            let _ = std::fs::write(&data_p, &bytes);
            let _ = crate::util::write_json_atomic(&meta_p, &DiskMeta { url: url.to_string(), etag: etag.clone(), last_modified: lm.clone() });
            Ok(store_entry(Arc::new(file), etag, lm))
        }
        Ok(r) => {
            let code = r.status().as_u16();
            match prev {
                Some(p) if code >= 500 || code == 429 => Ok(store_entry(p, etag, lm)),
                _ => Err(AppError::msg(format!("Store nicht erreichbar (HTTP {code})"))),
            }
        }
        Err(e) => match prev {
            Some(p) => {
                tracing::warn!("Store {id} nicht erreichbar, nutze Cache: {e}");
                Ok(store_entry(p, etag, lm))
            }
            None => Err(AppError::msg(format!("Store nicht erreichbar – Internetverbindung prüfen ({e})"))),
        },
    }
}

/// Store-Daten (aus dem Cache oder frisch geladen).
pub async fn load(state: &AppState, key: StoreKey) -> AppResult<Arc<StoreFile>> {
    let id = key.id();
    let cfg = config(state, &id)?;
    fetch(state, &id, &cfg.url, false).await
}

/// Alle aktivierten Stores (Fehler einzelner Stores werden geloggt und übersprungen).
pub async fn load_enabled(state: &AppState) -> Vec<(StoreKey, Arc<StoreFile>)> {
    let cfgs: Vec<StoreConfig> = configured(&state.settings()).into_iter().filter(|s| s.enabled).collect();
    let futs = cfgs.iter().map(|c| async move { (c.id.clone(), fetch(state, &c.id, &c.url, false).await) });
    let mut out = Vec::new();
    for (id, r) in futures::future::join_all(futs).await {
        match r {
            Ok(f) => out.push((StoreKey::intern(&id), f)),
            Err(e) => tracing::warn!("Store {id}: {e}"),
        }
    }
    out
}

// ------------------------------------------------------------------ Mapping

fn ptype(p: &StoreProject) -> ProjectType {
    super::modrinth::project_type_from(p.project_type.as_deref().unwrap_or("mod"))
}

fn version_key(s: &str) -> Vec<u64> {
    s.split(['.', '-']).map(|p| p.parse().unwrap_or(0)).collect()
}

fn hit(key: StoreKey, file: &StoreFile, p: &StoreProject) -> ProjectHit {
    let mut gv: Vec<String> = Vec::new();
    let mut loaders: Vec<String> = Vec::new();
    for v in &p.versions {
        for g in &v.game_versions {
            if !gv.contains(g) {
                gv.push(g.clone());
            }
        }
        for l in &v.loaders {
            if !loaders.contains(l) {
                loaders.push(l.clone());
            }
        }
    }
    gv.sort_by_key(|v| std::cmp::Reverse(version_key(v)));
    let updated = p.updated.clone().or_else(|| p.versions.iter().map(|v| v.date.clone()).max());
    ProjectHit {
        source: Source::Store(key),
        id: p.id.clone(),
        slug: p.slug.clone().unwrap_or_else(|| p.id.clone()),
        title: p.title.clone(),
        description: p.description.clone(),
        author: p.author.clone().unwrap_or_else(|| file.name.clone()),
        icon_url: p.icon.clone().filter(|i| !i.is_empty()),
        downloads: p.downloads.unwrap_or(0),
        follows: 0,
        categories: p.categories.clone(),
        project_type: ptype(p),
        updated,
        game_versions: gv,
        loaders,
        banner_url: None,
        color: None,
        created: None,
    }
}

fn dep_kind(k: Option<&str>) -> DependencyKind {
    match k.unwrap_or("required") {
        "optional" => DependencyKind::Optional,
        "incompatible" => DependencyKind::Incompatible,
        "embedded" => DependencyKind::Embedded,
        _ => DependencyKind::Required,
    }
}

pub fn convert_version(key: StoreKey, p: &StoreProject, v: &StoreVersion) -> ProjectVersion {
    ProjectVersion {
        source: Source::Store(key),
        id: v.id.clone(),
        project_id: p.id.clone(),
        name: v.name.clone().unwrap_or_else(|| v.version_number.clone()),
        version_number: v.version_number.clone(),
        game_versions: v.game_versions.clone(),
        loaders: v.loaders.clone(),
        release_type: match v.release_type.as_deref() {
            Some("beta") => "beta",
            Some("alpha") => "alpha",
            _ => "release",
        }
        .into(),
        date: v.date.clone(),
        downloads: v.downloads.unwrap_or(0),
        files: v
            .files
            .iter()
            .enumerate()
            .map(|(i, f)| VersionFile {
                url: Some(f.url.clone()).filter(|u| !u.is_empty()),
                filename: if f.filename.is_empty() { f.url.rsplit('/').next().unwrap_or("download").to_string() } else { f.filename.clone() },
                size: f.size,
                sha1: f.sha1.clone().map(|s| s.to_ascii_lowercase()),
                primary: f.primary.unwrap_or(i == 0),
                sha512: f.sha512.clone(),
            })
            .collect(),
        dependencies: v
            .dependencies
            .iter()
            .map(|d| Dependency {
                project_id: Some(d.project_id.clone()),
                version_id: d.version_id.clone(),
                kind: dep_kind(d.kind.as_deref()),
                source: Some(match d.source.as_deref() {
                    Some("modrinth") => Source::Modrinth,
                    Some("curseforge") => Source::Curseforge,
                    _ => Source::Store(key),
                }),
            })
            .collect(),
        changelog: v.changelog.clone().filter(|c| !c.trim().is_empty()),
    }
}

/// Client/Server laut Store-Angabe.
pub fn project_side(p: &StoreProject) -> Option<Side> {
    if p.client_side.is_none() && p.server_side.is_none() {
        return None;
    }
    Some(super::sides::from_sides(p.client_side.as_deref(), p.server_side.as_deref()))
}

fn find<'a>(file: &'a StoreFile, id: &str) -> AppResult<&'a StoreProject> {
    file.projects
        .iter()
        .find(|p| p.id == id || p.slug.as_deref() == Some(id))
        .ok_or_else(|| AppError::NotFound(format!("Projekt {id} im Store {}", file.name)))
}

fn matches_loader(p: &StoreProject, pt: ProjectType, loader: Option<LoaderKind>, mc: Option<&str>) -> bool {
    let Some(l) = loader else { return true };
    if !matches!(pt, ProjectType::Mod | ProjectType::Modpack) || l == LoaderKind::Vanilla {
        return true;
    }
    let Some((a, b)) = super::provider::modrinth_loaders(pt, l, mc.unwrap_or("")) else { return true };
    p.versions.iter().any(|v| v.loaders.iter().any(|x| a.contains(x) || b.contains(x)) && mc.map_or(true, |m| v.game_versions.iter().any(|g| g == m)))
}

// ------------------------------------------------------------------ Provider-Funktionen

pub async fn search(state: &AppState, key: StoreKey, q: &SearchQuery) -> AppResult<SearchResult> {
    let file = load(state, key).await?;
    let needle = q.query.trim().to_lowercase();
    let mc = q.game_version.as_deref().filter(|v| !v.is_empty());
    let mut list: Vec<(i32, &StoreProject)> = file
        .projects
        .iter()
        .filter(|p| ptype(p) == q.project_type || (q.project_type == ProjectType::Datapack && p.versions.iter().any(|v| v.loaders.iter().any(|l| l == "datapack"))))
        .filter(|p| mc.map_or(true, |m| p.versions.iter().any(|v| v.game_versions.iter().any(|g| g == m))))
        .filter(|p| matches_loader(p, q.project_type, q.loader, mc))
        .filter(|p| q.categories.iter().all(|c| p.categories.contains(c)))
        .filter_map(|p| {
            if needle.is_empty() {
                return Some((0, p));
            }
            let t = p.title.to_lowercase();
            let score = if t == needle {
                100
            } else if t.starts_with(&needle) {
                80
            } else if t.contains(&needle) {
                60
            } else if p.id.contains(&needle) || p.slug.as_deref().is_some_and(|s| s.contains(&needle)) {
                50
            } else if p.description.to_lowercase().contains(&needle) || p.categories.iter().any(|c| c.contains(&needle)) {
                30
            } else if p.author.as_deref().is_some_and(|a| a.to_lowercase().contains(&needle)) {
                20
            } else {
                return None;
            };
            Some((score, p))
        })
        .collect();
    let updated = |p: &StoreProject| p.updated.clone().or_else(|| p.versions.iter().map(|v| v.date.clone()).max()).unwrap_or_default();
    let published = |p: &StoreProject| p.published.clone().or_else(|| p.versions.iter().map(|v| v.date.clone()).min()).unwrap_or_default();
    match q.sort {
        SortOrder::Relevance => list.sort_by(|a, b| b.0.cmp(&a.0).then(b.1.downloads.cmp(&a.1.downloads)).then(a.1.title.cmp(&b.1.title))),
        SortOrder::Downloads | SortOrder::Follows => list.sort_by(|a, b| b.1.downloads.cmp(&a.1.downloads).then(a.1.title.cmp(&b.1.title))),
        SortOrder::Newest => list.sort_by_key(|(_, p)| std::cmp::Reverse(published(p))),
        SortOrder::Updated => list.sort_by_key(|(_, p)| std::cmp::Reverse(updated(p))),
    }
    let total = list.len() as u64;
    let limit = q.limit.clamp(1, 100);
    let hits = list.into_iter().skip(q.offset as usize).take(limit as usize).map(|(_, p)| hit(key, &file, p)).collect();
    Ok(SearchResult { hits, total, offset: q.offset, limit })
}

pub async fn categories(state: &AppState, key: StoreKey, pt: ProjectType) -> AppResult<Vec<Category>> {
    let file = load(state, key).await?;
    let mut cats: Vec<String> = Vec::new();
    for p in file.projects.iter().filter(|p| ptype(p) == pt) {
        for c in &p.categories {
            if !cats.contains(c) {
                cats.push(c.clone());
            }
        }
    }
    cats.sort();
    Ok(cats
        .into_iter()
        .map(|c| {
            let name = c
                .split(['-', '_'])
                .map(|w| {
                    let mut ch = w.chars();
                    ch.next().map(|f| f.to_uppercase().collect::<String>() + ch.as_str()).unwrap_or_default()
                })
                .collect::<Vec<_>>()
                .join(" ");
            Category { id: c, name, icon: None }
        })
        .collect())
}

pub async fn project(state: &AppState, key: StoreKey, id: &str) -> AppResult<ProjectDetails> {
    let file = load(state, key).await?;
    let p = find(&file, id)?;
    let hit = hit(key, &file, p);
    Ok(ProjectDetails {
        body: p.body.clone().unwrap_or_else(|| p.description.clone()),
        body_format: "markdown".into(),
        gallery: p.gallery.iter().map(|g| GalleryImage { url: g.url.clone(), title: g.title.clone(), description: g.description.clone(), featured: false }).collect(),
        links: ProjectLinks { website: p.links.website.clone(), source: p.links.source.clone(), issues: p.links.issues.clone(), wiki: p.links.wiki.clone(), discord: p.links.discord.clone() },
        license: p.license.clone(),
        published: p.published.clone().or_else(|| p.versions.iter().map(|v| v.date.clone()).min()),
        page_url: p.links.website.clone().or_else(|| file.homepage.clone()).unwrap_or_default(),
        hit,
    })
}

pub async fn brief(state: &AppState, key: StoreKey, id: &str) -> AppResult<Brief> {
    let file = load(state, key).await?;
    let p = find(&file, id)?;
    Ok(Brief {
        id: p.id.clone(),
        title: p.title.clone(),
        icon_url: p.icon.clone().filter(|i| !i.is_empty()),
        project_type: ptype(p),
        page_url: p.links.website.clone().or_else(|| file.homepage.clone()).unwrap_or_default(),
        side: project_side(p),
    })
}

/// Alle Versionen eines Projekts (neueste zuerst) + Projekttyp.
pub async fn versions(state: &AppState, key: StoreKey, id: &str) -> AppResult<(Vec<ProjectVersion>, ProjectType)> {
    let file = load(state, key).await?;
    let p = find(&file, id)?;
    let mut v: Vec<ProjectVersion> = p.versions.iter().map(|v| convert_version(key, p, v)).collect();
    v.sort_by(|a, b| b.date.cmp(&a.date));
    Ok((v, ptype(p)))
}

pub async fn version(state: &AppState, key: StoreKey, project_id: &str, version_id: &str) -> AppResult<ProjectVersion> {
    let file = load(state, key).await?;
    let p = find(&file, project_id)?;
    let v = p.versions.iter().find(|v| v.id == version_id).ok_or_else(|| AppError::NotFound(format!("Version {version_id}")))?;
    Ok(convert_version(key, p, v))
}

/// Treffer einer Hash-Zuordnung.
pub struct HashMatch {
    pub key: StoreKey,
    pub title: String,
    pub icon: Option<String>,
    pub version: ProjectVersion,
    pub url: String,
    pub size: u64,
    pub side: Option<Side>,
}

/// sha1/sha256 -> Datei in einem aktivierten Store.
pub async fn by_hash(state: &AppState, hashes: &[(String, Option<String>)]) -> HashMap<String, HashMatch> {
    let mut out = HashMap::new();
    if hashes.is_empty() {
        return out;
    }
    for (key, file) in load_enabled(state).await {
        for p in &file.projects {
            for v in &p.versions {
                for f in &v.files {
                    for (sha1, sha256) in hashes {
                        let hit1 = f.sha1.as_deref().is_some_and(|h| h.eq_ignore_ascii_case(sha1));
                        let hit256 = matches!((f.sha256.as_deref(), sha256.as_deref()), (Some(a), Some(b)) if a.eq_ignore_ascii_case(b));
                        if (hit1 || hit256) && !out.contains_key(sha1) {
                            out.insert(
                                sha1.clone(),
                                HashMatch {
                                    key,
                                    title: p.title.clone(),
                                    icon: p.icon.clone(),
                                    version: convert_version(key, p, v),
                                    url: f.url.clone(),
                                    size: f.size,
                                    side: project_side(p),
                                },
                            );
                        }
                    }
                }
            }
        }
    }
    out
}

// ------------------------------------------------------------------ Verwaltung (Commands)

#[derive(Debug, Clone, Serialize)]
pub struct StoreInfo {
    pub id: String,
    pub name: String,
    pub url: String,
    pub enabled: bool,
    pub icon: Option<String>,
    /// Standard-Store (kann nicht entfernt werden)
    pub builtin: bool,
    pub homepage: Option<String>,
    pub description: Option<String>,
    pub project_count: Option<u32>,
    /// Ladefehler (z. B. offline und kein Cache)
    pub error: Option<String>,
}

fn info(c: &StoreConfig, data: Result<&StoreFile, String>) -> StoreInfo {
    let (file, error) = match data {
        Ok(f) => (Some(f), None),
        Err(e) => (None, Some(e)),
    };
    StoreInfo {
        id: c.id.clone(),
        name: file.map(|f| f.name.clone()).unwrap_or_else(|| c.name.clone()),
        url: c.url.clone(),
        enabled: c.enabled,
        icon: file.and_then(|f| f.icon.clone()).or(c.icon.clone()),
        builtin: c.id == DEFAULT_ID,
        homepage: file.and_then(|f| f.homepage.clone()),
        description: file.and_then(|f| f.description.clone()),
        project_count: file.map(|f| f.projects.len() as u32),
        error,
    }
}

pub async fn list(state: &AppState) -> Vec<StoreInfo> {
    let cfgs = configured(&state.settings());
    let futs = cfgs.iter().map(|c| async move {
        if !c.enabled {
            // Deaktivierte nicht laden – nur vorhandenen Cache zeigen
            let cached = state.content.stores.lock().get(&c.id).map(|e| e.data.clone());
            return match cached {
                Some(f) => info(c, Ok(&f)),
                None => info(c, Err(String::new())).without_error(),
            };
        }
        match fetch(state, &c.id, &c.url, false).await {
            Ok(f) => info(c, Ok(&f)),
            Err(e) => info(c, Err(e.to_string())),
        }
    });
    futures::future::join_all(futs).await
}

impl StoreInfo {
    fn without_error(mut self) -> Self {
        self.error = None;
        self
    }
}

fn save_stores(state: &AppState, stores: Vec<StoreConfig>) -> AppResult<()> {
    let mut s = state.settings();
    s.stores = stores;
    s.save(&state.paths.settings_file())?;
    *state.settings.write() = s.clone();
    crate::events::emit(&state.app, crate::events::SETTINGS_CHANGED, &s);
    Ok(())
}

pub async fn add(state: &AppState, url: &str) -> AppResult<StoreInfo> {
    let url = url.trim();
    let parsed = url::Url::parse(url).map_err(|_| AppError::Invalid("Bitte eine vollständige URL angeben (https://…)".into()))?;
    if !matches!(parsed.scheme(), "https" | "http") {
        return Err(AppError::Invalid("Nur http(s)-Adressen werden unterstützt".into()));
    }
    // Probe laden (unter temporärer ID), dann unter der ID aus der Datei speichern
    let probe_id = format!("probe-{}", uuid::Uuid::new_v4());
    let file = fetch(state, &probe_id, url, true).await;
    state.content.stores.lock().remove(&probe_id);
    let (d, m) = disk_paths(state, &probe_id);
    let _ = std::fs::remove_file(d);
    let _ = std::fs::remove_file(m);
    let file = file?;
    let mut stores = configured(&state.settings());
    if let Some(existing) = stores.iter().find(|s| s.url == url || s.id == file.id) {
        if existing.url == url {
            return Err(AppError::Invalid(format!("Der Store „{}“ ist bereits eingetragen", existing.name)));
        }
        return Err(AppError::Invalid(format!("Ein Store mit der ID „{}“ ist bereits eingetragen", file.id)));
    }
    let cfg = StoreConfig { id: file.id.clone(), name: file.name.clone(), url: url.to_string(), enabled: true, icon: file.icon.clone() };
    stores.push(cfg.clone());
    save_stores(state, stores)?;
    let f = fetch(state, &cfg.id, &cfg.url, true).await?;
    Ok(info(&cfg, Ok(&f)))
}

pub fn remove(state: &AppState, id: &str) -> AppResult<()> {
    if id == DEFAULT_ID {
        return Err(AppError::Invalid("Der Standard-Store kann nur deaktiviert werden".into()));
    }
    let mut stores = configured(&state.settings());
    let before = stores.len();
    stores.retain(|s| s.id != id);
    if stores.len() == before {
        return Err(AppError::NotFound(format!("Store {id}")));
    }
    state.content.stores.lock().remove(id);
    let (d, m) = disk_paths(state, id);
    let _ = std::fs::remove_file(d);
    let _ = std::fs::remove_file(m);
    save_stores(state, stores)
}

pub fn set_enabled(state: &AppState, id: &str, enabled: bool) -> AppResult<()> {
    let mut stores = configured(&state.settings());
    let s = stores.iter_mut().find(|s| s.id == id).ok_or_else(|| AppError::NotFound(format!("Store {id}")))?;
    s.enabled = enabled;
    save_stores(state, stores)
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &str = r#"{
      "format":"vibe-store","version":1,"id":"test-store","name":"Test",
      "projects":[{"id":"hh-armors","title":"H&H Armors","description":"Rüstungen","project_type":"mod","categories":["equipment"],
        "versions":[
          {"id":"v2-fabric","version_number":"1.1","date":"2026-02-01","game_versions":["1.21.11"],"loaders":["fabric"],
           "files":[{"url":"https://x/a.jar","filename":"a.jar","size":3,"sha1":"ABC"}],
           "dependencies":[{"source":"modrinth","project_id":"P7dR8mSH","kind":"required"},{"source":"self","project_id":"core"}]},
          {"id":"v1-neo","version_number":"1.0","release_type":"beta","date":"2026-01-01","game_versions":["1.21.1"],"loaders":["neoforge"],"files":[{"url":"https://x/b.jar","size":3}]}
        ]}]}"#;

    #[test]
    fn parse_and_convert() {
        let f: StoreFile = serde_json::from_str(SAMPLE).unwrap();
        validate(&f).unwrap();
        let key = StoreKey::intern("test-store");
        let h = hit(key, &f, &f.projects[0]);
        assert_eq!(h.source.as_string(), "store:test-store");
        assert_eq!(h.game_versions, vec!["1.21.11", "1.21.1"]);
        assert_eq!(h.author, "Test");
        let v = convert_version(key, &f.projects[0], &f.projects[0].versions[0]);
        assert_eq!(v.files[0].sha1.as_deref(), Some("abc"));
        assert!(v.files[0].primary);
        assert_eq!(v.dependencies[0].source, Some(Source::Modrinth));
        assert_eq!(v.dependencies[1].source, Some(Source::Store(key)));
        assert_eq!(v.dependencies[1].kind, DependencyKind::Required);
        let v1 = convert_version(key, &f.projects[0], &f.projects[0].versions[1]);
        assert_eq!(v1.release_type, "beta");
        assert_eq!(v1.files[0].filename, "b.jar");
        assert!(matches_loader(&f.projects[0], ProjectType::Mod, Some(LoaderKind::Quilt), Some("1.21.11")));
        assert!(!matches_loader(&f.projects[0], ProjectType::Mod, Some(LoaderKind::Forge), Some("1.21.11")));
    }

    #[test]
    fn source_serde() {
        let s: Source = serde_json::from_str("\"store:vibe-craft-studios\"").unwrap();
        assert_eq!(serde_json::to_string(&s).unwrap(), "\"store:vibe-craft-studios\"");
        assert_eq!(serde_json::from_str::<Source>("\"modrinth\"").unwrap(), Source::Modrinth);
        assert!(serde_json::from_str::<Source>("\"store:\"").is_err());
        assert!(serde_json::from_str::<Source>("\"foo\"").is_err());
    }

    #[test]
    fn invalid_files() {
        let mut f: StoreFile = serde_json::from_str(SAMPLE).unwrap();
        f.version = 2;
        assert!(validate(&f).is_err());
        f.version = 1;
        f.id = "Bad ID!".into();
        assert!(validate(&f).is_err());
        f.id = "ok".into();
        f.format = "x".into();
        assert!(validate(&f).is_err());
    }
}
