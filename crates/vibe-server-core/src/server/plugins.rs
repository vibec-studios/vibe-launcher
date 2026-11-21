//! Erweiterungen eines Servers: Plugins (`plugins/`, Paper/Purpur/Folia) bzw. Mods (`mods/`, Fabric & Co.).
//! Liste mit Metadaten (plugin.yml / paper-plugin.yml / fabric.mod.json …), Suche und Installation über
//! Modrinth (Projekttyp „plugin“ bzw. „mod“) und Hangar (hangar.papermc.io, nur Plugins), Updates,
//! Aktivieren/Deaktivieren (`.disabled`), Entfernen.
//!
//! Herkunft installierter Dateien steht in `<server>/vibe-addons.json` (nicht im Plugin-Ordner, damit
//! der Server sie nicht sieht). Modrinth-Dateien werden zusätzlich per SHA-1 erkannt.
use super::{server_dir, Server};
use crate::content::{http, meta, modrinth as mr, ContentKind};
use crate::error::{AppError, AppResult};
use crate::model::LoaderKind;
use crate::net::DownloadItem;
use crate::Core;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};

const INDEX_FILE: &str = "vibe-addons.json";
const HANGAR: &str = "https://hangar.papermc.io/api/v1";

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AddonSource {
    Modrinth,
    Hangar,
}

/// Was der Server lädt und wo es liegt.
#[derive(Debug, Clone, Serialize)]
pub struct AddonTarget {
    /// "plugins" | "mods"
    pub folder: &'static str,
    pub plugins: bool,
    /// Modrinth-Loader (Reihenfolge = Vorzug)
    pub loaders: Vec<String>,
    pub mc: String,
    /// Hangar-Plattform (nur Paper/Purpur)
    pub hangar: Option<&'static str>,
}

pub fn target(s: &Server) -> Option<AddonTarget> {
    let folder = s.addon_dir()?;
    let (plugins, loaders, hangar): (bool, Vec<String>, Option<&'static str>) = match &s.platform {
        Some(p) => (
            true,
            p.kind.plugin_loaders().iter().map(|l| l.to_string()).collect(),
            (p.kind != super::platform::PlatformKind::Folia).then_some("PAPER"),
        ),
        None => {
            let l: Vec<String> = match s.loader.kind {
                LoaderKind::Quilt => vec!["quilt".into(), "fabric".into()],
                k => vec![k.as_str().to_string()],
            };
            (false, l, None)
        }
    };
    Some(AddonTarget { folder, plugins, loaders, mc: s.mc_version.clone(), hangar })
}

// ------------------------------------------------------------------ Herkunfts-Index

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct IndexEntry {
    pub source: Option<AddonSource>,
    pub project_id: Option<String>,
    pub slug: Option<String>,
    pub version_id: Option<String>,
    pub version_name: Option<String>,
    pub title: Option<String>,
    pub icon_url: Option<String>,
}

#[derive(Debug, Default, Serialize, Deserialize)]
struct IndexFile {
    #[serde(default)]
    files: HashMap<String, IndexEntry>,
}

pub fn base_name(file: &str) -> &str {
    file.strip_suffix(".disabled").unwrap_or(file)
}

fn load_index(dir: &Path) -> HashMap<String, IndexEntry> {
    std::fs::read(dir.join(INDEX_FILE)).ok().and_then(|b| serde_json::from_slice::<IndexFile>(&b).ok()).map(|f| f.files).unwrap_or_default()
}

fn save_index(dir: &Path, files: &HashMap<String, IndexEntry>) -> AppResult<()> {
    crate::util::write_json_atomic(&dir.join(INDEX_FILE), &IndexFile { files: files.clone() })
}

// ------------------------------------------------------------------ Lokale Dateien

#[derive(Debug, Clone, Serialize)]
pub struct Addon {
    pub file_name: String,
    pub enabled: bool,
    pub size: u64,
    pub modified: i64,
    pub sha1: Option<String>,
    pub name: Option<String>,
    pub version: Option<String>,
    pub authors: Vec<String>,
    pub description: Option<String>,
    /// data:-URL (aus der JAR) oder Projekt-Icon-URL
    pub icon: Option<String>,
    pub source: Option<AddonSource>,
    pub project_id: Option<String>,
    pub slug: Option<String>,
    pub version_id: Option<String>,
    pub title: Option<String>,
    pub page_url: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct AddonList {
    pub target: AddonTarget,
    pub items: Vec<Addon>,
}

/// Bukkit-/Paper-Plugin-Metadaten (`plugin.yml`, `paper-plugin.yml`). Bewusst schlichter YAML-Leser:
/// nur Schlüssel der obersten Ebene, Skalare, Inline-Listen `[a, b]` und Blocklisten `- a`.
#[derive(Debug, Default, PartialEq)]
pub struct PluginYml {
    pub name: Option<String>,
    pub version: Option<String>,
    pub description: Option<String>,
    pub authors: Vec<String>,
    pub main: Option<String>,
    pub depend: Vec<String>,
    pub folia_supported: bool,
}

fn yaml_scalar(v: &str) -> String {
    let v = v.trim();
    if let Some(q) = v.chars().next().filter(|c| *c == '"' || *c == '\'') {
        let inner = &v[1..];
        return match inner.find(q) {
            Some(end) => inner[..end].to_string(),
            None => inner.to_string(),
        };
    }
    match v.find(" #") {
        Some(i) => v[..i].trim().to_string(),
        None => v.to_string(),
    }
}

fn yaml_list(v: &str) -> Vec<String> {
    let v = v.trim();
    if let Some(inner) = v.strip_prefix('[').and_then(|x| x.strip_suffix(']')) {
        inner.split(',').map(yaml_scalar).filter(|s| !s.is_empty()).collect()
    } else if v.is_empty() {
        vec![]
    } else {
        vec![yaml_scalar(v)]
    }
}

pub fn parse_plugin_yml(text: &str) -> PluginYml {
    let mut out = PluginYml::default();
    let mut current: Option<String> = None;
    for raw in text.lines() {
        let line = raw.trim_end();
        if line.trim().is_empty() || line.trim_start().starts_with('#') {
            continue;
        }
        let top = !line.starts_with(' ') && !line.starts_with('\t');
        if top {
            if let Some((k, v)) = line.split_once(':') {
                let key = k.trim().to_ascii_lowercase();
                let val = v.trim();
                current = Some(key.clone());
                match key.as_str() {
                    "name" => out.name = Some(yaml_scalar(val)).filter(|s| !s.is_empty()),
                    "version" => out.version = Some(yaml_scalar(val)).filter(|s| !s.is_empty()),
                    "description" => out.description = Some(yaml_scalar(val)).filter(|s| !s.is_empty() && s != "|" && s != ">"),
                    "main" => out.main = Some(yaml_scalar(val)).filter(|s| !s.is_empty()),
                    "author" => out.authors.extend(yaml_list(val)),
                    "authors" => out.authors.extend(yaml_list(val)),
                    "depend" => out.depend.extend(yaml_list(val)),
                    "folia-supported" => out.folia_supported = yaml_scalar(val).eq_ignore_ascii_case("true"),
                    _ => {}
                }
            }
            continue;
        }
        // Blockliste unter einem Schlüssel der obersten Ebene
        if let Some(item) = line.trim_start().strip_prefix("- ") {
            match current.as_deref() {
                Some("authors") | Some("author") => out.authors.push(yaml_scalar(item)),
                Some("depend") => out.depend.push(yaml_scalar(item)),
                _ => {}
            }
        }
    }
    out.authors.retain(|a| !a.is_empty());
    out.authors.dedup();
    out
}

/// `velocity-plugin.json` / `bungee.yml` gibt es auf Welt-Servern nicht; für Mods lesen wir die
/// Launcher-Metadaten (`content::meta`).
fn read_plugin_meta(path: &Path) -> Option<PluginYml> {
    let f = std::fs::File::open(path).ok()?;
    let mut zip = zip::ZipArchive::new(std::io::BufReader::new(f)).ok()?;
    for name in ["paper-plugin.yml", "plugin.yml"] {
        if let Ok(mut e) = zip.by_name(name) {
            let mut s = String::new();
            if std::io::Read::read_to_string(&mut e, &mut s).is_ok() {
                let y = parse_plugin_yml(&s);
                if y.name.is_some() {
                    return Some(y);
                }
            }
        }
    }
    None
}

fn mtime_ms(m: &std::fs::Metadata) -> i64 {
    m.modified().ok().and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_millis() as i64).unwrap_or(0)
}

/// JAR-Dateien im Ordner (aktiv und `.disabled`), ohne Metadaten-Ordner der Plugins.
fn list_files(dir: &Path) -> Vec<(String, PathBuf, std::fs::Metadata)> {
    let Ok(rd) = std::fs::read_dir(dir) else { return vec![] };
    let mut out: Vec<_> = rd
        .flatten()
        .filter_map(|e| {
            let name = e.file_name().to_string_lossy().to_string();
            let m = e.metadata().ok()?;
            (m.is_file() && base_name(&name).to_ascii_lowercase().ends_with(".jar") && !name.starts_with('.')).then(|| (name, e.path(), m))
        })
        .collect();
    out.sort_by_key(|(n, _, _)| base_name(n).to_ascii_lowercase());
    out
}

/// Metadaten-Cache je (Pfad, Größe, Zeit), damit die Liste nicht jedes Mal alle JARs liest.
type MetaKey = (PathBuf, u64, i64);
fn meta_cache() -> &'static parking_lot::Mutex<HashMap<MetaKey, Addon>> {
    static C: std::sync::OnceLock<parking_lot::Mutex<HashMap<MetaKey, Addon>>> = std::sync::OnceLock::new();
    C.get_or_init(Default::default)
}

fn read_local(path: &Path, name: &str, m: &std::fs::Metadata, plugins: bool, icons: &Path) -> Addon {
    let key = (path.to_path_buf(), m.len(), mtime_ms(m));
    if let Some(a) = meta_cache().lock().get(&key) {
        return Addon { file_name: name.to_string(), enabled: !name.ends_with(".disabled"), ..a.clone() };
    }
    let lm = meta::read_entry(path, ContentKind::Mod, icons);
    let mut a = Addon {
        file_name: name.to_string(),
        enabled: !name.ends_with(".disabled"),
        size: m.len(),
        modified: mtime_ms(m),
        sha1: lm.sha1.clone(),
        name: lm.name.clone(),
        version: lm.version.clone(),
        authors: lm.authors.clone(),
        description: lm.description.clone(),
        icon: lm.icon.as_deref().and_then(|i| meta::icon_data_url(icons, i)),
        source: None,
        project_id: None,
        slug: None,
        version_id: None,
        title: None,
        page_url: None,
    };
    if plugins || a.name.is_none() {
        if let Some(y) = read_plugin_meta(path) {
            a.name = y.name;
            a.version = y.version.or(a.version);
            a.description = y.description.or(a.description);
            if !y.authors.is_empty() {
                a.authors = y.authors;
            }
        }
    }
    meta_cache().lock().insert(key, a.clone());
    a
}

fn modrinth_page(slug: &str, plugins: bool) -> String {
    format!("https://modrinth.com/{}/{slug}", if plugins { "plugin" } else { "mod" })
}

fn hangar_page(slug: &str) -> String {
    format!("https://hangar.papermc.io/{slug}")
}

/// Installierte Erweiterungen mit Herkunft (Index + Modrinth-Hash-Abfrage; Netzfehler werden ignoriert).
pub async fn list(state: &Core, s: &Server) -> AppResult<AddonList> {
    let t = target(s).ok_or_else(|| AppError::Invalid("Vanilla-Server haben keine Plugins oder Mods.".into()))?;
    let sdir = server_dir(&state.paths, &s.id);
    let dir = sdir.join(t.folder);
    let icons = state.paths.cache().join("icons");
    let plugins = t.plugins;
    let d2 = dir.clone();
    let mut items: Vec<Addon> = tokio::task::spawn_blocking(move || {
        list_files(&d2).into_iter().map(|(n, p, m)| read_local(&p, &n, &m, plugins, &icons)).collect::<Vec<_>>()
    })
    .await?;
    let mut index = load_index(&sdir);
    // Unbekannte Dateien bei Modrinth nachschlagen
    let unknown: Vec<String> = items
        .iter()
        .filter(|a| index.get(base_name(&a.file_name)).and_then(|e| e.project_id.as_ref()).is_none())
        .filter_map(|a| a.sha1.clone())
        .collect();
    if !unknown.is_empty() {
        if let Ok(found) = mr::versions_by_hash(state, &unknown).await {
            let pids: Vec<String> = found.values().map(|v| v.project_id.clone()).collect::<HashSet<_>>().into_iter().collect();
            let projects = mr::raw_projects(state, &pids).await.unwrap_or_default();
            let mut changed = false;
            for a in &items {
                let Some(v) = a.sha1.as_ref().and_then(|h| found.get(&h.to_ascii_lowercase())) else { continue };
                let p = projects.iter().find(|p| p.id == v.project_id);
                index.insert(
                    base_name(&a.file_name).to_string(),
                    IndexEntry {
                        source: Some(AddonSource::Modrinth),
                        project_id: Some(v.project_id.clone()),
                        slug: p.map(|p| p.slug.clone()),
                        version_id: Some(v.id.clone()),
                        version_name: Some(v.version_number.clone()),
                        title: p.map(|p| p.title.clone()),
                        icon_url: p.and_then(|p| p.icon_url.clone()).filter(|u| !u.is_empty()),
                    },
                );
                changed = true;
            }
            if changed {
                let _ = save_index(&sdir, &index);
            }
        }
    }
    for a in items.iter_mut() {
        if let Some(e) = index.get(base_name(&a.file_name)) {
            a.source = e.source;
            a.project_id = e.project_id.clone();
            a.slug = e.slug.clone();
            a.version_id = e.version_id.clone();
            a.title = e.title.clone();
            if a.icon.is_none() {
                a.icon = e.icon_url.clone();
            }
            a.page_url = match (e.source, e.slug.as_deref()) {
                (Some(AddonSource::Modrinth), Some(slug)) => Some(modrinth_page(slug, plugins)),
                (Some(AddonSource::Hangar), Some(slug)) => Some(hangar_page(slug)),
                _ => None,
            };
        }
    }
    Ok(AddonList { target: t, items })
}

pub fn set_enabled(state: &Core, s: &Server, file: &str, enabled: bool) -> AppResult<String> {
    let t = target(s).ok_or_else(|| AppError::Invalid("Kein Plugin-/Mod-Ordner".into()))?;
    let dir = server_dir(&state.paths, &s.id).join(t.folder);
    let from = crate::util::safe_join(&dir, file).filter(|p| p.is_file()).ok_or_else(|| AppError::NotFound(file.to_string()))?;
    let base = base_name(file).to_string();
    let to_name = if enabled { base.clone() } else { format!("{base}.disabled") };
    if to_name != file {
        std::fs::rename(&from, dir.join(&to_name))?;
    }
    Ok(to_name)
}

pub fn remove(state: &Core, s: &Server, file: &str) -> AppResult<()> {
    let t = target(s).ok_or_else(|| AppError::Invalid("Kein Plugin-/Mod-Ordner".into()))?;
    let sdir = server_dir(&state.paths, &s.id);
    let p = crate::util::safe_join(&sdir.join(t.folder), file).filter(|p| p.is_file()).ok_or_else(|| AppError::NotFound(file.to_string()))?;
    if trash::delete(&p).is_err() {
        std::fs::remove_file(&p)?;
    }
    let mut idx = load_index(&sdir);
    if idx.remove(base_name(file)).is_some() {
        save_index(&sdir, &idx)?;
    }
    Ok(())
}

// ------------------------------------------------------------------ Suche

#[derive(Debug, Clone, Serialize)]
pub struct AddonHit {
    pub source: AddonSource,
    /// Modrinth-Projekt-ID bzw. Hangar „owner/slug“
    pub id: String,
    pub slug: String,
    pub title: String,
    pub description: String,
    pub author: String,
    pub icon_url: Option<String>,
    pub downloads: u64,
    pub updated: Option<String>,
    pub page_url: String,
    /// Passt das Projekt zu diesem Server (Loader/Plattform, Minecraft-Version, server_side)?
    pub compat: AddonCompat,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct AddonCompat {
    pub ok: bool,
    pub reason: Option<String>,
    pub version: Option<String>,
}

impl AddonCompat {
    pub fn ok() -> Self {
        AddonCompat { ok: true, reason: None, version: None }
    }
}

/// Kompatibilität eines Modrinth-Suchtreffers mit dem Server.
pub fn hit_compat(t: &AddonTarget, categories: &[String], versions: &[String], server_side: Option<&str>) -> AddonCompat {
    let no = |r: String| AddonCompat { ok: false, reason: Some(r), version: None };
    if !categories.is_empty() && !categories.iter().any(|c| t.loaders.contains(c)) {
        return no(format!("Nicht für {} verfügbar.", t.loaders.join("/")));
    }
    if !t.mc.is_empty() && !versions.is_empty() && !versions.contains(&t.mc) {
        return no(format!("Keine Version für Minecraft {}.", t.mc));
    }
    if !t.plugins && server_side == Some("unsupported") {
        return no("Läuft nur im Spiel (Client), nicht auf einem Server.".into());
    }
    AddonCompat { ok: true, reason: None, version: (!t.mc.is_empty()).then(|| t.mc.clone()) }
}

#[derive(Debug, Clone, Serialize)]
pub struct AddonSearch {
    pub hits: Vec<AddonHit>,
    pub total: u64,
    pub offset: u32,
}

/// Modrinth-Facets für die Suche.
pub fn modrinth_facets(t: &AddonTarget) -> String {
    let mut f: Vec<Vec<String>> = vec![vec![format!("project_type:{}", if t.plugins { "plugin" } else { "mod" })]];
    f.push(t.loaders.iter().map(|l| format!("categories:{l}")).collect());
    if !t.mc.is_empty() {
        f.push(vec![format!("versions:{}", t.mc)]);
    }
    if !t.plugins {
        f.push(vec!["server_side:required".into(), "server_side:optional".into()]);
    }
    serde_json::to_string(&f).unwrap_or_else(|_| "[]".into())
}

#[derive(Deserialize)]
struct MrSearch {
    #[serde(default)]
    hits: Vec<MrHit>,
    #[serde(default)]
    total_hits: u64,
}

#[derive(Deserialize)]
struct MrHit {
    project_id: String,
    #[serde(default)]
    categories: Vec<String>,
    #[serde(default)]
    versions: Vec<String>,
    #[serde(default)]
    server_side: Option<String>,
    #[serde(default)]
    slug: Option<String>,
    #[serde(default)]
    title: String,
    #[serde(default)]
    description: String,
    #[serde(default)]
    author: String,
    #[serde(default)]
    icon_url: Option<String>,
    #[serde(default)]
    downloads: u64,
    #[serde(default)]
    date_modified: Option<String>,
}

#[derive(Deserialize)]
struct HangarPage<T> {
    pagination: HangarPagination,
    result: Vec<T>,
}

#[derive(Deserialize)]
struct HangarPagination {
    #[serde(default)]
    count: u64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct HangarProject {
    name: String,
    namespace: HangarNamespace,
    #[serde(default)]
    description: String,
    #[serde(default)]
    avatar_url: Option<String>,
    #[serde(default)]
    last_updated: Option<String>,
    #[serde(default)]
    stats: HangarStats,
}

#[derive(Deserialize)]
struct HangarNamespace {
    owner: String,
    slug: String,
}

#[derive(Deserialize, Default)]
struct HangarStats {
    #[serde(default)]
    downloads: u64,
}

pub fn parse_hangar_search(b: &[u8], offset: u32) -> AppResult<AddonSearch> {
    let p: HangarPage<HangarProject> = http::parse(b, "Hangar")?;
    Ok(AddonSearch {
        total: p.pagination.count,
        offset,
        hits: p
            .result
            .into_iter()
            .map(|h| AddonHit {
                source: AddonSource::Hangar,
                id: format!("{}/{}", h.namespace.owner, h.namespace.slug),
                page_url: hangar_page(&format!("{}/{}", h.namespace.owner, h.namespace.slug)),
                slug: h.namespace.slug,
                title: h.name,
                description: h.description,
                author: h.namespace.owner,
                icon_url: h.avatar_url.filter(|u| !u.contains("/avatars/default/")),
                downloads: h.stats.downloads,
                updated: h.last_updated,
                compat: AddonCompat::ok(),
            })
            .collect(),
    })
}

pub async fn search(state: &Core, s: &Server, source: AddonSource, query: &str, sort: &str, offset: u32) -> AppResult<AddonSearch> {
    let t = target(s).ok_or_else(|| AppError::Invalid("Vanilla-Server haben keine Plugins oder Mods.".into()))?;
    let limit = 20u32;
    match source {
        AddonSource::Modrinth => {
            let index = if sort == "downloads" { "downloads" } else if sort == "updated" { "updated" } else { "relevance" };
            let mut url = format!(
                "{}/search?facets={}&index={index}&offset={offset}&limit={limit}",
                mr::API,
                urlencoding::encode(&modrinth_facets(&t))
            );
            if !query.trim().is_empty() {
                url.push_str(&format!("&query={}", urlencoding::encode(query.trim())));
            }
            let b = http::cached(state, url.clone(), state.net.client.get(&url), "Modrinth").await?;
            let r: MrSearch = http::parse(&b, "Modrinth")?;
            Ok(AddonSearch {
                total: r.total_hits,
                offset,
                hits: r
                    .hits
                    .into_iter()
                    .map(|h| {
                        let slug = h.slug.unwrap_or_else(|| h.project_id.clone());
                        let compat = hit_compat(&t, &h.categories, &h.versions, h.server_side.as_deref());
                        AddonHit {
                            compat,
                            source: AddonSource::Modrinth,
                            page_url: modrinth_page(&slug, t.plugins),
                            id: h.project_id,
                            slug,
                            title: h.title,
                            description: h.description,
                            author: h.author,
                            icon_url: h.icon_url.filter(|u| !u.is_empty()),
                            downloads: h.downloads,
                            updated: h.date_modified,
                        }
                    })
                    .collect(),
            })
        }
        AddonSource::Hangar => {
            let platform = t.hangar.ok_or_else(|| AppError::Invalid("Hangar bietet für diese Server-Software keine Plugins an.".into()))?;
            let sort = if sort == "updated" { "-updated" } else if sort == "downloads" || query.trim().is_empty() { "-downloads" } else { "-stars" };
            let mut url = format!(
                "{HANGAR}/projects?limit={limit}&offset={offset}&platform={platform}&version={}&sort={sort}",
                urlencoding::encode(&t.mc)
            );
            if !query.trim().is_empty() {
                url.push_str(&format!("&q={}", urlencoding::encode(query.trim())));
            }
            let b = http::cached(state, url.clone(), state.net.client.get(&url), "Hangar").await?;
            parse_hangar_search(&b, offset)
        }
    }
}

// ------------------------------------------------------------------ Projektdetails (Overlay)

/// Details eines Hangar-Projekts im Format der Projektseite (`ProjectDetails` im Frontend).
#[derive(Debug, Clone, Serialize)]
pub struct AddonProject {
    pub source: AddonSource,
    pub id: String,
    pub slug: String,
    pub title: String,
    pub description: String,
    pub author: String,
    pub icon_url: Option<String>,
    pub downloads: u64,
    /// Sterne
    pub follows: u64,
    pub categories: Vec<String>,
    pub project_type: &'static str,
    pub updated: Option<String>,
    pub created: Option<String>,
    pub published: Option<String>,
    pub game_versions: Vec<String>,
    pub loaders: Vec<String>,
    pub body: String,
    pub body_format: &'static str,
    pub gallery: Vec<crate::content::GalleryImage>,
    pub links: crate::content::ProjectLinks,
    pub license: Option<String>,
    pub page_url: String,
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
struct HangarFull {
    name: String,
    namespace: Option<HangarNamespace>,
    description: String,
    avatar_url: Option<String>,
    last_updated: Option<String>,
    created_at: Option<String>,
    published_at: Option<String>,
    category: Option<String>,
    stats: HangarFullStats,
    settings: HangarSettings,
    supported_platforms: HashMap<String, Vec<String>>,
}

#[derive(Deserialize, Default)]
#[serde(default)]
struct HangarFullStats {
    downloads: u64,
    stars: u64,
}

#[derive(Deserialize, Default)]
#[serde(default)]
struct HangarSettings {
    links: Vec<HangarLinkSection>,
    tags: Vec<String>,
    license: Option<HangarLicense>,
    keywords: Vec<String>,
}

#[derive(Deserialize, Default)]
#[serde(default)]
struct HangarLinkSection {
    links: Vec<HangarLink>,
}

#[derive(Deserialize, Default)]
#[serde(default)]
struct HangarLink {
    name: String,
    url: String,
}

#[derive(Deserialize, Default)]
#[serde(default)]
struct HangarLicense {
    name: Option<String>,
    #[serde(rename = "type")]
    kind: Option<String>,
}

/// Hangar-Projekt (JSON von `/projects/{slug}`) + Hauptseite (Markdown) umwandeln.
pub fn parse_hangar_project(b: &[u8], page: Option<String>) -> AppResult<AddonProject> {
    let p: HangarFull = http::parse(b, "Hangar")?;
    let ns = p.namespace.unwrap_or(HangarNamespace { owner: String::new(), slug: p.name.clone() });
    let full = format!("{}/{}", ns.owner, ns.slug);
    let mut links = crate::content::ProjectLinks::default();
    for l in p.settings.links.iter().flat_map(|s| s.links.iter()) {
        if !l.url.starts_with("https://") && !l.url.starts_with("http://") {
            continue;
        }
        let n = l.name.to_ascii_lowercase();
        let u = Some(l.url.clone());
        if n.contains("issue") || n.contains("bug") {
            links.issues = links.issues.or(u);
        } else if n.contains("source") || n.contains("github") || n.contains("code") {
            links.source = links.source.or(u);
        } else if n.contains("wiki") || n.contains("doc") {
            links.wiki = links.wiki.or(u);
        } else if l.url.contains("discord.") {
            links.discord = links.discord.or(u);
        } else if links.website.is_none() && !n.contains("donat") && !n.contains("sponsor") {
            links.website = u;
        }
    }
    // Versionen der Server-Software (Paper), neueste zuerst
    let mut game_versions: Vec<String> = p.supported_platforms.get("PAPER").cloned().unwrap_or_default();
    game_versions.sort_by_key(|v| std::cmp::Reverse(version_key(v)));
    let mut loaders: Vec<String> = p.supported_platforms.keys().map(|k| k.to_ascii_lowercase()).collect();
    loaders.sort();
    if p.settings.tags.iter().any(|t| t == "SUPPORTS_FOLIA") && !loaders.iter().any(|l| l == "folia") {
        loaders.push("folia".into());
    }
    let mut categories: Vec<String> = p.category.into_iter().map(|c| c.replace('_', "-")).collect();
    categories.extend(p.settings.keywords.into_iter().take(4));
    let license = p.settings.license.and_then(|l| l.name.filter(|n| !n.is_empty()).or(l.kind));
    let body = page.filter(|b| !b.trim().is_empty()).unwrap_or_else(|| p.description.clone());
    Ok(AddonProject {
        source: AddonSource::Hangar,
        id: full.clone(),
        slug: ns.slug,
        title: p.name,
        description: p.description,
        author: ns.owner,
        icon_url: p.avatar_url.filter(|u| !u.contains("/avatars/default/")),
        downloads: p.stats.downloads,
        follows: p.stats.stars,
        categories,
        project_type: "plugin",
        updated: p.last_updated,
        created: p.created_at,
        published: p.published_at,
        game_versions,
        loaders,
        body,
        body_format: "markdown",
        gallery: vec![],
        links,
        license,
        page_url: hangar_page(&full),
    })
}

/// „1.21.11“ -> [1, 21, 11] zum Sortieren.
fn version_key(v: &str) -> Vec<u32> {
    v.split('.').map(|p| p.parse().unwrap_or(0)).collect()
}

pub async fn hangar_project(state: &Core, project: &str) -> AppResult<AddonProject> {
    let slug = project.rsplit('/').next().unwrap_or(project);
    if slug.is_empty() || slug.contains(['?', '#', '\\']) {
        return Err(AppError::Invalid("Ungültiges Hangar-Projekt".into()));
    }
    let enc = urlencoding::encode(slug);
    let purl = format!("{HANGAR}/projects/{enc}");
    let b = http::cached(state, purl.clone(), state.net.client.get(&purl), "Hangar").await?;
    let page_url = format!("{HANGAR}/pages/main/{enc}");
    let page = http::cached(state, page_url.clone(), state.net.client.get(&page_url), "Hangar")
        .await
        .ok()
        .map(|b| String::from_utf8_lossy(&b).into_owned());
    parse_hangar_project(&b, page)
}

// ------------------------------------------------------------------ Versionen + Installation

/// Eine konkrete Datei, die installiert werden soll.
#[derive(Debug, Clone)]
pub struct Resolved {
    pub source: AddonSource,
    pub project_id: String,
    pub slug: Option<String>,
    pub title: Option<String>,
    pub icon_url: Option<String>,
    pub version_id: String,
    pub version_name: String,
    pub file_name: String,
    pub url: String,
    pub size: Option<u64>,
    pub sha1: Option<String>,
    pub sha256: Option<String>,
    /// Pflicht-Abhängigkeiten (Modrinth-Projekt-IDs)
    pub deps: Vec<String>,
}

fn rank(version_type: &str) -> u8 {
    match version_type.to_ascii_lowercase().as_str() {
        "release" => 0,
        "beta" => 1,
        _ => 2,
    }
}

/// Beste Modrinth-Version: neueste Release, sonst Beta, sonst Alpha (API liefert neueste zuerst).
pub fn pick_modrinth(versions: &[mr::MrVersion], t: &AddonTarget) -> Option<mr::MrVersion> {
    let fits = |v: &&mr::MrVersion| v.loaders.iter().any(|l| t.loaders.contains(l)) && (t.mc.is_empty() || v.game_versions.contains(&t.mc));
    let mut c: Vec<&mr::MrVersion> = versions.iter().filter(fits).collect();
    c.sort_by(|a, b| rank(&a.version_type).cmp(&rank(&b.version_type)).then(b.date_published.cmp(&a.date_published)));
    c.first().map(|v| (*v).clone())
}

async fn resolve_modrinth(state: &Core, t: &AddonTarget, project: &str) -> AppResult<Resolved> {
    let url = format!(
        "{}/project/{}/version?loaders={}&game_versions={}",
        mr::API,
        urlencoding::encode(project),
        urlencoding::encode(&serde_json::to_string(&t.loaders)?),
        urlencoding::encode(&serde_json::to_string(&[&t.mc])?)
    );
    let b = http::cached(state, url.clone(), state.net.client.get(&url), "Modrinth").await?;
    let versions: Vec<mr::MrVersion> = http::parse(&b, "Modrinth")?;
    let v = pick_modrinth(&versions, t).ok_or_else(|| {
        AppError::Invalid(format!("Keine passende Version für Minecraft {} ({}) gefunden.", t.mc, t.loaders.join("/")))
    })?;
    let p = mr::raw_project(state, &v.project_id).await.ok();
    resolved_from(&v, p.as_ref())
}

fn resolved_from(v: &mr::MrVersion, p: Option<&mr::MrProject>) -> AppResult<Resolved> {
    let f = v.files.iter().find(|f| f.primary).or(v.files.first()).ok_or_else(|| AppError::msg("Version ohne Datei"))?;
    Ok(Resolved {
        source: AddonSource::Modrinth,
        project_id: v.project_id.clone(),
        slug: p.map(|p| p.slug.clone()),
        title: p.map(|p| p.title.clone()),
        icon_url: p.and_then(|p| p.icon_url.clone()).filter(|u| !u.is_empty()),
        version_id: v.id.clone(),
        version_name: v.version_number.clone(),
        file_name: f.filename.clone(),
        url: f.url.clone(),
        size: Some(f.size).filter(|s| *s > 0),
        sha1: f.hashes.sha1.clone(),
        sha256: None,
        deps: v.dependencies.iter().filter(|d| d.dependency_type == "required").filter_map(|d| d.project_id.clone()).collect(),
    })
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct HangarVersion {
    name: String,
    #[serde(default)]
    created_at: String,
    channel: HangarChannel,
    #[serde(default)]
    downloads: HashMap<String, HangarDownload>,
}

#[derive(Deserialize)]
struct HangarChannel {
    name: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct HangarDownload {
    #[serde(default)]
    file_info: Option<HangarFileInfo>,
    #[serde(default)]
    download_url: Option<String>,
    #[serde(default)]
    external_url: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct HangarFileInfo {
    name: String,
    #[serde(default)]
    size_bytes: Option<u64>,
    #[serde(default)]
    sha256_hash: Option<String>,
}

/// Gewählte Hangar-Version: (Versionsname, Download-URL, Dateiname, Größe, SHA-256).
pub type HangarPick = (String, String, String, Option<u64>, Option<String>);

/// Hangar-Versionen: „Release“-Kanal bevorzugt, sonst neueste. Externe Downloads gehen nicht.
pub fn pick_hangar(b: &[u8], platform: &str) -> AppResult<Option<HangarPick>> {
    let p: HangarPage<HangarVersion> = http::parse(b, "Hangar")?;
    let mut list: Vec<&HangarVersion> = p.result.iter().filter(|v| v.downloads.contains_key(platform)).collect();
    list.sort_by(|a, b| {
        let ra = !a.channel.name.eq_ignore_ascii_case("release");
        let rb = !b.channel.name.eq_ignore_ascii_case("release");
        ra.cmp(&rb).then(b.created_at.cmp(&a.created_at))
    });
    let Some(v) = list.first() else { return Ok(None) };
    let d = &v.downloads[platform];
    let Some(url) = d.download_url.clone() else {
        return Err(AppError::Invalid(match &d.external_url {
            Some(u) => format!("Diese Version gibt es nur extern ({u}) – bitte dort herunterladen."),
            None => "Diese Version hat keinen Download.".into(),
        }));
    };
    let fi = d.file_info.as_ref();
    Ok(Some((
        v.name.clone(),
        url,
        fi.map(|f| f.name.clone()).unwrap_or_else(|| format!("{}.jar", v.name)),
        fi.and_then(|f| f.size_bytes),
        fi.and_then(|f| f.sha256_hash.clone()),
    )))
}

async fn resolve_hangar(state: &Core, t: &AddonTarget, project: &str, fresh: bool) -> AppResult<Resolved> {
    let platform = t.hangar.ok_or_else(|| AppError::Invalid("Hangar bietet für diese Server-Software keine Plugins an.".into()))?;
    let slug = project.rsplit('/').next().unwrap_or(project);
    let url = format!(
        "{HANGAR}/projects/{}/versions?limit=25&offset=0&platform={platform}&platformVersion={}",
        urlencoding::encode(slug),
        urlencoding::encode(&t.mc)
    );
    let b = if fresh { http::send(state.net.client.get(&url), "Hangar").await? } else { http::cached(state, url.clone(), state.net.client.get(&url), "Hangar").await? };
    let (name, dl, file, size, sha256) =
        pick_hangar(&b, platform)?.ok_or_else(|| AppError::Invalid(format!("Keine Hangar-Version für Minecraft {} gefunden.", t.mc)))?;
    let purl = format!("{HANGAR}/projects/{}", urlencoding::encode(slug));
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct P {
        name: String,
        namespace: HangarNamespace,
        #[serde(default)]
        avatar_url: Option<String>,
    }
    let p: Option<P> = http::cached(state, purl.clone(), state.net.client.get(&purl), "Hangar").await.ok().and_then(|b| serde_json::from_slice(&b).ok());
    Ok(Resolved {
        source: AddonSource::Hangar,
        project_id: p.as_ref().map(|p| format!("{}/{}", p.namespace.owner, p.namespace.slug)).unwrap_or_else(|| project.to_string()),
        slug: p.as_ref().map(|p| format!("{}/{}", p.namespace.owner, p.namespace.slug)),
        title: p.as_ref().map(|p| p.name.clone()),
        icon_url: p.and_then(|p| p.avatar_url).filter(|u| !u.contains("/avatars/default/")),
        version_id: name.clone(),
        version_name: name,
        file_name: file,
        url: dl,
        size,
        sha1: None,
        sha256: sha256.map(|s| s.to_ascii_lowercase()),
        deps: vec![],
    })
}

fn safe_file_name(n: &str) -> String {
    let n: String = n.chars().map(|c| if c.is_control() || "\\/:*?\"<>|".contains(c) { '_' } else { c }).collect();
    let n = n.trim().trim_start_matches('.').to_string();
    if n.to_ascii_lowercase().ends_with(".jar") { n } else { format!("{n}.jar") }
}

/// Datei laden, prüfen, alte Datei desselben Projekts ersetzen, Index aktualisieren.
async fn place(state: &Core, s: &Server, t: &AddonTarget, r: &Resolved, replace: Option<&str>) -> AppResult<String> {
    let sdir = server_dir(&state.paths, &s.id);
    let dir = sdir.join(t.folder);
    tokio::fs::create_dir_all(&dir).await?;
    let file = safe_file_name(&r.file_name);
    let keep_disabled = replace.is_some_and(|f| f.ends_with(".disabled"));
    let final_name = if keep_disabled { format!("{file}.disabled") } else { file.clone() };
    let tmp = dir.join(format!(".{file}.part"));
    let _ = tokio::fs::remove_file(&tmp).await;
    let item = DownloadItem::new(&r.url, &tmp).sha1(r.sha1.clone()).size(r.size);
    state.net.download_all(vec![item], None).await?;
    if let Some(want) = &r.sha256 {
        let t2 = tmp.clone();
        let got = tokio::task::spawn_blocking(move || crate::net::sha256_file(&t2)).await??;
        if !got.eq_ignore_ascii_case(want) {
            let _ = tokio::fs::remove_file(&tmp).await;
            return Err(AppError::msg(format!("{}: Prüfsumme stimmt nicht – Download beschädigt.", r.file_name)));
        }
    }
    if let Some(old) = replace {
        if base_name(old) != file {
            if let Some(p) = crate::util::safe_join(&dir, old) {
                let _ = tokio::fs::remove_file(p).await;
            }
        }
    }
    let dst = dir.join(&final_name);
    let _ = tokio::fs::remove_file(&dst).await;
    tokio::fs::rename(&tmp, &dst).await?;
    let mut idx = load_index(&sdir);
    if let Some(old) = replace {
        idx.remove(base_name(old));
    }
    idx.insert(
        file.clone(),
        IndexEntry {
            source: Some(r.source),
            project_id: Some(r.project_id.clone()),
            slug: r.slug.clone(),
            version_id: Some(r.version_id.clone()),
            version_name: Some(r.version_name.clone()),
            title: r.title.clone(),
            icon_url: r.icon_url.clone(),
        },
    );
    save_index(&sdir, &idx)?;
    Ok(final_name)
}

/// Bestimmte Modrinth-Version installieren (Entdecken-Seite), mit Kompatibilitätsprüfung und Pflicht-Abhängigkeiten.
pub async fn install_modrinth_version(state: &Core, s: &Server, version_id: &str) -> AppResult<Vec<String>> {
    let t = target(s).ok_or_else(|| AppError::Invalid("Vanilla-Server haben keine Plugins oder Mods.".into()))?;
    let v = mr::raw_version(state, version_id).await?;
    if !v.loaders.iter().any(|l| t.loaders.contains(l)) {
        return Err(AppError::Invalid(format!("Diese Version passt nicht zur Server-Software ({}).", t.loaders.join("/"))));
    }
    if !t.mc.is_empty() && !v.game_versions.contains(&t.mc) {
        return Err(AppError::Invalid(format!("Diese Version ist nicht für Minecraft {}.", t.mc)));
    }
    let p = mr::raw_project(state, &v.project_id).await.ok();
    if !t.plugins && p.as_ref().and_then(|p| p.server_side.as_deref()) == Some("unsupported") {
        return Err(AppError::Invalid("Diese Mod läuft nur im Spiel (Client) und nicht auf einem Server.".into()));
    }
    let r = resolved_from(&v, p.as_ref())?;
    let installed = list(state, s).await?;
    let existing = installed.items.iter().find(|a| a.project_id.as_deref() == Some(r.project_id.as_str())).map(|a| a.file_name.clone());
    let mut out = vec![place(state, s, &t, &r, existing.as_deref()).await?];
    let have: HashSet<String> = installed.items.iter().filter_map(|a| a.project_id.clone()).collect();
    for d in r.deps.iter().filter(|d| !have.contains(*d)) {
        match install(state, s, AddonSource::Modrinth, d).await {
            Ok(mut f) => out.append(&mut f),
            Err(e) => tracing::warn!("Abhängigkeit {d} nicht installierbar: {e}"),
        }
    }
    Ok(out)
}

/// Projekt installieren (Modrinth: inkl. Pflicht-Abhängigkeiten). Gibt die neuen Dateinamen zurück.
pub async fn install(state: &Core, s: &Server, source: AddonSource, project: &str) -> AppResult<Vec<String>> {
    let t = target(s).ok_or_else(|| AppError::Invalid("Vanilla-Server haben keine Plugins oder Mods.".into()))?;
    let installed = list(state, s).await?;
    let mut have: HashSet<String> = installed.items.iter().filter_map(|a| a.project_id.clone()).collect();
    let mut out = Vec::new();
    let mut queue: Vec<(String, u8)> = vec![(project.to_string(), 0)];
    while let Some((pid, depth)) = queue.pop() {
        let r = match source {
            AddonSource::Hangar => resolve_hangar(state, &t, &pid, false).await?,
            AddonSource::Modrinth => match resolve_modrinth(state, &t, &pid).await {
                Ok(r) => r,
                // fehlende Abhängigkeit für diese Version: Hauptprojekt nicht blockieren
                Err(e) if depth > 0 => {
                    tracing::warn!("Abhängigkeit {pid} nicht installierbar: {e}");
                    continue;
                }
                Err(e) => return Err(e),
            },
        };
        // Schon installiert (gleiches Projekt) -> ersetzen, wenn es das Hauptprojekt ist
        let existing = installed.items.iter().find(|a| a.project_id.as_deref() == Some(r.project_id.as_str())).map(|a| a.file_name.clone());
        if depth > 0 && (existing.is_some() || have.contains(&r.project_id)) {
            continue;
        }
        out.push(place(state, s, &t, &r, existing.as_deref()).await?);
        have.insert(r.project_id.clone());
        if depth < 3 {
            for d in &r.deps {
                if !have.contains(d) {
                    queue.push((d.clone(), depth + 1));
                }
            }
        }
    }
    Ok(out)
}

#[derive(Debug, Clone, Serialize)]
pub struct AddonUpdate {
    pub file_name: String,
    pub source: AddonSource,
    pub project_id: String,
    pub current: Option<String>,
    pub latest: String,
}

/// Verfügbare Updates (nicht gecacht).
pub async fn updates(state: &Core, s: &Server) -> AppResult<Vec<AddonUpdate>> {
    let t = target(s).ok_or_else(|| AppError::Invalid("Vanilla-Server haben keine Plugins oder Mods.".into()))?;
    let l = list(state, s).await?;
    let mut out = Vec::new();
    let mr_items: Vec<&Addon> = l.items.iter().filter(|a| a.source == Some(AddonSource::Modrinth) && a.sha1.is_some()).collect();
    if !mr_items.is_empty() {
        let hashes: Vec<String> = mr_items.iter().filter_map(|a| a.sha1.clone()).collect();
        let latest = mr::latest_by_hash(state, &hashes, Some(&t.loaders), std::slice::from_ref(&t.mc)).await?;
        for a in mr_items {
            let h = a.sha1.as_deref().unwrap_or_default().to_ascii_lowercase();
            let Some(v) = latest.get(&h) else { continue };
            let same = v.files.iter().any(|f| f.hashes.sha1.as_deref().is_some_and(|x| x.eq_ignore_ascii_case(&h)));
            if !same && Some(v.id.as_str()) != a.version_id.as_deref() {
                out.push(AddonUpdate {
                    file_name: a.file_name.clone(),
                    source: AddonSource::Modrinth,
                    project_id: v.project_id.clone(),
                    current: a.version.clone(),
                    latest: v.version_number.clone(),
                });
            }
        }
    }
    let sdir = server_dir(&state.paths, &s.id);
    let idx = load_index(&sdir);
    for a in l.items.iter().filter(|a| a.source == Some(AddonSource::Hangar)) {
        let Some(e) = idx.get(base_name(&a.file_name)) else { continue };
        let Some(pid) = &e.project_id else { continue };
        match resolve_hangar(state, &t, pid, true).await {
            Ok(r) if Some(&r.version_name) != e.version_name.as_ref() => out.push(AddonUpdate {
                file_name: a.file_name.clone(),
                source: AddonSource::Hangar,
                project_id: pid.clone(),
                current: e.version_name.clone(),
                latest: r.version_name,
            }),
            Ok(_) => {}
            Err(err) => tracing::warn!("Hangar-Update für {pid}: {err}"),
        }
    }
    Ok(out)
}

/// Updates einspielen (`files = None` -> alle).
pub async fn apply_updates(state: &Core, s: &Server, files: Option<Vec<String>>) -> AppResult<usize> {
    let t = target(s).ok_or_else(|| AppError::Invalid("Vanilla-Server haben keine Plugins oder Mods.".into()))?;
    let ups = updates(state, s).await?;
    let mut n = 0;
    for u in ups.iter().filter(|u| files.as_ref().map_or(true, |f| f.contains(&u.file_name))) {
        let r = match u.source {
            AddonSource::Modrinth => resolve_modrinth(state, &t, &u.project_id).await?,
            AddonSource::Hangar => resolve_hangar(state, &t, &u.project_id, true).await?,
        };
        place(state, s, &t, &r, Some(&u.file_name)).await?;
        n += 1;
    }
    Ok(n)
}

#[cfg(test)]
mod tests {

    #[test]
    fn search_hit_compat() {
        let t = AddonTarget { folder: "mods", plugins: false, loaders: vec!["fabric".into()], mc: "1.21.1".into(), hangar: None };
        let v = |x: &[&str]| x.iter().map(|s| s.to_string()).collect::<Vec<_>>();
        assert!(hit_compat(&t, &v(&["fabric", "utility"]), &v(&["1.21.1"]), Some("optional")).ok);
        assert!(!hit_compat(&t, &v(&["forge"]), &v(&["1.21.1"]), None).ok);
        assert!(!hit_compat(&t, &v(&["fabric"]), &v(&["1.20.1"]), None).ok);
        let c = hit_compat(&t, &v(&["fabric"]), &v(&["1.21.1"]), Some("unsupported"));
        assert!(!c.ok && c.reason.unwrap().contains("Client"));
    }
    use super::*;

    #[test]
    fn plugin_yml() {
        let y = parse_plugin_yml(
            "name: LuckPerms\nversion: 5.4.145\nmain: me.lucko.luckperms.bukkit.loader.BukkitLoaderPlugin\n\
             description: \"A permissions plugin\"\nauthor: Luck\nauthors: [Luck, Turbo]\nfolia-supported: true\n\
             commands:\n  lp:\n    description: x\ndepend:\n  - Vault\n  - 'ProtocolLib'\n",
        );
        assert_eq!(y.name.as_deref(), Some("LuckPerms"));
        assert_eq!(y.version.as_deref(), Some("5.4.145"));
        assert_eq!(y.description.as_deref(), Some("A permissions plugin"));
        assert_eq!(y.authors, vec!["Luck", "Turbo"]);
        assert_eq!(y.depend, vec!["Vault", "ProtocolLib"]);
        assert!(y.folia_supported);
        // Blockliste + Kommentar
        let y = parse_plugin_yml("# c\nname: 'Foo' # Name\nauthors:\n  - A\n  - B\napi-version: '1.21'\n");
        assert_eq!(y.name.as_deref(), Some("Foo"));
        assert_eq!(y.authors, vec!["A", "B"]);
        assert!(!y.folia_supported);
    }

    fn srv(platform: Option<super::super::platform::PlatformKind>, loader: LoaderKind) -> Server {
        let json = serde_json::json!({"id":"t","name":"T","mc_version":"26.3","loader":{"kind":loader.as_str(),"version":null},
            "platform": platform.map(|k| serde_json::json!({"kind":k.as_str(),"build":null})),"port":25565,"created_at":0});
        serde_json::from_value(json).unwrap()
    }

    #[test]
    fn targets_and_facets() {
        use super::super::platform::PlatformKind as K;
        let t = target(&srv(Some(K::Paper), LoaderKind::Vanilla)).unwrap();
        assert_eq!((t.folder, t.plugins, t.hangar), ("plugins", true, Some("PAPER")));
        assert_eq!(
            modrinth_facets(&t),
            r#"[["project_type:plugin"],["categories:paper","categories:spigot","categories:bukkit"],["versions:26.3"]]"#
        );
        let t = target(&srv(Some(K::Folia), LoaderKind::Vanilla)).unwrap();
        assert_eq!(t.loaders, vec!["folia"]);
        assert_eq!(t.hangar, None);
        assert_eq!(target(&srv(Some(K::Purpur), LoaderKind::Vanilla)).unwrap().loaders[0], "purpur");
        let t = target(&srv(None, LoaderKind::Quilt)).unwrap();
        assert_eq!((t.folder, t.plugins), ("mods", false));
        assert_eq!(
            modrinth_facets(&t),
            r#"[["project_type:mod"],["categories:quilt","categories:fabric"],["versions:26.3"],["server_side:required","server_side:optional"]]"#
        );
        assert!(target(&srv(None, LoaderKind::Vanilla)).is_none());
    }

    #[test]
    fn modrinth_pick() {
        let t = AddonTarget { folder: "plugins", plugins: true, loaders: vec!["paper".into(), "spigot".into()], mc: "1.21.11".into(), hangar: None };
        let v = |id: &str, ty: &str, date: &str, loaders: &[&str], gv: &[&str]| mr::MrVersion {
            id: id.into(),
            version_type: ty.into(),
            date_published: date.into(),
            loaders: loaders.iter().map(|s| s.to_string()).collect(),
            game_versions: gv.iter().map(|s| s.to_string()).collect(),
            ..Default::default()
        };
        let list = vec![
            v("beta-new", "beta", "2026-11-10", &["paper"], &["1.21.11"]),
            v("fabric", "release", "2026-11-12", &["fabric"], &["1.21.11"]),
            v("rel-old", "release", "2026-10-01", &["spigot"], &["1.21.11"]),
            v("rel-new", "release", "2026-11-01", &["paper"], &["1.21.11"]),
            v("rel-wrongmc", "release", "2026-11-11", &["paper"], &["26.3"]),
        ];
        assert_eq!(pick_modrinth(&list, &t).unwrap().id, "rel-new");
        assert_eq!(pick_modrinth(&list[..1], &t).unwrap().id, "beta-new");
        assert!(pick_modrinth(&list[1..2], &t).is_none());
    }

    #[test]
    fn hangar_project_parse() {
        let b = br#"{"name":"ViaVersion","namespace":{"owner":"ViaVersion","slug":"ViaVersion"},"stats":{"downloads":532062,"stars":478},
            "category":"misc","description":"Allow newer versions","lastUpdated":"2026-11-07T09:38:30Z","createdAt":"2022-12-31T20:04:25Z",
            "settings":{"links":[{"id":0,"type":"top","links":[{"id":1,"name":"Issues","url":"https://github.com/ViaVersion/ViaVersion/issues"},
            {"id":2,"name":"Source","url":"https://github.com/ViaVersion/ViaVersion/"},{"id":3,"name":"Support","url":"https://discord.gg/ViaVersion"},
            {"id":4,"name":"Wiki","url":"https://docs.viaversion.com/"},{"id":5,"name":"Donate","url":"https://github.com/sponsors/x"},
            {"id":6,"name":"Evil","url":"javascript:alert(1)"}]}],
            "tags":["SUPPORTS_FOLIA"],"license":{"name":"GPL","url":"https://x","type":"GPL"},"keywords":["via","protocol"]},
            "supportedPlatforms":{"PAPER":["1.20.6","1.21.11","1.21.2"],"VELOCITY":["3.4"]},
            "avatarUrl":"https://hangarcdn.papermc.io/avatars/project/31.webp?v=1"}"#;
        let p = super::parse_hangar_project(b, Some("# Hallo".into())).unwrap();
        assert_eq!(p.id, "ViaVersion/ViaVersion");
        assert_eq!(p.follows, 478);
        assert_eq!(p.body, "# Hallo");
        assert_eq!(p.links.issues.as_deref(), Some("https://github.com/ViaVersion/ViaVersion/issues"));
        assert_eq!(p.links.discord.as_deref(), Some("https://discord.gg/ViaVersion"));
        assert_eq!(p.links.wiki.as_deref(), Some("https://docs.viaversion.com/"));
        assert_eq!(p.links.website, None, "Spenden-/javascript-Links nicht als Webseite");
        assert_eq!(p.game_versions, vec!["1.21.11", "1.21.2", "1.20.6"]);
        assert!(p.loaders.contains(&"folia".to_string()) && p.loaders.contains(&"paper".to_string()));
        assert_eq!(p.license.as_deref(), Some("GPL"));
        assert_eq!(p.page_url, "https://hangar.papermc.io/ViaVersion/ViaVersion");
        // Ohne Hauptseite: Kurzbeschreibung
        let p = super::parse_hangar_project(b, None).unwrap();
        assert_eq!(p.body, "Allow newer versions");
    }

    #[test]
    fn hangar_parse() {
        let search = r#"{"pagination":{"count":174,"limit":2,"offset":0},"result":[
            {"name":"ViaBackwards","namespace":{"owner":"ViaVersion","slug":"ViaBackwards"},"description":"Allow older clients",
             "avatarUrl":"https://hangarcdn.papermc.io/avatars/project/12.webp?v=1","lastUpdated":"2026-11-07T09:38:30Z","stats":{"downloads":772838}},
            {"name":"X","namespace":{"owner":"o","slug":"X"},"avatarUrl":"https://hangarcdn.papermc.io/avatars/default/default.webp?v=0","stats":{}}]}"#;
        let r = parse_hangar_search(search.as_bytes(), 0).unwrap();
        assert_eq!(r.total, 174);
        assert_eq!(r.hits[0].id, "ViaVersion/ViaBackwards");
        assert_eq!(r.hits[0].page_url, "https://hangar.papermc.io/ViaVersion/ViaBackwards");
        assert_eq!(r.hits[0].downloads, 772838);
        assert_eq!(r.hits[1].icon_url, None);

        let versions = r#"{"pagination":{"count":3},"result":[
            {"name":"5.12.3-SNAPSHOT+1119","createdAt":"2026-11-07T09:38:30Z","channel":{"name":"Snapshot"},
             "downloads":{"PAPER":{"fileInfo":{"name":"ViaVersion-5.12.3-SNAPSHOT.jar","sizeBytes":10,"sha256Hash":"AB"},"downloadUrl":"https://x/snap.jar","externalUrl":null}}},
            {"name":"5.12.2","createdAt":"2026-10-01T00:00:00Z","channel":{"name":"Release"},
             "downloads":{"PAPER":{"fileInfo":{"name":"ViaVersion-5.12.2.jar","sizeBytes":9,"sha256Hash":"CD"},"downloadUrl":"https://x/rel.jar","externalUrl":null}}},
            {"name":"5.12.1","createdAt":"2026-09-01T00:00:00Z","channel":{"name":"Release"},
             "downloads":{"VELOCITY":{"downloadUrl":"https://x/v.jar"}}}]}"#;
        let (name, url, file, size, sha) = pick_hangar(versions.as_bytes(), "PAPER").unwrap().unwrap();
        assert_eq!((name.as_str(), url.as_str(), file.as_str(), size, sha.as_deref()), ("5.12.2", "https://x/rel.jar", "ViaVersion-5.12.2.jar", Some(9), Some("CD")));
        let ext = r#"{"pagination":{"count":1},"result":[{"name":"1.0","createdAt":"x","channel":{"name":"Release"},
            "downloads":{"PAPER":{"fileInfo":null,"downloadUrl":null,"externalUrl":"https://github.com/x/releases"}}}]}"#;
        assert!(matches!(pick_hangar(ext.as_bytes(), "PAPER"), Err(AppError::Invalid(m)) if m.contains("extern")));
        assert!(pick_hangar(r#"{"pagination":{"count":0},"result":[]}"#.as_bytes(), "PAPER").unwrap().is_none());
    }

    #[test]
    fn file_names() {
        assert_eq!(safe_file_name("LuckPerms-Bukkit-5.4.jar"), "LuckPerms-Bukkit-5.4.jar");
        assert_eq!(safe_file_name("../evil"), "_evil.jar");
        assert_eq!(base_name("a.jar.disabled"), "a.jar");
    }
}
