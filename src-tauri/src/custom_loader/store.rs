use super::issue::PackIssue;
use super::manifest::Manifest;
use super::validate::{is_id, is_loader_version, parse};
use super::{pack, pack_dir, root, MANIFEST};
use crate::error::{AppError, AppResult};
use crate::instance::LoaderKind;
use crate::paths::Paths;
use serde::Serialize;
use std::path::Path;

#[derive(Debug, Clone, Serialize)]
pub struct InstalledPack {
    pub id: String,
    pub name: String,
    pub loader_version: String,
    pub description: Option<String>,
    pub author: Option<String>,
    pub homepage: Option<String>,
    pub minecraft: Vec<String>,
    pub mods: LoaderKind,
    pub main_class: String,
    pub icon_path: Option<String>,
    pub library_count: usize,
    pub size_bytes: u64,
    pub instances: usize,
}

fn dir_size(dir: &Path) -> u64 {
    walkdir::WalkDir::new(dir).into_iter().flatten().filter_map(|e| e.metadata().ok()).filter(|m| m.is_file()).map(|m| m.len()).sum()
}

fn installed(paths: &Paths, m: &Manifest) -> InstalledPack {
    let dir = pack_dir(paths, &m.id, &m.loader_version);
    let icon = dir.join("icon.png");
    InstalledPack {
        id: m.id.clone(),
        name: m.name.clone(),
        loader_version: m.loader_version.clone(),
        description: m.description.clone(),
        author: m.author.clone(),
        homepage: m.homepage.clone(),
        minecraft: m.minecraft.clone(),
        mods: m.mods,
        main_class: m.profile.main_class.clone(),
        icon_path: (m.icon.is_some() && icon.is_file()).then(|| icon.to_string_lossy().to_string()),
        library_count: m.profile.libraries.len(),
        size_bytes: dir_size(&dir),
        instances: 0,
    }
}

fn check_ref(id: &str, version: &str) -> AppResult<()> {
    if is_id(id) && is_loader_version(version) {
        Ok(())
    } else {
        Err(AppError::Invalid(format!("Ungültiger Loader „{id}“ {version}")))
    }
}

pub(super) fn versions(paths: &Paths, id: &str) -> Vec<String> {
    if !is_id(id) {
        return Vec::new();
    }
    let mut out: Vec<String> = std::fs::read_dir(root(paths).join(id))
        .into_iter()
        .flatten()
        .flatten()
        .filter(|e| e.path().join(MANIFEST).is_file())
        .map(|e| e.file_name().to_string_lossy().to_string())
        .filter(|v| is_loader_version(v))
        .collect();
    out.sort();
    out
}

pub fn load(paths: &Paths, id: &str, version: &str) -> AppResult<Manifest> {
    check_ref(id, version)?;
    let file = pack_dir(paths, id, version).join(MANIFEST);
    let bytes = std::fs::read(&file).map_err(|_| AppError::NotFound(format!("Das Loader-Pack „{id}“ {version} ist nicht installiert. Importiere es erneut.")))?;
    let m = parse(&bytes)?;
    if m.id != id || m.loader_version != version {
        return Err(AppError::msg(format!("Das Loader-Pack „{id}“ {version} ist beschädigt. Importiere es erneut.")));
    }
    Ok(m)
}

pub fn list(paths: &Paths) -> Vec<InstalledPack> {
    let mut out = Vec::new();
    for e in std::fs::read_dir(root(paths)).into_iter().flatten().flatten() {
        let id = e.file_name().to_string_lossy().to_string();
        for v in versions(paths, &id) {
            match load(paths, &id, &v) {
                Ok(m) => out.push(installed(paths, &m)),
                Err(err) => tracing::warn!("Loader-Pack {id} {v} unlesbar: {err}"),
            }
        }
    }
    out.sort_by(|a, b| a.id.cmp(&b.id).then_with(|| crate::minecraft::loaders::cmp_version(&a.loader_version, &b.loader_version)));
    out
}

pub fn import(paths: &Paths, src: &Path, replace: bool) -> AppResult<InstalledPack> {
    let opened = pack::open(src)?;
    let (id, version) = (opened.manifest.id.clone(), opened.manifest.loader_version.clone());
    let target = pack_dir(paths, &id, &version);
    if target.exists() && !replace {
        return Err(PackIssue::new("exists", format!("„{}“ {version} ist schon installiert.", opened.manifest.name)).into());
    }
    let base = root(paths);
    std::fs::create_dir_all(&base)?;
    let tmp = base.join(format!(".tmp-{}", uuid::Uuid::new_v4().simple()));
    std::fs::create_dir_all(&tmp)?;
    let manifest = match opened.extract(&tmp) {
        Ok(m) => m,
        Err(e) => {
            let _ = std::fs::remove_dir_all(&tmp);
            return Err(e.into());
        }
    };
    let old = base.join(format!(".old-{}", uuid::Uuid::new_v4().simple()));
    if target.exists() {
        std::fs::rename(&target, &old)?;
    }
    if let Some(p) = target.parent() {
        std::fs::create_dir_all(p)?;
    }
    if let Err(e) = std::fs::rename(&tmp, &target) {
        if old.exists() {
            let _ = std::fs::rename(&old, &target);
        }
        let _ = std::fs::remove_dir_all(&tmp);
        return Err(e.into());
    }
    let _ = std::fs::remove_dir_all(&old);
    tracing::info!("Loader-Pack {id} {version} importiert");
    Ok(installed(paths, &manifest))
}

pub fn delete(paths: &Paths, id: &str, version: &str) -> AppResult<()> {
    check_ref(id, version)?;
    let dir = pack_dir(paths, id, version);
    if !dir.exists() {
        return Err(AppError::NotFound(format!("Loader-Pack „{id}“ {version}")));
    }
    std::fs::remove_dir_all(&dir)?;
    let parent = root(paths).join(id);
    if std::fs::read_dir(&parent).map(|mut d| d.next().is_none()).unwrap_or(false) {
        let _ = std::fs::remove_dir(&parent);
    }
    Ok(())
}
