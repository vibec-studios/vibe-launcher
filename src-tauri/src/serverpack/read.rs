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

#[derive(Deserialize)]
struct MrIndex {
    #[serde(default)]
    files: Vec<MrIndexFile>,
}

#[derive(Deserialize)]
struct MrIndexFile {
    path: String,
    #[serde(default)]
    hashes: HashMap<String, String>,
    #[serde(default)]
    env: Option<HashMap<String, String>>,
    #[serde(default)]
    downloads: Vec<String>,
    #[serde(rename = "fileSize", default)]
    file_size: Option<u64>,
}

fn file_name(rel: &str) -> String {
    rel.rsplit('/').next().unwrap_or(rel).to_string()
}

fn display_name(rel: &str) -> String {
    let f = file_name(rel);
    f.strip_suffix(".disabled").unwrap_or(&f).trim_end_matches(".jar").to_string()
}

fn entry(path: String, name: Option<String>, side: Side, enabled: bool, origin: EntryOrigin, size: Option<u64>, src: EntrySrc) -> Entry {
    let include = enabled && side != Side::Client;
    let name = name.filter(|n| !n.trim().is_empty()).unwrap_or_else(|| display_name(&path));
    Entry { info: PackEntry { path, name, side, enabled, include, origin, size }, src }
}

pub fn mrpack_server_files(index: &[u8]) -> AppResult<(Vec<Entry>, u32)> {
    let idx: MrIndex = serde_json::from_slice(index).map_err(|e| AppError::Invalid(format!("modrinth.index.json unlesbar: {e}")))?;
    let mut out = Vec::new();
    let mut skipped = 0u32;
    for f in idx.files {
        let env = f.env.as_ref();
        let server = env.and_then(|e| e.get("server")).map(String::as_str);
        if server == Some("unsupported") || filter::is_client_content(&f.path) {
            skipped += 1;
            continue;
        }
        if filter::classify(&f.path) == PathKind::Skip {
            continue;
        }
        let Some(url) = f.downloads.iter().find(|u| u.starts_with("https://") || u.starts_with("http://")).cloned() else { continue };
        let side = env.map(|e| csides::from_sides(e.get("client").map(String::as_str), server)).unwrap_or(Side::Unknown);
        let src = EntrySrc::Url { url, sha1: f.hashes.get("sha1").cloned(), sha512: f.hashes.get("sha512").cloned() };
        out.push(entry(f.path, None, side, true, EntryOrigin::Download, f.file_size, src));
    }
    Ok((out, skipped))
}

pub fn archive_scan(zip_path: &Path, prefixes: &[String]) -> AppResult<(Vec<(String, String, u64)>, u32, Vec<String>, u32)> {
    let f = std::fs::File::open(zip_path)?;
    let mut zip = zip::ZipArchive::new(std::io::BufReader::new(f))?;
    let mut mods: BTreeMap<String, (String, u64)> = BTreeMap::new();
    let mut configs: BTreeMap<String, ()> = BTreeMap::new();
    let mut skipped = 0u32;
    for prefix in prefixes {
        for i in 0..zip.len() {
            let e = zip.by_index(i)?;
            if e.is_dir() {
                continue;
            }
            let name = e.name().replace('\\', "/");
            let Some(rel) = name.strip_prefix(prefix.as_str()) else { continue };
            if rel.is_empty() || crate::util::safe_join(Path::new("base"), rel).is_none() {
                continue;
            }
            match filter::classify(rel) {
                PathKind::Mod => {
                    mods.insert(rel.to_string(), (name.clone(), e.size()));
                }
                PathKind::Config => {
                    configs.insert(rel.to_string(), ());
                }
                PathKind::Skip => {
                    if filter::is_client_content(rel) {
                        skipped += 1;
                    }
                }
            }
        }
    }
    let mut dirs: Vec<String> = configs.keys().map(|k| k.split('/').next().unwrap_or(k).to_string()).collect();
    dirs.dedup();
    let list = mods.into_iter().map(|(rel, (name, size))| (rel, name, size)).collect();
    Ok((list, configs.len() as u32, dirs, skipped))
}

fn mod_side(s: ModSide) -> Side {
    match s {
        ModSide::Both => Side::Both,
        ModSide::Client => Side::Client,
        ModSide::Server => Side::Server,
        ModSide::Unknown => Side::Unknown,
    }
}

fn classify_archive_jars(zip_path: &Path, jars: &[(String, String, u64)], tmp: &Path) -> Vec<(Side, Option<String>)> {
    let Ok(f) = std::fs::File::open(zip_path) else { return jars.iter().map(|_| (Side::Unknown, None)).collect() };
    let Ok(mut zip) = zip::ZipArchive::new(std::io::BufReader::new(f)) else { return jars.iter().map(|_| (Side::Unknown, None)).collect() };
    let _ = std::fs::create_dir_all(tmp);
    jars.iter()
        .enumerate()
        .map(|(i, (_, name, _))| {
            let p = tmp.join(format!("{i}.jar"));
            let ok = (|| -> std::io::Result<()> {
                let mut e = zip.by_name(name).map_err(std::io::Error::other)?;
                let mut out = std::fs::File::create(&p)?;
                std::io::copy(&mut e, &mut out)?;
                Ok(())
            })();
            let r = if ok.is_ok() {
                let (s, n) = crate::server::sides::classify(&p);
                (mod_side(s), n)
            } else {
                (Side::Unknown, None)
            };
            let _ = std::fs::remove_file(&p);
            r
        })
        .collect()
}

fn read_zip_bytes(zip_path: &Path, name: &str) -> Option<Vec<u8>> {
    let f = std::fs::File::open(zip_path).ok()?;
    let mut zip = zip::ZipArchive::new(std::io::BufReader::new(f)).ok()?;
    let mut e = zip.by_name(name).ok()?;
    let mut b = Vec::new();
    e.read_to_end(&mut b).ok()?;
    Some(b)
}

fn format_name(f: PackFormat) -> &'static str {
    match f {
        PackFormat::Mrpack => "mrpack",
        PackFormat::Curseforge => "curseforge",
        PackFormat::Vlpack => "vlpack",
        PackFormat::Prism => "prism",
        PackFormat::Multimc => "multimc",
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
mod tests {
    use super::*;

    #[test]
    fn mrpack_filters_client_only() {
        let idx = br#"{"files":[
            {"path":"mods/sodium.jar","hashes":{"sha1":"a"},"env":{"client":"required","server":"unsupported"},"downloads":["https://cdn.modrinth.com/data/AANobbMI/versions/x/sodium.jar"],"fileSize":10},
            {"path":"mods/lithium.jar","hashes":{"sha1":"b"},"env":{"client":"optional","server":"optional"},"downloads":["https://cdn.modrinth.com/data/gvQqBUqZ/versions/y/lithium.jar"]},
            {"path":"mods/servercore.jar","hashes":{"sha1":"c"},"env":{"client":"unsupported","server":"required"},"downloads":["https://example.org/servercore.jar"]},
            {"path":"resourcepacks/faithful.zip","hashes":{},"downloads":["https://example.org/f.zip"]},
            {"path":"mods/nourl.jar","hashes":{},"downloads":[]}
        ]}"#;
        let (list, skipped) = mrpack_server_files(idx).unwrap();
        let paths: Vec<&str> = list.iter().map(|e| e.info.path.as_str()).collect();
        assert_eq!(paths, vec!["mods/lithium.jar", "mods/servercore.jar"]);
        assert_eq!(skipped, 2);
        assert_eq!(list[1].info.side, Side::Server);
        assert!(list.iter().all(|e| e.info.include));
    }
}
