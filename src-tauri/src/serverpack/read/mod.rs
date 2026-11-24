use super::filter::{self, PathKind};
use super::{EntryOrigin, PackEntry, PackInput};
use crate::content::{import, modrinth as mr, sides as csides, PackFormat, Side};
use crate::error::{AppError, AppResult};
use crate::instance::Loader;
use crate::server::sides::ModSide;
use crate::state::AppState;
use serde::Deserialize;
use std::collections::{BTreeMap, HashMap};
use std::io::Read;
use std::path::{Path, PathBuf};

mod archive;

pub use archive::*;

#[derive(Debug, Clone)]
pub enum EntrySrc {
    Url { url: String, sha1: Option<String>, sha512: Option<String> },
    File(PathBuf),
    Zip(String),
}

#[derive(Debug, Clone)]
pub struct Entry {
    pub info: PackEntry,
    pub src: EntrySrc,
}

#[derive(Debug, Clone)]
pub enum Configs {
    None,
    Zip(Vec<String>),
    Dir(PathBuf),
}

#[derive(Debug, Clone)]
pub struct Plan {
    pub name: String,
    pub version_name: Option<String>,
    pub format: &'static str,
    pub mc_version: String,
    pub loader: Loader,
    pub entries: Vec<Entry>,
    pub configs: Configs,
    pub archive: Option<PathBuf>,
    pub missing: Vec<String>,
    pub warnings: Vec<String>,
    pub client_skipped: u32,
    pub instance: Option<String>,
}

impl Plan {
    pub fn selected(&self, sel: Option<&[String]>) -> Vec<&Entry> {
        self.entries.iter().filter(|e| sel.map(|s| s.iter().any(|p| p == &e.info.path)).unwrap_or(e.info.include)).collect()
    }
}

async fn fill_modrinth_sides(state: &AppState, entries: &mut [Entry]) {
    let ids: Vec<String> = entries
        .iter()
        .filter(|e| e.info.side == Side::Unknown)
        .filter_map(|e| match &e.src {
            EntrySrc::Url { url, .. } => import::modrinth_ids_from_url(url).map(|(p, _)| p),
            _ => None,
        })
        .collect();
    if ids.is_empty() {
        return;
    }
    let Ok(projects) = mr::raw_projects(state, &ids).await else { return };
    let sides: HashMap<String, Side> = projects.iter().map(|p| (p.id.clone(), csides::from_sides(p.client_side.as_deref(), p.server_side.as_deref()))).collect();
    for e in entries.iter_mut().filter(|e| e.info.side == Side::Unknown) {
        if let EntrySrc::Url { url, .. } = &e.src {
            if let Some(s) = import::modrinth_ids_from_url(url).and_then(|(p, _)| sides.get(&p).copied()) {
                e.info.side = s;
                e.info.include = e.info.enabled && s != Side::Client;
            }
        }
    }
}

async fn from_instance(state: &AppState, id: &str) -> AppResult<Plan> {
    let inst = state.instances.get(id)?;
    crate::custom_loader::block(&inst, "Ein Server-Pack")?;
    let game = state.paths.game_dir(id);
    let mods_dir = game.join("mods");
    let md = mods_dir.clone();
    let cands = tokio::task::spawn_blocking(move || crate::server::sides::candidates(&md)).await?;
    let infos = csides::classify(state, id).await.unwrap_or_default();
    let mut entries = Vec::new();
    for m in cands {
        let refined = infos.iter().find(|i| i.kind == crate::content::ContentKind::Mod && i.file_name == m.file_name).map(|i| i.side).filter(|s| *s != Side::Unknown);
        let side = refined.unwrap_or(mod_side(m.side));
        let target = m.file_name.strip_suffix(".disabled").unwrap_or(&m.file_name).to_string();
        let full = mods_dir.join(&m.file_name);
        let size = std::fs::metadata(&full).ok().map(|x| x.len());
        entries.push(entry(format!("mods/{target}"), m.name.clone(), side, m.enabled, EntryOrigin::Local, size, EntrySrc::File(full)));
    }
    let skipped = infos.iter().filter(|i| i.kind != crate::content::ContentKind::Mod && i.side == Side::Client).count() as u32;
    Ok(Plan {
        name: inst.name.clone(),
        version_name: None,
        format: "instance",
        mc_version: inst.mc_version.clone(),
        loader: inst.loader.clone(),
        entries,
        configs: Configs::Dir(game),
        archive: None,
        missing: vec![],
        warnings: vec![],
        client_skipped: skipped,
        instance: Some(id.to_string()),
    })
}

async fn from_file(state: &AppState, path: &Path) -> AppResult<Plan> {
    let p = path.to_path_buf();
    let pack = tokio::task::spawn_blocking(move || import::analyze(&p)).await??;
    let mut entries = Vec::new();
    let mut missing = Vec::new();
    let mut warnings = Vec::new();
    let mut skipped = 0u32;
    let prefixes: Vec<String> = match pack.format {
        PackFormat::Mrpack => {
            let zp = path.to_path_buf();
            let idx = tokio::task::spawn_blocking(move || read_zip_bytes(&zp, "modrinth.index.json")).await?.ok_or_else(|| AppError::Invalid("modrinth.index.json fehlt".into()))?;
            let (list, sk) = mrpack_server_files(&idx)?;
            entries.extend(list);
            skipped += sk;
            vec!["overrides/".into(), "server-overrides/".into()]
        }
        PackFormat::Curseforge => {
            let r = import::resolve_cf(state, &pack.cf_files).await?;
            for f in r.files {
                if filter::is_client_content(&f.path) {
                    skipped += 1;
                    continue;
                }
                if filter::classify(&f.path) == PathKind::Skip {
                    continue;
                }
                let side = f.side.unwrap_or(Side::Unknown);
                entries.push(entry(f.path, None, side, true, EntryOrigin::Download, f.size, EntrySrc::Url { url: f.url, sha1: f.sha1, sha512: None }));
            }
            missing.extend(r.missing.into_iter().map(|m| m.info.file_name));
            pack.overrides.clone()
        }
        PackFormat::Vlpack => {
            for f in pack.files {
                if filter::is_client_content(&f.path) {
                    skipped += 1;
                    continue;
                }
                if filter::classify(&f.path) == PathKind::Skip {
                    continue;
                }
                let side = f.side.unwrap_or(Side::Unknown);
                entries.push(entry(f.path, None, side, true, EntryOrigin::Download, f.size, EntrySrc::Url { url: f.url, sha1: f.sha1, sha512: None }));
            }
            pack.overrides.clone()
        }
        PackFormat::Prism | PackFormat::Multimc => pack.overrides.clone(),
    };
    let zp = path.to_path_buf();
    let pf = prefixes.clone();
    let tmp = state.paths.tmp().join(format!("serverpack-{}", uuid::Uuid::new_v4()));
    let (jars, sides, sk) = tokio::task::spawn_blocking(move || -> AppResult<_> {
        let (jars, _, _, sk) = archive_scan(&zp, &pf)?;
        let sides = classify_archive_jars(&zp, &jars, &tmp);
        let _ = std::fs::remove_dir_all(&tmp);
        Ok((jars, sides, sk))
    })
    .await??;
    skipped += sk;
    for ((rel, name, size), (side, display)) in jars.into_iter().zip(sides) {
        let enabled = !rel.ends_with(".disabled");
        let target = rel.strip_suffix(".disabled").unwrap_or(&rel).to_string();
        entries.retain(|e| e.info.path != target);
        entries.push(entry(target, display, side, enabled, EntryOrigin::Archive, Some(size), EntrySrc::Zip(name)));
    }
    fill_modrinth_sides(state, &mut entries).await;
    if pack.loader.kind == crate::instance::LoaderKind::Vanilla && entries.iter().any(|e| e.info.path.starts_with("mods/")) {
        warnings.push("vanilla_with_mods".into());
    }
    Ok(Plan {
        name: pack.name,
        version_name: pack.version_name,
        format: format_name(pack.format),
        mc_version: pack.mc_version,
        loader: pack.loader,
        entries,
        configs: Configs::Zip(prefixes),
        archive: Some(path.to_path_buf()),
        missing,
        warnings,
        client_skipped: skipped,
        instance: None,
    })
}

pub async fn read(state: &AppState, input: &PackInput) -> AppResult<Plan> {
    let mut plan = match input {
        PackInput::Instance { id } => from_instance(state, id).await?,
        PackInput::File { path } => from_file(state, Path::new(path)).await?,
    };
    plan.entries.sort_by(|a, b| a.info.name.to_lowercase().cmp(&b.info.name.to_lowercase()));
    Ok(plan)
}

#[cfg(test)]
mod tests;
