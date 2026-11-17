//! Export einer Instanz als `.mrpack`, CurseForge-ZIP oder `.vlpack`.
//! Dateien mit bekannter Herkunft werden als Download-Verweis exportiert, alles andere als Override.
use super::import::{cf_loader_id, VlFile, VlPack};
use super::index::{self, ContentIndex, IndexEntry};
use super::{local, modrinth as mr, *};
use crate::error::{AppError, AppResult};
use crate::state::AppState;
use crate::tasks::TaskHandle;
use crate::util::safe_join;
use serde_json::json;
use std::io::Write;
use std::path::{Path, PathBuf};

/// Standardmäßig ausgewählte Einträge (Pack-relevante Ordner/Dateien).
const DEFAULT_ON: &[&str] = &[
    "mods", "config", "defaultconfigs", "kubejs", "scripts", "resourcepacks", "shaderpacks", "datapacks", "global_packs",
    "openloader", "patchouli_books", "options.txt", "optionsshaders.txt", "optionsof.txt",
];

fn dir_size(p: &Path) -> u64 {
    walkdir::WalkDir::new(p).into_iter().flatten().filter(|e| e.file_type().is_file()).filter_map(|e| e.metadata().ok()).map(|m| m.len()).sum()
}

pub async fn entries(state: &AppState, instance_id: &str) -> AppResult<Vec<ExportEntry>> {
    state.instances.get(instance_id)?;
    let game = state.paths.game_dir(instance_id);
    tokio::task::spawn_blocking(move || {
        let Ok(rd) = std::fs::read_dir(&game) else { return Ok(vec![]) };
        let mut v: Vec<ExportEntry> = rd
            .flatten()
            .filter_map(|e| {
                let name = e.file_name().to_string_lossy().to_string();
                let m = e.metadata().ok()?;
                let is_dir = m.is_dir();
                Some(ExportEntry {
                    size: if is_dir { dir_size(&e.path()) } else { m.len() },
                    default_selected: DEFAULT_ON.contains(&name.as_str()),
                    path: name,
                    is_dir,
                })
            })
            .collect();
        v.sort_by(|a, b| b.is_dir.cmp(&a.is_dir).then(a.path.to_lowercase().cmp(&b.path.to_lowercase())));
        Ok(v)
    })
    .await?
}

/// Datei im Export.
struct Src {
    rel: String,
    abs: PathBuf,
    size: u64,
}

fn collect(game: &Path, include: &[String]) -> AppResult<Vec<Src>> {
    let mut out = Vec::new();
    let mut seen = HashSet::new();
    for inc in include {
        let base = safe_join(game, inc).ok_or_else(|| AppError::Invalid(format!("Ungültiger Pfad: {inc}")))?;
        if !base.exists() {
            continue;
        }
        for e in walkdir::WalkDir::new(&base).into_iter().flatten() {
            if !e.file_type().is_file() {
                continue;
            }
            let Ok(rel) = e.path().strip_prefix(game) else { continue };
            let rel = rel.to_string_lossy().replace('\\', "/");
            if rel.ends_with(".part") || !seen.insert(rel.clone()) {
                continue;
            }
            out.push(Src { size: e.metadata().map(|m| m.len()).unwrap_or(0), rel, abs: e.path().to_path_buf() });
        }
    }
    Ok(out)
}

/// Index-Eintrag zu einer aktivierten Datei in einem Inhaltsordner, wenn der Hash noch passt.
fn known<'a>(idx: &'a ContentIndex, rel: &str) -> Option<&'a IndexEntry> {
    let (folder, file) = rel.split_once('/')?;
    if file.contains('/') || file.ends_with(".disabled") || ContentKind::from_folder(folder).is_none() {
        return None;
    }
    let key = index::key(folder, file);
    let e = idx.files.get(&key)?;
    let local = idx.local.get(&key)?.sha1.as_ref()?;
    match &e.sha1 {
        Some(s) if !s.eq_ignore_ascii_case(local) => None,
        _ => Some(e),
    }
}

fn compression(rel: &str) -> zip::CompressionMethod {
    let l = rel.to_ascii_lowercase();
    if [".jar", ".zip", ".png", ".jpg", ".ogg", ".gz", ".mrpack"].iter().any(|e| l.ends_with(e)) {
        zip::CompressionMethod::Stored
    } else {
        zip::CompressionMethod::Deflated
    }
}

fn side(v: Option<&str>) -> &'static str {
    match v {
        Some("unsupported") => "unsupported",
        Some("optional") => "optional",
        _ => "required",
    }
}

fn require_loader_version(inst: &crate::instance::Instance) -> AppResult<Option<String>> {
    if inst.loader.kind == LoaderKind::Vanilla {
        return Ok(None);
    }
    inst.loader
        .version
        .clone()
        .filter(|v| !v.is_empty())
        .map(Some)
        .ok_or_else(|| AppError::Invalid("Die Loader-Version der Instanz ist nicht festgelegt – bitte in den Instanz-Einstellungen wählen".into()))
}

pub async fn run_export(state: AppState, task: TaskHandle, instance_id: String, opts: ExportOptions) -> AppResult<()> {
    let inst = state.instances.get(&instance_id)?;
    if opts.dest.trim().is_empty() {
        return Err(AppError::Invalid("Kein Zielpfad angegeben".into()));
    }
    if matches!(opts.format, PackFormat::Prism | PackFormat::Multimc) {
        return Err(AppError::Invalid("Export als Prism/MultiMC wird nicht unterstützt – bitte mrpack, CurseForge oder vlpack wählen".into()));
    }
    let name = if opts.name.trim().is_empty() { inst.name.clone() } else { opts.name.trim().to_string() };
    let version = if opts.version.trim().is_empty() { "1.0.0".to_string() } else { opts.version.trim().to_string() };
    let loader_version = match opts.format {
        PackFormat::Vlpack => inst.loader.version.clone(),
        _ => require_loader_version(&inst)?,
    };

    task.stage("Prüfe Inhalte …", None);
    for k in ContentKind::ALL {
        local::refresh(&state, &instance_id, k).await?;
    }
    let idx = ContentIndex::load(&state.paths, &instance_id);
    let game = state.paths.game_dir(&instance_id);
    let include = opts.include.clone();
    let g2 = game.clone();
    let files = tokio::task::spawn_blocking(move || collect(&g2, &include)).await??;
    task.check()?;

    // Bekannte Dateien bestimmen
    let mut refs: Vec<(usize, IndexEntry)> = Vec::new();
    for (i, f) in files.iter().enumerate() {
        if let Some(e) = known(&idx, &f.rel) {
            let usable = match (opts.format, e.source) {
                (PackFormat::Mrpack, Source::Modrinth) => true,
                (PackFormat::Curseforge, Source::Curseforge) => true,
                (PackFormat::Vlpack, Source::Modrinth) => true,
                (PackFormat::Vlpack, Source::Curseforge) | (PackFormat::Vlpack, Source::Store(_)) => e.url.is_some(),
                _ => false,
            };
            if usable {
                refs.push((i, e.clone()));
            }
        }
    }

    // Modrinth: fehlende URLs/SHA-512 und Client/Server-Seiten nachladen
    let mut sides: HashMap<String, (String, String)> = HashMap::new();
    let mr_refs: Vec<IndexEntry> = refs.iter().map(|(_, e)| e).filter(|e| e.source == Source::Modrinth).cloned().collect();
    if !mr_refs.is_empty() {
        task.message("Lade Modrinth-Informationen …");
        let need: Vec<String> = mr_refs.iter().filter(|e| e.url.is_none() || e.sha512.is_none() || e.size.is_none()).map(|e| e.version_id.clone()).collect();
        let versions: HashMap<String, mr::MrVersion> = if need.is_empty() { HashMap::new() } else { mr::raw_versions_batch(&state, &need).await?.into_iter().map(|v| (v.id.clone(), v)).collect() };
        for (i, e) in refs.iter_mut() {
            if e.source != Source::Modrinth {
                continue;
            }
            if let Some(v) = versions.get(&e.version_id) {
                let local_sha1 = files[*i].rel.split_once('/').and_then(|(d, f)| idx.local.get(&index::key(d, f))).and_then(|m| m.sha1.clone());
                let sha = local_sha1.or(e.sha1.clone()).unwrap_or_default();
                if let Some(f) = v.files.iter().find(|f| f.hashes.sha1.as_deref().is_some_and(|h| h.eq_ignore_ascii_case(&sha))) {
                    e.url = Some(f.url.clone());
                    e.sha512 = f.hashes.sha512.clone();
                    e.size = Some(f.size);
                    e.sha1 = f.hashes.sha1.clone();
                }
            }
        }
        if opts.format == PackFormat::Mrpack {
            let pids: Vec<String> = mr_refs.iter().map(|e| e.project_id.clone()).collect::<HashSet<_>>().into_iter().collect();
            for p in mr::raw_projects(&state, &pids).await.unwrap_or_default() {
                sides.insert(p.id.clone(), (side(p.client_side.as_deref()).to_string(), side(p.server_side.as_deref()).to_string()));
            }
        }
    }
    // Einträge ohne vollständige Daten -> Override
    refs.retain(|(_, e)| match opts.format {
        PackFormat::Mrpack => e.url.is_some() && e.sha1.is_some() && e.sha512.is_some(),
        PackFormat::Curseforge => e.project_id.parse::<u64>().is_ok() && e.version_id.parse::<u64>().is_ok(),
        _ => e.url.is_some(),
    });
    let ref_idx: HashMap<usize, IndexEntry> = refs.into_iter().collect();
    task.check()?;

    // Metadatei
    let mut sub_files: Vec<serde_json::Value> = Vec::new();
    let mut vl_files: Vec<VlFile> = Vec::new();
    for (i, e) in &ref_idx {
        let f = &files[*i];
        match opts.format {
            PackFormat::Mrpack => {
                let (client, server) = sides.get(&e.project_id).cloned().unwrap_or(("required".into(), "required".into()));
                // In dieser Client-Instanz installiert -> clientseitig mindestens optional
                let client = if client == "unsupported" { "optional".to_string() } else { client };
                sub_files.push(json!({
                    "path": f.rel,
                    "hashes": { "sha1": e.sha1, "sha512": e.sha512 },
                    "env": { "client": client, "server": server },
                    "downloads": [e.url],
                    "fileSize": e.size.unwrap_or(f.size),
                }));
            }
            PackFormat::Curseforge => {
                sub_files.push(json!({ "projectID": e.project_id.parse::<u64>().unwrap_or(0), "fileID": e.version_id.parse::<u64>().unwrap_or(0), "required": true }));
            }
            _ => vl_files.push(VlFile {
                path: f.rel.clone(),
                source: match e.source {
                    Source::Modrinth => "modrinth".into(),
                    Source::Curseforge => "curseforge".into(),
                    Source::Store(_) => "url".into(),
                },
                project_id: (!matches!(e.source, Source::Store(_))).then(|| e.project_id.clone()),
                version_id: (e.source == Source::Modrinth).then(|| e.version_id.clone()),
                file_id: (e.source == Source::Curseforge).then(|| e.version_id.clone()),
                url: e.url.clone().unwrap_or_default(),
                sha1: e.sha1.clone(),
                size: Some(e.size.unwrap_or(f.size)),
            }),
        }
    }
    sub_files.sort_by_key(|v| v.to_string());
    vl_files.sort_by(|a, b| a.path.cmp(&b.path));

    let icon_bytes: Option<Vec<u8>> = inst.icon.as_ref().filter(|i| !i.starts_with("builtin:")).and_then(|p| std::fs::read(p).ok()).filter(|b| super::meta::image_mime(b).is_some());

    let (meta_name, meta_json): (&str, Vec<u8>) = match opts.format {
        PackFormat::Mrpack => {
            let mut deps = serde_json::Map::new();
            deps.insert("minecraft".into(), json!(inst.mc_version));
            let key = match inst.loader.kind {
                LoaderKind::Fabric => Some("fabric-loader"),
                LoaderKind::Quilt => Some("quilt-loader"),
                LoaderKind::Forge => Some("forge"),
                LoaderKind::Neoforge => Some("neoforge"),
                LoaderKind::Vanilla => None,
            };
            if let (Some(k), Some(v)) = (key, &loader_version) {
                deps.insert(k.into(), json!(v));
            }
            let mut m = json!({ "formatVersion": 1, "game": "minecraft", "versionId": version, "name": name, "files": sub_files, "dependencies": deps });
            if let Some(d) = opts.description.as_ref().filter(|d| !d.trim().is_empty()) {
                m["summary"] = json!(d);
            }
            ("modrinth.index.json", serde_json::to_vec_pretty(&m)?)
        }
        PackFormat::Curseforge => {
            let loaders: Vec<serde_json::Value> = cf_loader_id(&crate::instance::Loader { kind: inst.loader.kind, version: loader_version.clone() })
                .map(|id| vec![json!({ "id": id, "primary": true })])
                .unwrap_or_default();
            let m = json!({
                "minecraft": { "version": inst.mc_version, "modLoaders": loaders },
                "manifestType": "minecraftModpack",
                "manifestVersion": 1,
                "name": name,
                "version": version,
                "author": opts.author.clone().unwrap_or_default(),
                "files": sub_files,
                "overrides": "overrides",
            });
            ("manifest.json", serde_json::to_vec_pretty(&m)?)
        }
        _ => {
            let p = VlPack {
                format_version: 1,
                name: name.clone(),
                version: Some(version.clone()),
                author: opts.author.clone().filter(|a| !a.trim().is_empty()),
                description: opts.description.clone().filter(|a| !a.trim().is_empty()),
                mc_version: inst.mc_version.clone(),
                loader: crate::instance::Loader { kind: inst.loader.kind, version: loader_version.clone() },
                icon: icon_bytes.as_ref().map(|_| "icon.png".to_string()),
                files: vl_files,
            };
            ("vlpack.json", serde_json::to_vec_pretty(&p)?)
        }
    };

    // ZIP schreiben
    let dest = PathBuf::from(opts.dest.trim());
    let overrides: Vec<(String, PathBuf, u64)> = files
        .iter()
        .enumerate()
        .filter(|(i, _)| !ref_idx.contains_key(i))
        .map(|(_, f)| (format!("overrides/{}", f.rel), f.abs.clone(), f.size))
        .collect();
    let n_refs = ref_idx.len();
    task.stage(format!("Schreibe {} ({} Verweise, {} Dateien) …", dest.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default(), n_refs, overrides.len()), Some(0.0));
    let t2 = task.clone();
    let icon_for_zip = if opts.format == PackFormat::Vlpack { icon_bytes } else { None };
    tokio::task::spawn_blocking(move || -> AppResult<()> {
        if let Some(p) = dest.parent() {
            std::fs::create_dir_all(p)?;
        }
        let tmp = dest.with_file_name(format!("{}.part", dest.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_else(|| "export".into())));
        let res = (|| -> AppResult<()> {
            let f = std::fs::File::create(&tmp)?;
            let mut w = zip::ZipWriter::new(std::io::BufWriter::new(f));
            let opt = |m: zip::CompressionMethod| zip::write::SimpleFileOptions::default().compression_method(m).large_file(false);
            w.start_file(meta_name, opt(zip::CompressionMethod::Deflated))?;
            w.write_all(&meta_json)?;
            if let Some(icon) = &icon_for_zip {
                w.start_file("icon.png", opt(zip::CompressionMethod::Stored))?;
                w.write_all(icon)?;
            }
            let total: u64 = overrides.iter().map(|o| o.2).sum::<u64>().max(1);
            let mut done = 0u64;
            for (name, abs, size) in &overrides {
                t2.check()?;
                let large = *size >= 0xFFFF_FFFF;
                w.start_file(name.as_str(), opt(compression(name)).large_file(large))?;
                let mut src = std::fs::File::open(abs)?;
                std::io::copy(&mut src, &mut w)?;
                done += size;
                t2.progress(done as f64 / total as f64);
            }
            w.finish()?.flush()?;
            Ok(())
        })();
        match res {
            Ok(()) => {
                std::fs::rename(&tmp, &dest)?;
                Ok(())
            }
            Err(e) => {
                let _ = std::fs::remove_file(&tmp);
                Err(e)
            }
        }
    })
    .await??;
    task.message(format!("Export fertig: {n_refs} Verweise, {} Dateien", files.len() - n_refs));
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn known_entries() {
        let mut idx = ContentIndex::default();
        idx.files.insert(
            "mods/a.jar".into(),
            IndexEntry {
                source: Source::Modrinth,
                project_id: "P".into(),
                version_id: "V".into(),
                sha1: Some("aa".into()),
                sha512: None,
                title: None,
                icon_url: None,
                version_number: None,
                url: None,
                size: None,
                date: None,
                release_type: None,
                side: None,
            },
        );
        idx.local.insert("mods/a.jar".into(), index::LocalMeta { sha1: Some("AA".into()), ..Default::default() });
        assert!(known(&idx, "mods/a.jar").is_some());
        assert!(known(&idx, "mods/a.jar.disabled").is_none());
        assert!(known(&idx, "config/a.jar").is_none());
        idx.local.insert("mods/a.jar".into(), index::LocalMeta { sha1: Some("bb".into()), ..Default::default() });
        assert!(known(&idx, "mods/a.jar").is_none(), "Datei wurde ersetzt");
        assert_eq!(compression("mods/x.JAR"), zip::CompressionMethod::Stored);
        assert_eq!(compression("config/x.toml"), zip::CompressionMethod::Deflated);
    }
}
