//! Forge-/NeoForge-Installer selbst ausführen: install_profile.json + version.json lesen,
//! Libraries laden, Processors (Client-Seite) ausführen. Unterstützt auch Legacy-Installer (≤1.12.2).
use super::meta::{Library, VersionJson};
use crate::error::{AppError, AppResult, Ctx};
use crate::net::DownloadItem;
use crate::paths::maven_path;
use crate::Core;
use crate::tasks::SubProgress;
use serde::Deserialize;
use std::collections::HashMap;
use std::io::Read;
use std::path::{Path, PathBuf};

mod processors;
pub use processors::*;

#[derive(Debug, Deserialize, Default)]
#[serde(default)]
struct InstallProfile {
    // modern
    spec: Option<i64>,
    version: Option<String>,
    json: Option<String>,
    path: Option<String>,
    minecraft: Option<String>,
    data: HashMap<String, SidedValue>,
    processors: Vec<Processor>,
    libraries: Vec<Library>,
    // legacy
    install: Option<LegacyInstall>,
    #[serde(rename = "versionInfo")]
    version_info: Option<serde_json::Value>,
}

#[derive(Debug, Deserialize, Default)]
#[serde(default)]
struct SidedValue {
    client: Option<String>,
}

#[derive(Debug, Deserialize, Default, Clone)]
#[serde(default)]
struct Processor {
    sides: Option<Vec<String>>,
    jar: String,
    classpath: Vec<String>,
    args: Vec<String>,
    outputs: HashMap<String, String>,
}

#[derive(Debug, Deserialize, Default)]
#[serde(default)]
struct LegacyInstall {
    path: Option<String>,
    #[serde(rename = "filePath")]
    file_path: Option<String>,
}

pub struct ForgeSpec<'a> {
    pub neoforge: bool,
    pub mc: &'a str,
    /// Loader-Version wie in der Instanz ("47.3.0", "21.1.77")
    pub version: &'a str,
}

fn installer_url(spec: &ForgeSpec<'_>, full: &str) -> (String, String) {
    if spec.neoforge {
        if spec.mc == "1.20.1" {
            let coord = format!("net.neoforged:forge:{full}:installer");
            (format!("{}net/neoforged/forge/{full}/forge-{full}-installer.jar", super::loaders::NEO_MAVEN), coord)
        } else {
            let coord = format!("net.neoforged:neoforge:{full}:installer");
            (format!("{}net/neoforged/neoforge/{full}/neoforge-{full}-installer.jar", super::loaders::NEO_MAVEN), coord)
        }
    } else {
        let coord = format!("net.minecraftforge:forge:{full}:installer");
        (format!("{}net/minecraftforge/forge/{full}/forge-{full}-installer.jar", super::loaders::FORGE_MAVEN), coord)
    }
}

/// Maven-Version des Installers bestimmen.
async fn full_version(state: &Core, spec: &ForgeSpec<'_>) -> String {
    if spec.neoforge {
        if spec.mc == "1.20.1" {
            let v = spec.version.strip_prefix("1.20.1-").unwrap_or(spec.version);
            return format!("1.20.1-{v}");
        }
        return spec.version.to_string();
    }
    let idx = super::loaders::forge_index(state).await.ok();
    super::loaders::forge_full_version(idx.as_ref(), spec.mc, spec.version)
}

/// Erwartete Versions-ID (ohne Installer zu öffnen) – für den schnellen Pfad.
fn marker_path(paths: &crate::paths::Paths, spec: &ForgeSpec<'_>) -> PathBuf {
    let name = if spec.neoforge { "neoforge" } else { "forge" };
    paths.meta().join("loader-installs").join(format!("{name}-{}-{}.json", spec.mc, spec.version))
}

pub fn installed_locally(paths: &crate::paths::Paths, spec: &ForgeSpec<'_>) -> Option<String> {
    let b = std::fs::read(marker_path(paths, spec)).ok()?;
    let m = serde_json::from_slice::<serde_json::Value>(&b).ok()?;
    let id = m["id"].as_str()?.to_string();
    let outputs_ok = m["files"].as_array().map(|a| a.iter().filter_map(|v| v.as_str()).all(|p| Path::new(p).is_file())).unwrap_or(true);
    (paths.version_json(&id).is_file() && outputs_ok).then_some(id)
}

fn read_zip_entry(z: &mut zip::ZipArchive<std::fs::File>, name: &str) -> AppResult<Vec<u8>> {
    let name = name.trim_start_matches('/');
    let mut e = z.by_name(name).map_err(|_| AppError::msg(format!("Installer unvollständig: {name} fehlt")))?;
    let mut buf = Vec::new();
    e.read_to_end(&mut buf)?;
    Ok(buf)
}

/// Einträge unter `maven/` in den Libraries-Ordner entpacken (fehlende/geänderte Dateien).
fn extract_maven_dir(z: &mut zip::ZipArchive<std::fs::File>, libs: &Path, force: bool) -> AppResult<()> {
    for i in 0..z.len() {
        let mut e = z.by_index(i)?;
        if e.is_dir() {
            continue;
        }
        let name = e.name().to_string();
        let Some(rel) = name.strip_prefix("maven/") else { continue };
        let Some(out) = crate::util::safe_join(libs, rel) else { continue };
        if !force && out.metadata().map(|m| m.len() == e.size()).unwrap_or(false) {
            continue;
        }
        if let Some(p) = out.parent() {
            std::fs::create_dir_all(p)?;
        }
        let tmp = out.with_extension("vibe-tmp");
        let mut w = std::fs::File::create(&tmp)?;
        std::io::copy(&mut e, &mut w)?;
        drop(w);
        std::fs::rename(&tmp, &out)?;
    }
    Ok(())
}

fn lib_download_items(libs: &[Library], libs_dir: &Path, env: &super::meta::Env) -> (Vec<DownloadItem>, Vec<PathBuf>) {
    let mut items = Vec::new();
    let mut local = Vec::new();
    for l in libs {
        if !l.allowed(env) {
            continue;
        }
        if let Some(a) = l.artifact(libs_dir) {
            match a.download_item() {
                Some(d) => items.push(d),
                None => local.push(a.path),
            }
        }
    }
    (items, local)
}

/// Installer-JAR laden (Cache unter libraries/). Gibt (Pfad, volle Maven-Version) zurück.
pub async fn download_installer(state: &Core, spec: &ForgeSpec<'_>, force: bool, sp: &SubProgress) -> AppResult<(PathBuf, String)> {
    let name = if spec.neoforge { "NeoForge" } else { "Forge" };
    let full = full_version(state, spec).await;
    let (url, coord) = installer_url(spec, &full);
    let installer = state.paths.libraries().join(maven_path(&coord).ctx("Installer-Pfad")?);
    sp.message(format!("{name}-Installer wird geladen …"));
    if force {
        let _ = tokio::fs::remove_file(&installer).await;
    }
    state.net.download_all(vec![DownloadItem::new(&url, &installer)], None).await.map_err(|e| {
        AppError::msg(format!("{name} {} für Minecraft {} konnte nicht geladen werden: {e}", spec.version, spec.mc))
    })?;
    sp.check()?;
    Ok((installer, full))
}

/// Forge/NeoForge installieren. Gibt die Versions-ID des Profils zurück.
/// Voraussetzung: Vanilla-JSON + Client-JAR sind vorhanden, `java` ist eine passende Java-Installation.
pub async fn install(state: &Core, spec: ForgeSpec<'_>, java: &Path, force: bool, sp: &SubProgress) -> AppResult<String> {
    let marker = marker_path(&state.paths, &spec);
    if !force {
        if let Some(id) = installed_locally(&state.paths, &spec) {
            return Ok(id);
        }
    }
    let (installer, full) = download_installer(state, &spec, force, sp).await?;
    let libs_dir = state.paths.libraries();

    // Installer öffnen, Profil lesen, maven/ entpacken
    let inst2 = installer.clone();
    let libs2 = libs_dir.clone();
    let tmp_root = state.paths.tmp().join(format!("installer-{}", uuid::Uuid::new_v4()));
    let tmp2 = tmp_root.clone();
    let (profile, version_bytes) = tokio::task::spawn_blocking(move || -> AppResult<(InstallProfile, Vec<u8>)> {
        let f = std::fs::File::open(&inst2)?;
        let mut z = zip::ZipArchive::new(f).map_err(|e| AppError::msg(format!("Installer ist beschädigt: {e}")))?;
        let profile_bytes = read_zip_entry(&mut z, "install_profile.json")?;
        let profile: InstallProfile = serde_json::from_slice(&profile_bytes).ctx("install_profile.json ungültig")?;
        extract_maven_dir(&mut z, &libs2, force)?;
        let version_bytes = if let Some(vi) = &profile.version_info {
            // Legacy: Universal-JAR an seinen Maven-Pfad entpacken
            if let Some(inst) = &profile.install {
                if let (Some(path), Some(file)) = (&inst.path, &inst.file_path) {
                    if let Some(rel) = maven_path(path) {
                        let out = libs2.join(rel);
                        if force || !out.is_file() {
                            let data = read_zip_entry(&mut z, file)?;
                            if let Some(p) = out.parent() {
                                std::fs::create_dir_all(p)?;
                            }
                            std::fs::write(&out, data)?;
                        }
                    }
                }
            }
            serde_json::to_vec(vi)?
        } else {
            let json_name = profile.json.clone().unwrap_or_else(|| "/version.json".into());
            // Daten-Dateien (/data/client.lzma …) für Processors entpacken
            for v in profile.data.values() {
                if let Some(c) = &v.client {
                    if c.starts_with('/') {
                        let data = read_zip_entry(&mut z, c)?;
                        let out = crate::util::safe_join(&tmp2, c).ctx("Pfad im Installer")?;
                        if let Some(p) = out.parent() {
                            std::fs::create_dir_all(p)?;
                        }
                        std::fs::write(&out, data)?;
                    }
                }
            }
            read_zip_entry(&mut z, &json_name)?
        };
        Ok((profile, version_bytes))
    })
    .await??;

    let result = run_install(state, &spec, &profile, &version_bytes, &installer, &tmp_root, java, sp).await;
    let _ = tokio::fs::remove_dir_all(&tmp_root).await;
    let (id, files) = result?;
    crate::util::write_json_atomic(&marker, &serde_json::json!({ "id": id, "full": full, "files": files }))?;
    Ok(id)
}

#[cfg(test)]
mod tests;
