//! Modpack als Server übernehmen (`.mrpack`, `.vlpack`, Ordner-ZIP): nur Server-seitige Dateien, Configs übernehmen.
use super::sides::{self, ModSide};
use super::{server_dir, Server, ServerCreate};
use crate::error::{AppError, AppResult};
use crate::model::{Loader, LoaderKind};
use crate::net::DownloadItem;
use crate::tasks::SubProgress;
use crate::Core;
use serde::Deserialize;
use std::io::Read;
use std::path::{Path, PathBuf};

mod import;
pub use import::*;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PackFormat {
    Mrpack,
    Zip,
    Vlpack,
}

#[derive(Debug, Clone, Default)]
pub struct ImportOptions {
    pub name: Option<String>,
    pub mc_version: Option<String>,
    pub loader: Option<Loader>,
    pub memory_mb: Option<u32>,
    pub server: Option<String>,
}

#[derive(Debug, Clone)]
pub struct PackFile {
    pub path: String,
    pub url: String,
    pub sha1: Option<String>,
    pub size: Option<u64>,
}

#[derive(Debug, Clone)]
pub struct PackInfo {
    pub name: Option<String>,
    pub mc_version: Option<String>,
    pub loader: Option<Loader>,
    pub files: Vec<PackFile>,
    pub override_dirs: Vec<String>,
    pub strip_prefix: Option<String>,
}

const CLIENT_ONLY: &[&str] = &["resourcepacks", "shaderpacks", "screenshots", "options.txt", "optionsof.txt", "servers.dat", "saves", "logs", "crash-reports"];

#[derive(Deserialize)]
struct MrIndex {
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    dependencies: std::collections::HashMap<String, String>,
    #[serde(default)]
    files: Vec<MrFile>,
}

#[derive(Deserialize)]
struct MrFile {
    path: String,
    #[serde(default)]
    hashes: std::collections::HashMap<String, String>,
    #[serde(default)]
    env: Option<std::collections::HashMap<String, String>>,
    #[serde(default)]
    downloads: Vec<String>,
    #[serde(default, rename = "fileSize")]
    file_size: Option<u64>,
}

#[derive(Deserialize)]
struct VlPack {
    format_version: u32,
    name: String,
    mc_version: String,
    loader: Loader,
    #[serde(default)]
    files: Vec<VlFile>,
}

#[derive(Deserialize)]
struct VlFile {
    path: String,
    url: String,
    #[serde(default)]
    sha1: Option<String>,
    #[serde(default)]
    size: Option<u64>,
}

fn read_entry(zip: &mut zip::ZipArchive<std::fs::File>, name: &str) -> Option<Vec<u8>> {
    let mut f = zip.by_name(name).ok()?;
    let mut b = Vec::new();
    f.read_to_end(&mut b).ok()?;
    Some(b)
}

pub fn mrpack_loader(deps: &std::collections::HashMap<String, String>) -> Loader {
    for (k, kind) in [("fabric-loader", LoaderKind::Fabric), ("quilt-loader", LoaderKind::Quilt), ("neoforge", LoaderKind::Neoforge), ("forge", LoaderKind::Forge)] {
        if let Some(v) = deps.get(k) {
            return Loader { kind, version: Some(v.clone()) };
        }
    }
    Loader { kind: LoaderKind::Vanilla, version: None }
}

fn is_client_only(rel: &str) -> bool {
    let first = rel.split('/').next().unwrap_or_default();
    CLIENT_ONLY.iter().any(|c| c.eq_ignore_ascii_case(first))
}

fn single_top_dir(zip: &mut zip::ZipArchive<std::fs::File>) -> Option<String> {
    let mut top: Option<String> = None;
    for i in 0..zip.len() {
        let name = zip.by_index(i).ok()?.name().replace('\\', "/");
        let first = name.split('/').next().unwrap_or_default().to_string();
        if !name.contains('/') {
            return None;
        }
        match &top {
            None => top = Some(first),
            Some(t) if *t == first => {}
            _ => return None,
        }
    }
    top.filter(|t| !["mods", "config", "plugins", "world", "defaultconfigs", "kubejs"].contains(&t.as_str()))
}

pub fn inspect(archive: &Path, format: PackFormat) -> AppResult<PackInfo> {
    let f = std::fs::File::open(archive)?;
    let mut zip = zip::ZipArchive::new(f)?;
    match format {
        PackFormat::Mrpack => {
            let b = read_entry(&mut zip, "modrinth.index.json").ok_or_else(|| AppError::Invalid("modrinth.index.json fehlt – kein .mrpack".into()))?;
            let idx: MrIndex = serde_json::from_slice(&b)?;
            let files = idx
                .files
                .into_iter()
                .filter(|f| f.env.as_ref().and_then(|e| e.get("server")).map(|s| s != "unsupported").unwrap_or(true))
                .filter_map(|f| {
                    let url = f.downloads.into_iter().next()?;
                    Some(PackFile { path: f.path, url, sha1: f.hashes.get("sha1").cloned(), size: f.file_size })
                })
                .collect();
            Ok(PackInfo {
                name: idx.name,
                mc_version: idx.dependencies.get("minecraft").cloned(),
                loader: Some(mrpack_loader(&idx.dependencies)),
                files,
                override_dirs: vec!["overrides".into(), "server-overrides".into()],
                strip_prefix: None,
            })
        }
        PackFormat::Vlpack => {
            let b = read_entry(&mut zip, "vlpack.json").ok_or_else(|| AppError::Invalid("vlpack.json fehlt – kein .vlpack".into()))?;
            let p: VlPack = serde_json::from_slice(&b)?;
            if p.format_version > 1 {
                return Err(AppError::Invalid(format!("vlpack-Format {} wird nicht unterstützt – bitte Agent aktualisieren", p.format_version)));
            }
            let files = p.files.into_iter().map(|f| PackFile { path: f.path, url: f.url, sha1: f.sha1, size: f.size }).collect();
            Ok(PackInfo { name: Some(p.name), mc_version: Some(p.mc_version), loader: Some(p.loader), files, override_dirs: vec!["overrides".into()], strip_prefix: None })
        }
        PackFormat::Zip => {
            let meta: Option<serde_json::Value> = read_entry(&mut zip, "vibe-server.json").and_then(|b| serde_json::from_slice(&b).ok());
            let mc = meta.as_ref().and_then(|m| m["mc_version"].as_str()).map(str::to_string);
            let loader = meta.as_ref().and_then(|m| serde_json::from_value::<Loader>(m["loader"].clone()).ok());
            let name = meta.as_ref().and_then(|m| m["name"].as_str()).map(str::to_string);
            let strip = single_top_dir(&mut zip);
            Ok(PackInfo { name, mc_version: mc, loader, files: vec![], override_dirs: vec![String::new()], strip_prefix: strip })
        }
    }
}

#[cfg(test)]
mod tests;
