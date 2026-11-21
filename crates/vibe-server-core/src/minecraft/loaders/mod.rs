//! Mod-Loader: Versionslisten (Fabric, Quilt, Forge, NeoForge) und Profil-Installation (Fabric/Quilt).
//! Forge/NeoForge-Installer siehe `forge.rs`.
use super::LoaderVersion;
use crate::error::{AppError, AppResult};
use crate::model::LoaderKind;
use crate::Core;
use serde::Deserialize;
use std::cmp::Ordering;
use std::collections::HashMap;
use std::sync::OnceLock;
use std::time::{Duration, Instant};

mod forge_neo;
pub use forge_neo::*;

pub const FABRIC_META: &str = "https://meta.fabricmc.net/v2";
pub const QUILT_META: &str = "https://meta.quiltmc.org/v3";
pub const FORGE_MAVEN: &str = "https://maven.minecraftforge.net/";
pub const FORGE_METADATA: &str = "https://maven.minecraftforge.net/net/minecraftforge/forge/maven-metadata.xml";
pub const FORGE_PROMOS: &str = "https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json";
pub const NEO_MAVEN: &str = "https://maven.neoforged.net/releases/";
pub const NEO_VERSIONS: &str = "https://maven.neoforged.net/api/maven/versions/releases/net/neoforged/neoforge";
pub const NEO_FORGE_VERSIONS: &str = "https://maven.neoforged.net/api/maven/versions/releases/net/neoforged/forge";

/// GET mit Speicher-Cache (10 min) und Datei-Cache als Offline-Fallback.
pub async fn fetch_cached(state: &Core, url: &str) -> AppResult<bytes::Bytes> {
    type Mem = parking_lot::Mutex<HashMap<String, (Instant, bytes::Bytes)>>;
    static MEM: OnceLock<Mem> = OnceLock::new();
    let mem = MEM.get_or_init(Default::default);
    if let Some((t, b)) = mem.lock().get(url) {
        if t.elapsed() < Duration::from_secs(600) {
            return Ok(b.clone());
        }
    }
    use sha1::Digest;
    let key = hex::encode(sha1::Sha1::digest(url.as_bytes()));
    let file = state.paths.cache().join("api").join(format!("{key}.bin"));
    match state.net.get_bytes(url).await {
        Ok(b) => {
            if let Some(p) = file.parent() {
                let _ = tokio::fs::create_dir_all(p).await;
            }
            let _ = tokio::fs::write(&file, &b).await;
            mem.lock().insert(url.to_string(), (Instant::now(), b.clone()));
            Ok(b)
        }
        Err(e) => match tokio::fs::read(&file).await {
            Ok(b) => Ok(bytes::Bytes::from(b)),
            Err(_) => Err(e),
        },
    }
}

async fn fetch_json<T: serde::de::DeserializeOwned>(state: &Core, url: &str) -> AppResult<T> {
    let b = fetch_cached(state, url).await?;
    serde_json::from_slice(&b).map_err(|e| AppError::msg(format!("Ungültige Antwort von {url}: {e}")))
}

/// Vergleicht Versionsnummern wie "21.1.77", "47.3.0", "20.2.3-beta" (Vorabversionen < Release).
pub fn cmp_version(a: &str, b: &str) -> Ordering {
    let split = |s: &str| -> (Vec<u64>, bool) {
        let (main, pre) = match s.split_once('-') {
            Some((m, _)) => (m, true),
            None => (s, false),
        };
        (main.split('.').map(|x| x.chars().take_while(|c| c.is_ascii_digit()).collect::<String>().parse().unwrap_or(0)).collect(), pre)
    };
    let (pa, prea) = split(a);
    let (pb, preb) = split(b);
    for i in 0..pa.len().max(pb.len()) {
        let x = pa.get(i).copied().unwrap_or(0);
        let y = pb.get(i).copied().unwrap_or(0);
        if x != y {
            return x.cmp(&y);
        }
    }
    // gleiche Zahlen: Release > Vorabversion
    preb.cmp(&prea)
}

/// MC-Versionen nach Mojang-Reihenfolge sortieren (neueste zuerst); unbekannte hinten.
async fn sort_mc_versions(state: &Core, mut v: Vec<String>) -> Vec<String> {
    let order: HashMap<String, usize> = match super::meta::manifest(state, false).await {
        Ok(m) => m.versions.iter().enumerate().map(|(i, e)| (e.id.clone(), i)).collect(),
        Err(_) => HashMap::new(),
    };
    v.sort_by(|a, b| match (order.get(a), order.get(b)) {
        (Some(x), Some(y)) => x.cmp(y),
        (Some(_), None) => Ordering::Less,
        (None, Some(_)) => Ordering::Greater,
        (None, None) => cmp_version(b, a),
    });
    v.dedup();
    v
}

// ------------------------------------------------------------------ Fabric / Quilt

#[derive(Deserialize)]
struct MetaGame {
    version: String,
}
#[derive(Deserialize)]
struct MetaLoaderEntry {
    loader: MetaLoader,
}
#[derive(Deserialize)]
struct MetaLoader {
    version: String,
    #[serde(default)]
    stable: Option<bool>,
}

fn meta_base(kind: LoaderKind) -> &'static str {
    if kind == LoaderKind::Quilt { QUILT_META } else { FABRIC_META }
}

// ------------------------------------------------------------------ öffentliche Listen

pub async fn game_versions(state: &Core, kind: LoaderKind) -> AppResult<Vec<String>> {
    match kind {
        LoaderKind::Vanilla => {
            let m = super::meta::manifest(state, false).await?;
            Ok(m.versions.into_iter().map(|v| v.id).collect())
        }
        LoaderKind::Fabric | LoaderKind::Quilt => {
            let list: Vec<MetaGame> = fetch_json(state, &format!("{}/versions/game", meta_base(kind))).await?;
            Ok(list.into_iter().map(|g| g.version).collect())
        }
        LoaderKind::Forge => {
            let idx = forge_index(state).await?;
            let mcs: Vec<String> = idx.versions.iter().filter_map(|v| split_forge_version(v).map(|(mc, _)| mc)).collect();
            let mut uniq = Vec::new();
            for m in mcs {
                if !uniq.contains(&m) {
                    uniq.push(m);
                }
            }
            Ok(sort_mc_versions(state, uniq).await)
        }
        LoaderKind::Neoforge => {
            let mut uniq: Vec<String> = Vec::new();
            for v in neo_versions(state).await? {
                if let Some(mc) = neoforge_mc(&v) {
                    if !uniq.contains(&mc) {
                        uniq.push(mc);
                    }
                }
            }
            uniq.push("1.20.1".into());
            Ok(sort_mc_versions(state, uniq).await)
        }
    }
}

fn stable_first(mut v: Vec<LoaderVersion>) -> Vec<LoaderVersion> {
    // stabil zuerst, Reihenfolge innerhalb der Gruppen bleibt (stable sort)
    v.sort_by_key(|l| !l.stable);
    v
}

pub async fn loader_versions(state: &Core, kind: LoaderKind, mc: &str) -> AppResult<Vec<LoaderVersion>> {
    match kind {
        LoaderKind::Vanilla => Ok(vec![]),
        LoaderKind::Fabric | LoaderKind::Quilt => {
            let url = format!("{}/versions/loader/{}", meta_base(kind), urlencoding::encode(mc));
            let list: Vec<MetaLoaderEntry> = match fetch_json(state, &url).await {
                Ok(l) => l,
                Err(AppError::Msg(m)) if m.contains("HTTP 400") || m.contains("HTTP 404") => vec![],
                Err(e) => return Err(e),
            };
            let mut v: Vec<LoaderVersion> = list
                .into_iter()
                .map(|e| {
                    let stable = e.loader.stable.unwrap_or_else(|| !e.loader.version.contains('-'));
                    LoaderVersion { version: e.loader.version, stable }
                })
                .collect();
            v.sort_by(|a, b| cmp_version(&b.version, &a.version));
            Ok(stable_first(v))
        }
        LoaderKind::Forge => {
            let idx = forge_index(state).await?;
            let mut list: Vec<String> = idx
                .versions
                .iter()
                .filter_map(|v| split_forge_version(v).filter(|(m, _)| m == mc).map(|(_, f)| f))
                .collect();
            list.sort_by(|a, b| cmp_version(b, a));
            list.dedup();
            let rec = idx.promos.get(&format!("{mc}-recommended")).cloned();
            let latest = idx.promos.get(&format!("{mc}-latest")).cloned();
            let mut out = Vec::new();
            let star = rec.clone().or(latest.clone());
            for p in [rec.clone(), latest.clone()].into_iter().flatten() {
                if list.contains(&p) && !out.iter().any(|l: &LoaderVersion| l.version == p) {
                    out.push(LoaderVersion { stable: Some(&p) == star.as_ref(), version: p });
                }
            }
            for v in list {
                if !out.iter().any(|l| l.version == v) {
                    out.push(LoaderVersion { version: v, stable: false });
                }
            }
            Ok(out)
        }
        LoaderKind::Neoforge => {
            let mut list: Vec<String> = if mc == "1.20.1" {
                neo_forge_versions(state)
                    .await?
                    .into_iter()
                    .filter_map(|v| v.strip_prefix("1.20.1-").map(str::to_string))
                    .collect()
            } else {
                neo_versions(state).await?.into_iter().filter(|v| neoforge_mc(v).as_deref() == Some(mc)).collect()
            };
            list.sort_by(|a, b| cmp_version(b, a));
            list.dedup();
            Ok(stable_first(list.into_iter().map(|v| LoaderVersion { stable: !is_unstable(&v), version: v }).collect()))
        }
    }
}

/// Empfohlene Loader-Version, wenn die Instanz keine festlegt.
pub async fn default_loader_version(state: &Core, kind: LoaderKind, mc: &str) -> AppResult<String> {
    let list = loader_versions(state, kind, mc).await?;
    list.into_iter()
        .next()
        .map(|l| l.version)
        .ok_or_else(|| AppError::msg(format!("{} unterstützt Minecraft {mc} nicht.", loader_name(kind))))
}

pub fn loader_name(kind: LoaderKind) -> &'static str {
    match kind {
        LoaderKind::Vanilla => "Vanilla",
        LoaderKind::Fabric => "Fabric",
        LoaderKind::Quilt => "Quilt",
        LoaderKind::Forge => "Forge",
        LoaderKind::Neoforge => "NeoForge",
    }
}

/// Fabric-/Quilt-Profil installieren. Gibt die Versions-ID zurück.
pub async fn install_fabric_like(state: &Core, kind: LoaderKind, mc: &str, version: &str, force: bool) -> AppResult<String> {
    let prefix = if kind == LoaderKind::Quilt { "quilt-loader" } else { "fabric-loader" };
    let id = format!("{prefix}-{version}-{mc}");
    let path = state.paths.version_json(&id);
    if !force && path.exists() && super::meta::read_version_file(&path).is_ok() {
        return Ok(id);
    }
    let url = format!("{}/versions/loader/{}/{}/profile/json", meta_base(kind), urlencoding::encode(mc), urlencoding::encode(version));
    let bytes = state.net.get_bytes(&url).await.map_err(|e| {
        AppError::msg(format!("{} {version} für Minecraft {mc} konnte nicht geladen werden: {e}", loader_name(kind)))
    })?;
    let mut v: serde_json::Value = serde_json::from_slice(&bytes)?;
    // ID vereinheitlichen (Ordnername = ID)
    v["id"] = serde_json::Value::String(id.clone());
    crate::util::write_json_atomic(&path, &v)?;
    super::meta::read_version_file(&path)?;
    Ok(id)
}

#[cfg(test)]
mod tests;
