//! Versions-JSON-Modell (Mojang-Format inkl. Loader-Profile), Regeln (`rules`), Mojang-Manifest.
use crate::error::{AppError, AppResult, Ctx};
use crate::net::DownloadItem;
use crate::paths::{maven_path, Paths};
use crate::Core;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::OnceLock;

mod types;
pub use types::*;
mod rules;
pub use rules::*;
mod libs;
pub use libs::*;

pub const MANIFEST_URL: &str = "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json";
pub const LIBRARIES_URL: &str = "https://libraries.minecraft.net/";
pub const RESOURCES_URL: &str = "https://resources.download.minecraft.net/";

// ------------------------------------------------------------------ Manifest

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Manifest {
    #[serde(default)]
    pub versions: Vec<ManifestEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ManifestEntry {
    pub id: String,
    #[serde(rename = "type")]
    pub kind: String,
    pub url: String,
    #[serde(default)]
    pub sha1: Option<String>,
    #[serde(default)]
    pub release_time: String,
}

fn manifest_cache_path(paths: &Paths) -> PathBuf {
    paths.meta().join("version_manifest_v2.json")
}

/// Manifest laden: Speicher-Cache (10 min) > Netz > Datei-Cache (offline).
pub async fn manifest(state: &Core, refresh: bool) -> AppResult<Manifest> {
    static MEM: OnceLock<parking_lot::Mutex<Option<(std::time::Instant, Manifest)>>> = OnceLock::new();
    let mem = MEM.get_or_init(Default::default);
    if !refresh {
        if let Some((at, m)) = mem.lock().as_ref() {
            if at.elapsed() < std::time::Duration::from_secs(600) {
                return Ok(m.clone());
            }
        }
    }
    let cache = manifest_cache_path(&state.paths);
    match state.net.get_bytes(MANIFEST_URL).await {
        Ok(bytes) => {
            let m: Manifest = serde_json::from_slice(&bytes).ctx("Versionsliste von Mojang ist ungültig")?;
            if let Some(p) = cache.parent() {
                let _ = tokio::fs::create_dir_all(p).await;
            }
            let _ = tokio::fs::write(&cache, &bytes).await;
            *mem.lock() = Some((std::time::Instant::now(), m.clone()));
            Ok(m)
        }
        Err(e) => {
            tracing::warn!("Manifest nicht ladbar, nutze Cache: {e}");
            let bytes = tokio::fs::read(&cache)
                .await
                .map_err(|_| AppError::msg(format!("Versionsliste konnte nicht geladen werden (keine Internetverbindung?): {e}")))?;
            let m: Manifest = serde_json::from_slice(&bytes)?;
            *mem.lock() = Some((std::time::Instant::now(), m.clone()));
            Ok(m)
        }
    }
}

/// Lädt die Vanilla-Versions-JSON (falls noch nicht vorhanden) und gibt sie zurück.
pub async fn ensure_vanilla_json(state: &Core, id: &str, force: bool) -> AppResult<VersionJson> {
    let path = state.paths.version_json(id);
    if !force && path.exists() {
        if let Ok(v) = read_version_file(&path) {
            return Ok(v);
        }
    }
    let m = manifest(state, false).await?;
    let entry = match m.versions.iter().find(|v| v.id == id) {
        Some(e) => e.clone(),
        None => {
            let m = manifest(state, true).await?;
            m.versions
                .iter()
                .find(|v| v.id == id)
                .cloned()
                .ok_or_else(|| AppError::msg(format!("Minecraft-Version {id} gibt es nicht.")))?
        }
    };
    if force {
        let _ = tokio::fs::remove_file(&path).await;
    }
    state
        .net
        .download_all(vec![DownloadItem::new(&entry.url, &path).sha1(entry.sha1.clone())], None)
        .await
        .map_err(|e| AppError::msg(format!("Versionsdaten für {id} konnten nicht geladen werden: {e}")))?;
    read_version_file(&path)
}

pub fn read_version_file(path: &std::path::Path) -> AppResult<VersionJson> {
    let bytes = std::fs::read(path)?;
    serde_json::from_slice(&bytes).map_err(|e| AppError::msg(format!("Versionsdatei {} ist beschädigt: {e}", path.display())))
}

/// Kette laden: [Kind, Eltern, ..., Vanilla]
pub fn load_chain(paths: &Paths, id: &str) -> AppResult<Vec<VersionJson>> {
    let mut chain = Vec::new();
    let mut cur = id.to_string();
    loop {
        if chain.len() > 8 {
            return Err(AppError::msg("Versionskette zu tief (inheritsFrom-Schleife?)"));
        }
        let path = paths.version_json(&cur);
        if !path.exists() {
            return Err(AppError::msg(format!("Versionsdatei {cur} fehlt – bitte Instanz reparieren.")));
        }
        let v = read_version_file(&path)?;
        let parent = v.inherits_from.clone();
        chain.push(v);
        match parent {
            Some(p) if !p.is_empty() => cur = p,
            _ => break,
        }
    }
    Ok(chain)
}

pub fn merge(chain: &[VersionJson], env: &Env) -> Resolved {
    let mut r = Resolved::default();
    let Some(child) = chain.first() else { return r };
    r.id = child.id.clone();
    r.base_id = chain.last().map(|v| v.id.clone()).unwrap_or_default();
    // Von der Basis zum Kind
    for v in chain.iter().rev() {
        if let Some(k) = &v.kind {
            r.kind = k.clone();
        }
        if let Some(m) = &v.main_class {
            if !m.is_empty() {
                r.main_class = m.clone();
            }
        }
        if let Some(a) = &v.minecraft_arguments {
            if !a.trim().is_empty() {
                r.minecraft_arguments = Some(a.clone());
            }
        }
        if let Some(a) = &v.arguments {
            r.game_args.extend(a.game.iter().cloned());
            if !a.jvm.is_empty() {
                r.has_jvm_args = true;
            }
            r.jvm_args.extend(a.jvm.iter().cloned());
            r.default_user_jvm.extend(a.default_user_jvm.iter().cloned());
        }
        if v.asset_index.is_some() {
            r.asset_index = v.asset_index.clone();
        }
        if v.assets.is_some() {
            r.assets = v.assets.clone();
        }
        if let Some(c) = v.downloads.get("client") {
            r.client = Some(c.clone());
        }
        if let Some(j) = &v.java_version {
            if j.major_version.is_some() || j.component.is_some() {
                r.java = Some(j.clone());
            }
        }
        if let Some(l) = v.logging.as_ref().and_then(|l| l.client.as_ref()) {
            if !l.file.url.is_empty() {
                r.logging = Some(l.clone());
            }
        }
        if let Some(j) = &v.jar {
            if !j.is_empty() {
                r.jar = Some(j.clone());
            }
        }
    }
    // Libraries: Kind zuerst, Eltern dahinter; gleiche group:artifact[:classifier] -> Kind gewinnt
    let mut seen = std::collections::HashSet::new();
    for v in chain {
        for lib in &v.libraries {
            if !lib.allowed(env) {
                continue;
            }
            let key = if lib.natives.is_some() { format!("{}#natives", library_key(&lib.name)) } else { library_key(&lib.name) };
            if seen.insert(key) {
                r.libraries.push(lib.clone());
            }
        }
    }
    r
}

/// Java-Hauptversion, die eine Version verlangt (Standard 8 für alte Versionen).
pub fn required_java(r: &Resolved) -> u32 {
    r.java.as_ref().and_then(|j| j.major_version).unwrap_or(8)
}

#[cfg(test)]
mod tests;
