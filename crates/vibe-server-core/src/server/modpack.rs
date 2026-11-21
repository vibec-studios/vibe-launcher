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

fn extract(archive: &Path, info: &PackInfo, dest: &Path) -> AppResult<usize> {
    let f = std::fs::File::open(archive)?;
    let mut zip = zip::ZipArchive::new(f)?;
    let mut n = 0;
    for i in 0..zip.len() {
        let mut e = zip.by_index(i)?;
        if e.is_dir() {
            continue;
        }
        let mut name = e.name().replace('\\', "/");
        if let Some(p) = &info.strip_prefix {
            match name.strip_prefix(&format!("{p}/")) {
                Some(r) => name = r.to_string(),
                None => continue,
            }
        }
        let rel = info.override_dirs.iter().find_map(|d| if d.is_empty() { Some(name.clone()) } else { name.strip_prefix(&format!("{d}/")).map(str::to_string) });
        let Some(rel) = rel.filter(|r| !r.is_empty()) else { continue };
        if is_client_only(&rel) || rel == "vibe-server.json" || rel == "modrinth.index.json" || rel == "vlpack.json" {
            continue;
        }
        let Some(out) = crate::util::safe_join(dest, &rel) else { continue };
        if let Some(p) = out.parent() {
            std::fs::create_dir_all(p)?;
        }
        let mut w = std::fs::File::create(&out)?;
        std::io::copy(&mut e, &mut w)?;
        n += 1;
    }
    Ok(n)
}

fn drop_client_mods(dir: &Path) -> Vec<String> {
    let mods = dir.join("mods");
    let mut removed = Vec::new();
    for c in sides::candidates(&mods) {
        if c.side == ModSide::Client {
            if std::fs::remove_file(mods.join(&c.file_name)).is_ok() {
                removed.push(c.file_name);
            }
        }
    }
    removed
}

fn clear_mods(dir: &Path) {
    let mods = dir.join("mods");
    if let Ok(rd) = std::fs::read_dir(&mods) {
        for e in rd.flatten() {
            let n = e.file_name().to_string_lossy().to_lowercase();
            if e.path().is_file() && (n.ends_with(".jar") || n.ends_with(".jar.disabled")) {
                let _ = std::fs::remove_file(e.path());
            }
        }
    }
}

async fn apply(core: &Core, archive: PathBuf, info: PackInfo, id: String, update: bool, sp: &SubProgress) -> AppResult<()> {
    let dir = server_dir(&core.paths, &id);
    std::fs::create_dir_all(&dir)?;
    if update {
        clear_mods(&dir);
    }
    sp.message("Dateien des Modpacks werden geladen …");
    let mut items = Vec::new();
    for f in info.files.iter().filter(|f| !is_client_only(&f.path)) {
        let Some(out) = crate::util::safe_join(&dir, &f.path) else {
            return Err(AppError::Invalid(format!("Ungültiger Pfad im Modpack: {}", f.path)));
        };
        items.push(DownloadItem::new(&f.url, out).sha1(f.sha1.clone()).size(f.size));
    }
    core.net.download_all(items, Some(&sp.sub(0.0, 0.5))).await?;
    sp.message("Configs werden übernommen …");
    let (a2, i2, d2) = (archive.clone(), info.clone(), dir.clone());
    tokio::task::spawn_blocking(move || extract(&a2, &i2, &d2)).await??;
    let d3 = dir.clone();
    let removed = tokio::task::spawn_blocking(move || drop_client_mods(&d3)).await?;
    if !removed.is_empty() {
        tracing::info!("Modpack: {} Client-Mods ausgelassen: {}", removed.len(), removed.join(", "));
    }
    let _ = std::fs::remove_file(&archive);
    super::install::install(core, &id, false, &sp.sub(0.5, 1.0)).await
}

pub fn spawn_import(core: &Core, archive: PathBuf, format: PackFormat, opts: ImportOptions) -> AppResult<(Server, String)> {
    let info = inspect(&archive, format)?;
    let (server, update) = match &opts.server {
        Some(id) => {
            let s = core.servers.get(id)?;
            if core.server_mgr.is_active(id) {
                return Err(AppError::Invalid("Bitte den Server zuerst stoppen.".into()));
            }
            if let (Some(mc), Some(l)) = (&info.mc_version, &info.loader) {
                if *mc != s.mc_version || l.kind != s.loader.kind {
                    let s2 = core.servers.modify(id, |x| {
                        x.mc_version = mc.clone();
                        x.loader = l.clone();
                        x.platform = None;
                        x.launch = None;
                        x.install_state = crate::model::InstallState::NotInstalled;
                    })?;
                    (s2, true)
                } else {
                    (s, true)
                }
            } else {
                (s, true)
            }
        }
        None => {
            let mc = info.mc_version.clone().or(opts.mc_version.clone()).ok_or_else(|| AppError::Invalid("Minecraft-Version fehlt (mc_version).".into()))?;
            let loader = info.loader.clone().or(opts.loader.clone()).unwrap_or(Loader { kind: LoaderKind::Vanilla, version: None });
            let name = opts.name.clone().filter(|n| !n.trim().is_empty()).or(info.name.clone()).unwrap_or_else(|| "Modpack-Server".into());
            let req = ServerCreate { name, mc_version: mc, loader, platform: None, from_instance: None, mods: None, copy_configs: None, world: None, port: None, memory_mb: opts.memory_mb };
            (core.servers.create(&req)?, false)
        }
    };
    let st = core.clone();
    let id = server.id.clone();
    let title = format!("Modpack wird auf „{}“ übertragen", server.name);
    let task_id = core.tasks.spawn("server", title, super::ops::task_ref(&id), move |task| async move { apply(&st, archive, info, id, update, &task.sub(0.0, 1.0)).await });
    Ok((server, task_id))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn zip_with(path: &Path, files: &[(&str, &[u8])]) {
        let f = std::fs::File::create(path).unwrap();
        let mut z = zip::ZipWriter::new(f);
        for (n, b) in files {
            z.start_file(*n, zip::write::SimpleFileOptions::default()).unwrap();
            z.write_all(b).unwrap();
        }
        z.finish().unwrap();
    }

    fn tmp() -> PathBuf {
        let d = std::env::temp_dir().join(format!("vsc-modpack-{}", uuid::Uuid::new_v4().simple()));
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn mrpack_server_files_only() {
        let d = tmp();
        let p = d.join("x.mrpack");
        let idx = br#"{"formatVersion":1,"game":"minecraft","name":"Pack","dependencies":{"minecraft":"1.21.1","fabric-loader":"0.16.9"},
            "files":[{"path":"mods/a.jar","hashes":{"sha1":"aa"},"env":{"client":"required","server":"required"},"downloads":["https://x/a.jar"],"fileSize":3},
                     {"path":"mods/shader.jar","hashes":{"sha1":"bb"},"env":{"client":"required","server":"unsupported"},"downloads":["https://x/b.jar"]}]}"#;
        zip_with(&p, &[("modrinth.index.json", idx), ("overrides/config/a.toml", b"x=1"), ("overrides/options.txt", b"o"), ("client-overrides/config/c.toml", b"c"), ("server-overrides/server.properties", b"motd=hi")]);
        let info = inspect(&p, PackFormat::Mrpack).unwrap();
        assert_eq!(info.mc_version.as_deref(), Some("1.21.1"));
        assert_eq!(info.loader.as_ref().unwrap().kind, LoaderKind::Fabric);
        assert_eq!(info.files.len(), 1);
        let out = d.join("srv");
        std::fs::create_dir_all(&out).unwrap();
        extract(&p, &info, &out).unwrap();
        assert!(out.join("config/a.toml").exists());
        assert!(out.join("server.properties").exists());
        assert!(!out.join("options.txt").exists());
        assert!(!out.join("config/c.toml").exists());
        let _ = std::fs::remove_dir_all(d);
    }

    #[test]
    fn zip_strips_top_folder() {
        let d = tmp();
        let p = d.join("x.zip");
        zip_with(&p, &[("MyServer/mods/a.jar", b"j"), ("MyServer/config/b.json", b"{}"), ("MyServer/../evil", b"e")]);
        let info = inspect(&p, PackFormat::Zip).unwrap();
        assert_eq!(info.strip_prefix.as_deref(), Some("MyServer"));
        let out = d.join("srv");
        std::fs::create_dir_all(&out).unwrap();
        extract(&p, &info, &out).unwrap();
        assert!(out.join("mods/a.jar").exists() && out.join("config/b.json").exists());
        assert!(!d.join("evil").exists());
        let _ = std::fs::remove_dir_all(d);
    }
}
