//! CurseForge Core API (https://docs.curseforge.com/rest-api/). Benötigt `x-api-key`.
use super::http;
use super::*;
use crate::error::{AppError, AppResult};
use crate::state::AppState;
use serde::Deserialize;
use serde_json::json;

pub const API: &str = "https://api.curseforge.com/v1";
pub const GAME_ID: u32 = 432;
const S: &str = "CurseForge";

pub const CLASS_MODS: u32 = 6;
pub const CLASS_MODPACKS: u32 = 4471;
pub const CLASS_RESOURCEPACKS: u32 = 12;
pub const CLASS_SHADERS: u32 = 6552;
pub const CLASS_DATAPACKS: u32 = 6945;

// modLoaderType
pub const ML_FORGE: u32 = 1;
pub const ML_FABRIC: u32 = 4;
pub const ML_QUILT: u32 = 5;
pub const ML_NEOFORGE: u32 = 6;

// ------------------------------------------------------------------ Rohdaten

#[derive(Debug, Deserialize)]
pub struct CfData<T> {
    pub data: T,
}

#[derive(Debug, Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
pub struct CfPagination {
    pub index: u32,
    pub page_size: u32,
    pub result_count: u32,
    pub total_count: u64,
}

#[derive(Debug, Deserialize)]
pub struct CfPage<T> {
    pub data: Vec<T>,
    #[serde(default)]
    pub pagination: CfPagination,
}

#[derive(Debug, Deserialize, Default, Clone)]
#[serde(default, rename_all = "camelCase")]
pub struct CfLinks {
    pub website_url: Option<String>,
    pub wiki_url: Option<String>,
    pub issues_url: Option<String>,
    pub source_url: Option<String>,
}

#[derive(Debug, Deserialize, Default, Clone)]
#[serde(default, rename_all = "camelCase")]
pub struct CfCategory {
    pub id: u64,
    pub name: String,
    pub slug: String,
    pub icon_url: Option<String>,
    pub class_id: Option<u32>,
    pub parent_category_id: Option<u64>,
    pub is_class: Option<bool>,
}

#[derive(Debug, Deserialize, Default, Clone)]
#[serde(default)]
pub struct CfAuthor {
    pub name: String,
}

#[derive(Debug, Deserialize, Default, Clone)]
#[serde(default, rename_all = "camelCase")]
pub struct CfAsset {
    pub title: Option<String>,
    pub description: Option<String>,
    pub thumbnail_url: Option<String>,
    pub url: Option<String>,
}

#[derive(Debug, Deserialize, Default, Clone)]
#[serde(default, rename_all = "camelCase")]
pub struct CfFileIndex {
    pub game_version: String,
    pub file_id: u64,
    pub release_type: u32,
    pub mod_loader: Option<u32>,
}

#[derive(Debug, Deserialize, Default, Clone)]
#[serde(default, rename_all = "camelCase")]
pub struct CfMod {
    pub id: u64,
    pub name: String,
    pub slug: String,
    pub links: CfLinks,
    pub summary: String,
    pub download_count: f64,
    pub categories: Vec<CfCategory>,
    pub class_id: Option<u32>,
    pub authors: Vec<CfAuthor>,
    pub logo: Option<CfAsset>,
    pub screenshots: Vec<CfAsset>,
    pub latest_files_indexes: Vec<CfFileIndex>,
    pub date_created: Option<String>,
    pub date_modified: Option<String>,
    pub date_released: Option<String>,
    pub thumbs_up_count: u64,
    pub allow_mod_distribution: Option<bool>,
}

#[derive(Debug, Deserialize, Default, Clone)]
#[serde(default)]
pub struct CfHash {
    pub value: String,
    /// 1 = SHA-1, 2 = MD5
    pub algo: u32,
}

#[derive(Debug, Deserialize, Default, Clone)]
#[serde(default, rename_all = "camelCase")]
pub struct CfDependency {
    pub mod_id: u64,
    /// 1 Embedded, 2 Optional, 3 Required, 4 Tool, 5 Incompatible, 6 Include
    pub relation_type: u32,
}

#[derive(Debug, Deserialize, Default, Clone)]
#[serde(default, rename_all = "camelCase")]
pub struct CfFile {
    pub id: u64,
    pub mod_id: u64,
    pub is_available: Option<bool>,
    pub display_name: String,
    pub file_name: String,
    /// 1 Release, 2 Beta, 3 Alpha
    pub release_type: u32,
    pub hashes: Vec<CfHash>,
    pub file_date: String,
    pub file_length: u64,
    pub download_count: f64,
    pub download_url: Option<String>,
    pub game_versions: Vec<String>,
    pub dependencies: Vec<CfDependency>,
    pub is_server_pack: Option<bool>,
    pub file_fingerprint: u64,
}

impl CfFile {
    pub fn sha1(&self) -> Option<String> {
        self.hashes.iter().find(|h| h.algo == 1).map(|h| h.value.to_ascii_lowercase())
    }
}

#[derive(Debug, Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
pub struct CfFingerprintMatch {
    pub id: u64,
    pub file: CfFile,
}

#[derive(Debug, Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
pub struct CfFingerprintResult {
    pub exact_matches: Vec<CfFingerprintMatch>,
}

// ------------------------------------------------------------------ Mapping

pub fn class_id(t: ProjectType) -> u32 {
    match t {
        ProjectType::Mod => CLASS_MODS,
        ProjectType::Modpack => CLASS_MODPACKS,
        ProjectType::Resourcepack => CLASS_RESOURCEPACKS,
        ProjectType::Shader => CLASS_SHADERS,
        ProjectType::Datapack => CLASS_DATAPACKS,
    }
}

pub fn project_type_of_class(c: Option<u32>) -> ProjectType {
    match c {
        Some(CLASS_MODPACKS) => ProjectType::Modpack,
        Some(CLASS_RESOURCEPACKS) => ProjectType::Resourcepack,
        Some(CLASS_SHADERS) => ProjectType::Shader,
        Some(CLASS_DATAPACKS) => ProjectType::Datapack,
        _ => ProjectType::Mod,
    }
}

/// Zielordner für eine CurseForge-Klasse (Import von Modpacks).
pub fn kind_of_class(c: Option<u32>) -> ContentKind {
    match c {
        Some(CLASS_RESOURCEPACKS) => ContentKind::Resourcepack,
        Some(CLASS_SHADERS) => ContentKind::Shader,
        Some(CLASS_DATAPACKS) => ContentKind::Datapack,
        _ => ContentKind::Mod,
    }
}

pub fn sort_field(s: SortOrder, has_query: bool) -> u32 {
    // 1 Featured, 2 Popularity, 3 LastUpdated, 4 Name, 5 Author, 6 TotalDownloads, 11 ReleasedDate, 12 Rating
    match s {
        SortOrder::Relevance => {
            if has_query {
                1
            } else {
                2
            }
        }
        SortOrder::Downloads => 6,
        SortOrder::Follows => 12,
        SortOrder::Newest => 11,
        SortOrder::Updated => 3,
    }
}

pub fn mod_loader_types(l: LoaderKind) -> Vec<u32> {
    match l {
        LoaderKind::Vanilla => vec![],
        LoaderKind::Forge => vec![ML_FORGE],
        LoaderKind::Fabric => vec![ML_FABRIC],
        LoaderKind::Quilt => vec![ML_QUILT, ML_FABRIC],
        LoaderKind::Neoforge => vec![ML_NEOFORGE],
    }
}

pub fn loader_name(ml: u32) -> Option<&'static str> {
    Some(match ml {
        ML_FORGE => "forge",
        3 => "liteloader",
        ML_FABRIC => "fabric",
        ML_QUILT => "quilt",
        ML_NEOFORGE => "neoforge",
        _ => return None,
    })
}

/// Sortierschlüssel für Versionen wie "1.20.1" / "26.3".
fn version_key(s: &str) -> Vec<u64> {
    s.split(['.', '-']).map(|p| p.parse().unwrap_or(0)).collect()
}

fn is_mc_version(s: &str) -> bool {
    let s = s.strip_suffix("-Snapshot").unwrap_or(s);
    let parts: Vec<&str> = s.split('.').collect();
    (2..=3).contains(&parts.len()) && parts.iter().all(|p| !p.is_empty() && p.chars().all(|c| c.is_ascii_digit()))
}

/// `gameVersions` einer Datei in (Minecraft-Versionen, Loader) aufteilen.
pub fn split_game_versions(gv: &[String]) -> (Vec<String>, Vec<String>) {
    let mut mc = Vec::new();
    let mut loaders = Vec::new();
    for v in gv {
        let lower = v.to_ascii_lowercase();
        match lower.as_str() {
            "forge" | "fabric" | "quilt" | "neoforge" | "liteloader" => loaders.push(lower),
            _ if is_mc_version(v) => mc.push(v.clone()),
            _ => {}
        }
    }
    (mc, loaders)
}

pub fn convert_file(f: &CfFile) -> ProjectVersion {
    let (game_versions, loaders) = split_game_versions(&f.game_versions);
    ProjectVersion {
        source: Source::Curseforge,
        id: f.id.to_string(),
        project_id: f.mod_id.to_string(),
        name: if f.display_name.is_empty() { f.file_name.clone() } else { f.display_name.clone() },
        version_number: if f.display_name.is_empty() { f.file_name.clone() } else { f.display_name.clone() },
        game_versions,
        loaders,
        release_type: match f.release_type {
            2 => "beta",
            3 => "alpha",
            _ => "release",
        }
        .into(),
        date: f.file_date.clone(),
        downloads: f.download_count.max(0.0) as u64,
        files: vec![VersionFile {
            url: f.download_url.clone().filter(|u| !u.is_empty()),
            filename: f.file_name.clone(),
            size: f.file_length,
            sha1: f.sha1(),
            primary: true,
            sha512: None,
        }],
        dependencies: f
            .dependencies
            .iter()
            .map(|d| Dependency {
                project_id: Some(d.mod_id.to_string()),
                version_id: None,
                kind: match d.relation_type {
                    3 => DependencyKind::Required,
                    5 => DependencyKind::Incompatible,
                    1 | 6 => DependencyKind::Embedded,
                    _ => DependencyKind::Optional,
                },
            })
            .collect(),
        changelog: None,
    }
}

pub fn mod_to_hit(m: &CfMod) -> ProjectHit {
    let mut gv: Vec<String> = Vec::new();
    let mut loaders: Vec<String> = Vec::new();
    for i in &m.latest_files_indexes {
        if !gv.contains(&i.game_version) && is_mc_version(&i.game_version) {
            gv.push(i.game_version.clone());
        }
        if let Some(l) = i.mod_loader.and_then(loader_name) {
            if !loaders.iter().any(|x| x == l) {
                loaders.push(l.to_string());
            }
        }
    }
    gv.sort_by_key(|v| std::cmp::Reverse(version_key(v)));
    ProjectHit {
        source: Source::Curseforge,
        id: m.id.to_string(),
        slug: m.slug.clone(),
        title: m.name.clone(),
        description: m.summary.clone(),
        author: m.authors.first().map(|a| a.name.clone()).unwrap_or_default(),
        icon_url: m.logo.as_ref().and_then(|l| l.thumbnail_url.clone().or(l.url.clone())).filter(|u| !u.is_empty()),
        downloads: m.download_count.max(0.0) as u64,
        follows: m.thumbs_up_count,
        categories: m.categories.iter().map(|c| c.name.clone()).collect(),
        project_type: project_type_of_class(m.class_id),
        updated: m.date_modified.clone(),
        game_versions: gv,
        loaders,
    }
}

pub fn page_url(m: &CfMod) -> String {
    m.links.website_url.clone().filter(|u| !u.is_empty()).unwrap_or_else(|| {
        let seg = match project_type_of_class(m.class_id) {
            ProjectType::Mod => "mc-mods",
            ProjectType::Modpack => "modpacks",
            ProjectType::Resourcepack => "texture-packs",
            ProjectType::Shader => "shaders",
            ProjectType::Datapack => "data-packs",
        };
        format!("https://www.curseforge.com/minecraft/{seg}/{}", m.slug)
    })
}

/// Dateiseite auf curseforge.com (für manuelle Downloads).
pub fn file_page_url(m: &CfMod, file_id: u64) -> String {
    format!("{}/files/{file_id}", page_url(m).trim_end_matches('/'))
}

/// Suchparameter (ohne Basis-URL).
pub fn search_params(q: &SearchQuery) -> Vec<(String, String)> {
    let mut p: Vec<(String, String)> = vec![
        ("gameId".into(), GAME_ID.to_string()),
        ("classId".into(), class_id(q.project_type).to_string()),
        ("sortField".into(), sort_field(q.sort, !q.query.trim().is_empty()).to_string()),
        ("sortOrder".into(), "desc".into()),
        ("index".into(), q.offset.min(9_950).to_string()),
        ("pageSize".into(), q.limit.clamp(1, 50).to_string()),
    ];
    if !q.query.trim().is_empty() {
        p.push(("searchFilter".into(), q.query.trim().to_string()));
    }
    if let Some(v) = q.game_version.as_ref().filter(|v| !v.is_empty()) {
        p.push(("gameVersion".into(), v.clone()));
    }
    if matches!(q.project_type, ProjectType::Mod | ProjectType::Modpack) {
        if let Some(l) = q.loader {
            let ml = mod_loader_types(l);
            match ml.len() {
                0 => {}
                1 => p.push(("modLoaderType".into(), ml[0].to_string())),
                _ => p.push(("modLoaderTypes".into(), serde_json::to_string(&ml).unwrap_or_default())),
            }
        }
    }
    let cats: Vec<u64> = q.categories.iter().filter_map(|c| c.parse().ok()).collect();
    match cats.len() {
        0 => {}
        1 => p.push(("categoryId".into(), cats[0].to_string())),
        _ => p.push(("categoryIds".into(), serde_json::to_string(&cats.iter().take(10).collect::<Vec<_>>()).unwrap_or_default())),
    }
    p
}

/// Passt eine Datei zur Instanz? (`loader = None` = egal, z. B. Resourcepacks)
pub fn file_compatible(f: &CfFile, mc: Option<&str>, loader: Option<LoaderKind>) -> bool {
    if f.is_available == Some(false) || f.is_server_pack == Some(true) {
        return false;
    }
    let (versions, loaders) = split_game_versions(&f.game_versions);
    if let Some(mc) = mc {
        if !versions.iter().any(|v| v == mc) {
            return false;
        }
    }
    match loader {
        None | Some(LoaderKind::Vanilla) => true,
        Some(l) => {
            if loaders.is_empty() {
                // Alte Forge-Dateien tragen oft keinen Loader
                return l == LoaderKind::Forge;
            }
            let ok: &[&str] = match l {
                LoaderKind::Fabric => &["fabric"],
                LoaderKind::Quilt => &["quilt", "fabric"],
                LoaderKind::Forge => &["forge"],
                LoaderKind::Neoforge => &["neoforge"],
                LoaderKind::Vanilla => &[],
            };
            loaders.iter().any(|x| ok.contains(&x.as_str())) || (l == LoaderKind::Neoforge && mc == Some("1.20.1") && loaders.iter().any(|x| x == "forge"))
        }
    }
}

// ------------------------------------------------------------------ API

pub fn key(state: &AppState) -> AppResult<String> {
    state.settings().curseforge_key().ok_or_else(|| {
        AppError::NotConfigured("Für CurseForge wird ein API-Key benötigt. Du kannst ihn in den Einstellungen hinterlegen.".into())
    })
}

pub fn available(state: &AppState) -> bool {
    state.settings().curseforge_key().is_some()
}

async fn get<T: serde::de::DeserializeOwned>(state: &AppState, path_and_query: &str) -> AppResult<T> {
    let key = key(state)?;
    let url = format!("{API}{path_and_query}");
    let rb = state.net.client.get(&url).header("x-api-key", key).header("Accept", "application/json");
    let b = http::cached(state, url.clone(), rb, S).await?;
    http::parse(&b, S)
}

async fn post<T: serde::de::DeserializeOwned>(state: &AppState, path: &str, body: &serde_json::Value) -> AppResult<T> {
    let key = key(state)?;
    let url = format!("{API}{path}");
    let cache_key = format!("POST {url} {body}");
    let rb = state.net.client.post(&url).header("x-api-key", key).header("Accept", "application/json").json(body);
    let b = http::cached(state, cache_key, rb, S).await?;
    http::parse(&b, S)
}

fn query_string(p: &[(String, String)]) -> String {
    p.iter().map(|(k, v)| format!("{k}={}", urlencoding::encode(v))).collect::<Vec<_>>().join("&")
}

pub async fn search(state: &AppState, q: &SearchQuery) -> AppResult<SearchResult> {
    let params = search_params(q);
    let r: CfPage<CfMod> = get(state, &format!("/mods/search?{}", query_string(&params))).await?;
    let limit = q.limit.clamp(1, 50);
    Ok(SearchResult {
        hits: r.data.iter().map(mod_to_hit).collect(),
        // CurseForge liefert höchstens 10 000 Ergebnisse
        total: r.pagination.total_count.min(10_000),
        offset: q.offset,
        limit,
    })
}

pub async fn categories(state: &AppState, project_type: ProjectType) -> AppResult<Vec<Category>> {
    let r: CfData<Vec<CfCategory>> = get(state, &format!("/categories?gameId={GAME_ID}&classId={}", class_id(project_type))).await?;
    let mut v: Vec<Category> = r
        .data
        .into_iter()
        .filter(|c| c.is_class != Some(true))
        .map(|c| Category { id: c.id.to_string(), name: c.name, icon: c.icon_url.filter(|u| !u.is_empty()) })
        .collect();
    v.sort_by_key(|c| c.name.to_lowercase());
    Ok(v)
}

fn parse_id(id: &str) -> AppResult<u64> {
    id.trim().parse().map_err(|_| AppError::Invalid(format!("Ungültige CurseForge-ID: {id}")))
}

pub async fn raw_mod(state: &AppState, id: &str) -> AppResult<CfMod> {
    let r: CfData<CfMod> = get(state, &format!("/mods/{}", parse_id(id)?)).await?;
    Ok(r.data)
}

pub async fn raw_mods(state: &AppState, ids: &[u64]) -> AppResult<Vec<CfMod>> {
    let mut out = Vec::new();
    for chunk in ids.chunks(500) {
        let r: CfData<Vec<CfMod>> = post(state, "/mods", &json!({ "modIds": chunk, "filterPcOnly": true })).await?;
        out.extend(r.data);
    }
    Ok(out)
}

pub async fn raw_files_by_id(state: &AppState, ids: &[u64]) -> AppResult<Vec<CfFile>> {
    let mut out = Vec::new();
    for chunk in ids.chunks(500) {
        let r: CfData<Vec<CfFile>> = post(state, "/mods/files", &json!({ "fileIds": chunk })).await?;
        out.extend(r.data);
    }
    Ok(out)
}

pub async fn raw_file(state: &AppState, mod_id: &str, file_id: &str) -> AppResult<CfFile> {
    let r: CfData<CfFile> = get(state, &format!("/mods/{}/files/{}", parse_id(mod_id)?, parse_id(file_id)?)).await?;
    Ok(r.data)
}

/// Dateien eines Projekts (serverseitig nach Version/Loader gefiltert, max. 1000).
pub async fn raw_files(state: &AppState, mod_id: &str, mc: Option<&str>, loader: Option<LoaderKind>) -> AppResult<Vec<CfFile>> {
    let id = parse_id(mod_id)?;
    let mut out = Vec::new();
    let mut index = 0u32;
    // Quilt (Fabric-Dateien erlaubt) und NeoForge 1.20.1 (Forge-Dateien erlaubt): serverseitig nicht
    // nach Loader filtern, clientseitig prüfen
    let ml = loader
        .filter(|l| !(*l == LoaderKind::Neoforge && mc == Some("1.20.1")))
        .map(mod_loader_types)
        .filter(|v| v.len() == 1)
        .map(|v| v[0]);
    loop {
        let mut q = format!("/mods/{id}/files?index={index}&pageSize=50");
        if let Some(mc) = mc {
            q.push_str(&format!("&gameVersion={}", urlencoding::encode(mc)));
        }
        if let Some(ml) = ml {
            q.push_str(&format!("&modLoaderType={ml}"));
        }
        let page: CfPage<CfFile> = get(state, &q).await?;
        let n = page.data.len() as u32;
        out.extend(page.data);
        index += n;
        if n == 0 || index as u64 >= page.pagination.total_count || index >= 1000 {
            break;
        }
    }
    Ok(out)
}

pub async fn description(state: &AppState, id: &str) -> AppResult<String> {
    let r: CfData<String> = get(state, &format!("/mods/{}/description", parse_id(id)?)).await?;
    Ok(r.data)
}

pub async fn changelog(state: &AppState, mod_id: &str, file_id: &str) -> AppResult<String> {
    let r: CfData<String> = get(state, &format!("/mods/{}/files/{}/changelog", parse_id(mod_id)?, parse_id(file_id)?)).await?;
    Ok(r.data)
}

pub async fn project(state: &AppState, id: &str) -> AppResult<ProjectDetails> {
    let (m, body) = futures::future::join(raw_mod(state, id), description(state, id)).await;
    let m = m?;
    let body = body.unwrap_or_else(|_| format!("<p>{}</p>", m.summary));
    let hit = mod_to_hit(&m);
    Ok(ProjectDetails {
        body,
        body_format: "html".into(),
        gallery: m
            .screenshots
            .iter()
            .filter_map(|s| {
                Some(GalleryImage {
                    url: s.url.clone().or(s.thumbnail_url.clone())?,
                    title: s.title.clone().filter(|t| !t.is_empty()),
                    description: s.description.clone().filter(|t| !t.is_empty()),
                    featured: false,
                })
            })
            .collect(),
        links: ProjectLinks {
            website: None,
            source: m.links.source_url.clone().filter(|u| !u.is_empty()),
            issues: m.links.issues_url.clone().filter(|u| !u.is_empty()),
            wiki: m.links.wiki_url.clone().filter(|u| !u.is_empty()),
            discord: None,
        },
        license: None,
        published: m.date_released.clone().or(m.date_created.clone()),
        page_url: page_url(&m),
        hit,
    })
}

/// Fingerprints (Murmur2) -> exakte Treffer.
pub async fn fingerprints(state: &AppState, fps: &[u32]) -> AppResult<Vec<CfFingerprintMatch>> {
    let mut out = Vec::new();
    for chunk in fps.chunks(500) {
        let r: CfData<CfFingerprintResult> = post(state, &format!("/fingerprints/{GAME_ID}"), &json!({ "fingerprints": chunk })).await?;
        out.extend(r.data.exact_matches);
    }
    Ok(out)
}

/// Sortiert nach Datum, neueste zuerst.
pub fn sort_files(files: &mut [CfFile]) {
    files.sort_by(|a, b| b.file_date.cmp(&a.file_date));
}

#[cfg(test)]
mod tests {
    use super::*;

    const SEARCH: &str = include_str!("testdata/cf_search.json");
    const FILES: &str = include_str!("testdata/cf_files.json");
    const FP: &str = include_str!("testdata/cf_fingerprints.json");

    #[test]
    fn parse_search() {
        let r: CfPage<CfMod> = serde_json::from_str(SEARCH).unwrap();
        assert_eq!(r.pagination.total_count, 12345);
        let h = mod_to_hit(&r.data[0]);
        assert_eq!(h.id, "238222");
        assert_eq!(h.title, "Just Enough Items (JEI)");
        assert_eq!(h.author, "mezz");
        assert_eq!(h.project_type, ProjectType::Mod);
        assert_eq!(h.downloads, 300000000);
        assert_eq!(h.game_versions, vec!["1.20.1", "1.19.2"]);
        assert_eq!(h.loaders, vec!["forge", "neoforge", "fabric"]);
        assert_eq!(h.icon_url.as_deref(), Some("https://media.forgecdn.net/avatars/thumbnails/29/69/64/64/635838945588716414.jpeg"));
        assert_eq!(page_url(&r.data[0]), "https://www.curseforge.com/minecraft/mc-mods/jei");
        assert_eq!(file_page_url(&r.data[0], 4712866), "https://www.curseforge.com/minecraft/mc-mods/jei/files/4712866");
    }

    #[test]
    fn parse_files() {
        let mut r: CfPage<CfFile> = serde_json::from_str(FILES).unwrap();
        sort_files(&mut r.data);
        let f = &r.data[0];
        assert_eq!(f.id, 4712866);
        assert!(file_compatible(f, Some("1.20.1"), Some(LoaderKind::Forge)));
        assert!(!file_compatible(f, Some("1.20.1"), Some(LoaderKind::Fabric)));
        assert!(file_compatible(f, Some("1.20.1"), Some(LoaderKind::Neoforge)), "NeoForge 1.20.1 lädt Forge-Mods");
        assert!(!file_compatible(f, Some("1.19.2"), Some(LoaderKind::Forge)));
        let v = convert_file(f);
        assert_eq!(v.game_versions, vec!["1.20.1"]);
        assert_eq!(v.loaders, vec!["forge"]);
        assert_eq!(v.release_type, "release");
        assert_eq!(v.files[0].sha1.as_deref(), Some("0123456789abcdef0123456789abcdef01234567"));
        assert_eq!(v.files[0].url.as_deref(), Some("https://edge.forgecdn.net/files/4712/866/jei-1.20.1-forge-15.2.0.27.jar"));
        assert_eq!(v.dependencies.len(), 3);
        assert_eq!(v.dependencies[0].kind, DependencyKind::Required);
        assert_eq!(v.dependencies[1].kind, DependencyKind::Optional);
        assert_eq!(v.dependencies[2].kind, DependencyKind::Incompatible);
        // Gesperrter Download
        let locked = &r.data[1];
        assert_eq!(convert_file(locked).files[0].url, None);
        assert_eq!(convert_file(locked).release_type, "beta");
        // Fabric-Datei auf Quilt erlaubt
        let fabric = &r.data[2];
        assert!(file_compatible(fabric, Some("1.20.1"), Some(LoaderKind::Quilt)));
        assert!(!file_compatible(fabric, Some("1.20.1"), Some(LoaderKind::Forge)));
    }

    #[test]
    fn parse_fingerprints() {
        let r: CfData<CfFingerprintResult> = serde_json::from_str(FP).unwrap();
        assert_eq!(r.data.exact_matches.len(), 1);
        assert_eq!(r.data.exact_matches[0].id, 238222);
        assert_eq!(r.data.exact_matches[0].file.file_fingerprint, 3089143260);
    }

    #[test]
    fn params() {
        let q = SearchQuery {
            source: Source::Curseforge,
            query: "jei".into(),
            project_type: ProjectType::Mod,
            game_version: Some("1.20.1".into()),
            loader: Some(LoaderKind::Quilt),
            categories: vec!["423".into(), "424".into()],
            sort: SortOrder::Relevance,
            offset: 20,
            limit: 100,
        };
        let p = search_params(&q);
        let get = |k: &str| p.iter().find(|(a, _)| a == k).map(|(_, v)| v.clone());
        assert_eq!(get("classId").as_deref(), Some("6"));
        assert_eq!(get("sortField").as_deref(), Some("1"));
        assert_eq!(get("pageSize").as_deref(), Some("50"));
        assert_eq!(get("modLoaderTypes").as_deref(), Some("[5,4]"));
        assert_eq!(get("categoryIds").as_deref(), Some("[423,424]"));
        assert_eq!(get("searchFilter").as_deref(), Some("jei"));
        let q2 = SearchQuery { project_type: ProjectType::Shader, loader: Some(LoaderKind::Forge), query: "".into(), categories: vec![], ..q };
        let p2 = search_params(&q2);
        assert!(p2.iter().all(|(k, _)| k != "modLoaderType" && k != "modLoaderTypes"));
        assert!(p2.iter().any(|(k, v)| k == "classId" && v == "6552"));
        assert!(p2.iter().any(|(k, v)| k == "sortField" && v == "2"));
    }

    #[test]
    fn game_versions_split() {
        let (mc, l) = split_game_versions(&["1.20.1".into(), "NeoForge".into(), "Client".into(), "Java 17".into(), "1.21-Snapshot".into()]);
        assert_eq!(mc, vec!["1.20.1", "1.21-Snapshot"]);
        assert_eq!(l, vec!["neoforge"]);
    }
}
