//! Modrinth API v2 (Rohdaten).
use super::http;
use crate::error::AppResult;
use crate::Core;
use serde::Deserialize;
use serde_json::json;
use std::collections::HashMap;

pub const API: &str = "https://api.modrinth.com/v2";
pub const S: &str = "Modrinth";

/// Kategorien-Namen, die bei Modrinth eigentlich Loader sind.
pub const LOADER_TAGS: &[&str] = &[
    "fabric", "forge", "neoforge", "quilt", "liteloader", "modloader", "rift", "iris", "optifine", "canvas", "vanilla",
    "minecraft", "datapack", "bukkit", "paper", "spigot", "purpur", "folia", "velocity", "bungeecord", "waterfall",
    "sponge", "babric", "bta-babric", "java-agent", "legacy-fabric", "ornithe", "nilloader",
];


#[derive(Debug, Deserialize, Default)]
#[serde(default)]
pub struct MrLicense {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Deserialize, Default)]
#[serde(default)]
pub struct MrGallery {
    pub url: String,
    pub featured: bool,
    pub title: Option<String>,
    pub description: Option<String>,
    pub ordering: i64,
}

#[derive(Debug, Deserialize, Default)]
#[serde(default)]
pub struct MrDonation {
    pub url: String,
}

#[derive(Debug, Deserialize, Default)]
#[serde(default)]
pub struct MrProject {
    pub id: String,
    pub slug: String,
    pub title: String,
    pub description: String,
    pub body: String,
    pub categories: Vec<String>,
    pub additional_categories: Vec<String>,
    pub project_type: String,
    pub downloads: u64,
    pub followers: u64,
    pub icon_url: Option<String>,
    pub issues_url: Option<String>,
    pub source_url: Option<String>,
    pub wiki_url: Option<String>,
    pub discord_url: Option<String>,
    pub donation_urls: Option<Vec<MrDonation>>,
    pub license: Option<MrLicense>,
    pub published: Option<String>,
    pub updated: Option<String>,
    pub game_versions: Vec<String>,
    pub loaders: Vec<String>,
    pub gallery: Vec<MrGallery>,
    pub color: Option<u32>,
    pub team: String,
    pub organization: Option<String>,
    pub client_side: Option<String>,
    pub server_side: Option<String>,
}

#[derive(Debug, Deserialize, Default, Clone)]
#[serde(default)]
pub struct MrHashes {
    pub sha1: Option<String>,
    pub sha512: Option<String>,
}

#[derive(Debug, Deserialize, Default, Clone)]
#[serde(default)]
pub struct MrFile {
    pub hashes: MrHashes,
    pub url: String,
    pub filename: String,
    pub primary: bool,
    pub size: u64,
}

#[derive(Debug, Deserialize, Default, Clone)]
#[serde(default)]
pub struct MrDependency {
    pub version_id: Option<String>,
    pub project_id: Option<String>,
    pub dependency_type: String,
}

#[derive(Debug, Deserialize, Default, Clone)]
#[serde(default)]
pub struct MrVersion {
    pub id: String,
    pub project_id: String,
    pub name: String,
    pub version_number: String,
    pub changelog: Option<String>,
    pub dependencies: Vec<MrDependency>,
    pub game_versions: Vec<String>,
    pub version_type: String,
    pub loaders: Vec<String>,
    pub date_published: String,
    pub downloads: u64,
    pub files: Vec<MrFile>,
}


// ------------------------------------------------------------------ API

pub async fn get<T: serde::de::DeserializeOwned>(state: &Core, path_and_query: &str) -> AppResult<T> {
    let url = format!("{API}{path_and_query}");
    let b = http::cached(state, url.clone(), state.net.client.get(&url), S).await?;
    http::parse(&b, S)
}

pub async fn post<T: serde::de::DeserializeOwned>(state: &Core, path: &str, body: &serde_json::Value) -> AppResult<T> {
    let url = format!("{API}{path}");
    let key = format!("POST {url} {body}");
    let b = http::cached(state, key, state.net.client.post(&url).json(body), S).await?;
    http::parse(&b, S)
}

pub async fn raw_project(state: &Core, id: &str) -> AppResult<MrProject> {
    get(state, &format!("/project/{}", urlencoding::encode(id))).await
}

pub async fn raw_projects(state: &Core, ids: &[String]) -> AppResult<Vec<MrProject>> {
    let mut out = Vec::new();
    for chunk in ids.chunks(100) {
        let ids = serde_json::to_string(chunk)?;
        let mut v: Vec<MrProject> = get(state, &format!("/projects?ids={}", urlencoding::encode(&ids))).await?;
        out.append(&mut v);
    }
    Ok(out)
}

pub async fn raw_versions(state: &Core, project_id: &str) -> AppResult<Vec<MrVersion>> {
    get(state, &format!("/project/{}/version", urlencoding::encode(project_id))).await
}

pub async fn raw_version(state: &Core, version_id: &str) -> AppResult<MrVersion> {
    get(state, &format!("/version/{}", urlencoding::encode(version_id))).await
}

pub async fn version_project_id(state: &Core, version_id: &str) -> AppResult<String> {
    Ok(raw_version(state, version_id).await?.project_id)
}

pub async fn raw_versions_batch(state: &Core, ids: &[String]) -> AppResult<Vec<MrVersion>> {
    let mut out = Vec::new();
    for chunk in ids.chunks(100) {
        let ids = serde_json::to_string(chunk)?;
        let mut v: Vec<MrVersion> = get(state, &format!("/versions?ids={}", urlencoding::encode(&ids))).await?;
        out.append(&mut v);
    }
    Ok(out)
}

/// sha1 -> Version (POST /version_files).
pub async fn versions_by_hash(state: &Core, sha1s: &[String]) -> AppResult<HashMap<String, MrVersion>> {
    let mut out = HashMap::new();
    for chunk in sha1s.chunks(300) {
        let body = json!({ "hashes": chunk, "algorithm": "sha1" });
        let m: HashMap<String, MrVersion> = post(state, "/version_files", &body).await?;
        out.extend(m.into_iter().map(|(k, v)| (k.to_ascii_lowercase(), v)));
    }
    Ok(out)
}

/// Datei mit exakt diesem SHA-1 auf Modrinth (z. B. Ersatz für CurseForge-Dateien mit gesperrtem Download).
#[derive(Debug, Clone)]
pub struct Mirror {
    pub url: String,
    pub size: u64,
    pub sha512: Option<String>,
    pub project_id: String,
    pub version_id: String,
}

/// sha1 -> Modrinth-Spiegel. Fehler werden ignoriert (leere Map).
pub async fn mirrors(state: &Core, sha1s: &[String]) -> HashMap<String, Mirror> {
    if sha1s.is_empty() {
        return HashMap::new();
    }
    let Ok(found) = versions_by_hash(state, sha1s).await else { return HashMap::new() };
    let mut out = HashMap::new();
    for (sha1, v) in found {
        if let Some(f) = v.files.iter().find(|f| f.hashes.sha1.as_deref().is_some_and(|h| h.eq_ignore_ascii_case(&sha1))) {
            out.insert(sha1, Mirror { url: f.url.clone(), size: f.size, sha512: f.hashes.sha512.clone(), project_id: v.project_id.clone(), version_id: v.id.clone() });
        }
    }
    out
}

/// sha1 -> neueste passende Version (POST /version_files/update).
pub async fn latest_by_hash(
    state: &Core,
    sha1s: &[String],
    loaders: Option<&[String]>,
    game_versions: &[String],
) -> AppResult<HashMap<String, MrVersion>> {
    let mut out = HashMap::new();
    for chunk in sha1s.chunks(300) {
        let mut body = json!({ "hashes": chunk, "algorithm": "sha1", "game_versions": game_versions });
        if let Some(l) = loaders {
            body["loaders"] = json!(l);
        }
        // Updates nicht cachen (Nutzer prüft bewusst neu)
        let url = format!("{API}/version_files/update");
        let b = http::send(state.net.client.post(&url).json(&body), S).await?;
        let m: HashMap<String, MrVersion> = http::parse(&b, S)?;
        out.extend(m.into_iter().map(|(k, v)| (k.to_ascii_lowercase(), v)));
    }
    Ok(out)
}

