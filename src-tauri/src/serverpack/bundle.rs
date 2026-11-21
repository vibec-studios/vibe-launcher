use super::place;
use super::read::{self, Configs, Entry, EntrySrc, Plan};
use super::{PackInput, PackOptions};
use crate::content::Side;
use crate::error::{AppError, AppResult};
use crate::instance::{Loader, LoaderKind};
use crate::state::AppState;
use crate::util::safe_join;
use serde::Serialize;
use serde_json::json;
use std::io::Write;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize)]
pub struct BundleInfo {
    pub path: String,
    pub file_name: String,
    pub size: u64,
    pub sha256: String,
    pub name: String,
    pub mc_version: String,
    pub loader: Loader,
    pub files: u32,
    pub embedded: u32,
}

pub fn loader_key(l: LoaderKind) -> Option<&'static str> {
    match l {
        LoaderKind::Fabric => Some("fabric-loader"),
        LoaderKind::Quilt => Some("quilt-loader"),
        LoaderKind::Forge => Some("forge"),
        LoaderKind::Neoforge => Some("neoforge"),
        LoaderKind::Vanilla => None,
    }
}

pub fn index_json(plan: &Plan, linked: &[&Entry]) -> serde_json::Value {
    let mut deps = serde_json::Map::new();
    deps.insert("minecraft".into(), json!(plan.mc_version));
    if let (Some(k), Some(v)) = (loader_key(plan.loader.kind), plan.loader.version.as_ref()) {
        deps.insert(k.into(), json!(v));
    }
    let files: Vec<serde_json::Value> = linked
        .iter()
        .filter_map(|e| match &e.src {
            EntrySrc::Url { url, sha1: Some(sha1), sha512 } => {
                let mut hashes = serde_json::Map::new();
                hashes.insert("sha1".into(), json!(sha1));
                if let Some(s) = sha512 {
                    hashes.insert("sha512".into(), json!(s));
                }
                Some(json!({
                    "path": e.info.path,
                    "hashes": hashes,
                    "env": { "client": if e.info.side == Side::Server { "unsupported" } else { "required" }, "server": "required" },
                    "downloads": [url],
                    "fileSize": e.info.size.unwrap_or(0),
                }))
            }
            _ => None,
        })
        .collect();
    json!({
        "formatVersion": 1,
        "game": "minecraft",
        "versionId": plan.version_name.clone().unwrap_or_else(|| "server".into()),
        "name": plan.name,
        "summary": "Server-Paket aus dem Vibe Launcher",
        "files": files,
        "dependencies": deps,
    })
}

fn linkable(e: &Entry) -> bool {
    matches!(&e.src, EntrySrc::Url { sha1: Some(_), .. })
}

fn write_bundle(plan: &Plan, chosen: &[&Entry], staged: &Path, opts: &PackOptions, dest: &Path) -> AppResult<(u32, u32)> {
    let tmp = dest.with_extension("mrpack.part");
    let f = std::fs::File::create(&tmp)?;
    let mut z = zip::ZipWriter::new(std::io::BufWriter::new(f));
    let o = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated).large_file(true);
    let linked: Vec<&Entry> = chosen.iter().copied().filter(|e| linkable(e)).collect();
    z.start_file("modrinth.index.json", o)?;
    z.write_all(&serde_json::to_vec_pretty(&index_json(plan, &linked))?)?;
    let mut embedded = 0u32;
    let put = |rel: &str, src: &Path, z: &mut zip::ZipWriter<std::io::BufWriter<std::fs::File>>| -> AppResult<()> {
        let mut r = std::fs::File::open(src)?;
        z.start_file(format!("overrides/{rel}"), o)?;
        std::io::copy(&mut r, z)?;
        Ok(())
    };
    for e in chosen.iter().filter(|e| !linkable(e)) {
        let src = safe_join(staged, &e.info.path).ok_or_else(|| AppError::Invalid(format!("Ungültiger Pfad: {}", e.info.path)))?;
        put(&e.info.path, &src, &mut z)?;
        embedded += 1;
    }
    if opts.configs {
        match &plan.configs {
            Configs::None => {}
            Configs::Dir(root) => {
                for rel in place::dir_configs(root) {
                    if let Some(src) = safe_join(root, &rel) {
                        put(&rel, &src, &mut z)?;
                    }
                }
            }
            Configs::Zip(prefixes) => {
                if let Some(zp) = &plan.archive {
                    let list = place::zip_configs(zp, prefixes)?;
                    let f = std::fs::File::open(zp)?;
                    let mut src = zip::ZipArchive::new(std::io::BufReader::new(f))?;
                    for (rel, name) in list {
                        let Ok(mut e) = src.by_name(&name) else { continue };
                        z.start_file(format!("overrides/{rel}"), o)?;
                        std::io::copy(&mut e, &mut z)?;
                    }
                }
            }
        }
    }
    if let (Some(w), Some(root)) = (opts.world.as_ref().filter(|w| !w.trim().is_empty()), match &plan.configs {
        Configs::Dir(r) => Some(r.clone()),
        _ => None,
    }) {
        let base = safe_join(&root.join("saves"), w).ok_or_else(|| AppError::Invalid("Ungültiger Weltname".into()))?;
        for e in walkdir::WalkDir::new(&base).into_iter().flatten().filter(|e| e.file_type().is_file()) {
            let Ok(rel) = e.path().strip_prefix(&base) else { continue };
            let rel = rel.to_string_lossy().replace('\\', "/");
            if rel == "session.lock" {
                continue;
            }
            put(&format!("world/{rel}"), e.path(), &mut z)?;
        }
    }
    z.finish()?.flush()?;
    std::fs::rename(&tmp, dest)?;
    Ok((linked.len() as u32, embedded))
}

fn bundle_dir(state: &AppState) -> PathBuf {
    state.paths.cache().join("server-packs")
}

pub async fn build(state: &AppState, input: &PackInput, opts: &PackOptions, sp: &crate::tasks::SubProgress) -> AppResult<BundleInfo> {
    let plan = read::read(state, input).await?;
    let dir = bundle_dir(state);
    tokio::fs::create_dir_all(&dir).await?;
    let staging = dir.join(format!("staging-{}", uuid::Uuid::new_v4()));
    let mut embed_plan = plan.clone();
    let wanted: Vec<String> = plan.selected(opts.selected.as_deref()).iter().filter(|e| !linkable(e)).map(|e| e.info.path.clone()).collect();
    embed_plan.entries.retain(|e| wanted.contains(&e.info.path));
    let embed_opts = PackOptions { selected: Some(wanted.clone()), configs: false, world: None };
    super::run::stage(state, &embed_plan, &embed_opts, &staging, sp).await?;
    let file_name = format!("{}-server.mrpack", crate::paths::sanitize_file_name(&plan.name).replace(' ', "-"));
    let dest = dir.join(&file_name);
    let opts2 = opts.clone();
    let st2 = staging.clone();
    let d2 = dest.clone();
    let plan2 = plan.clone();
    let (linked, embedded) = tokio::task::spawn_blocking(move || {
        let chosen = plan2.selected(opts2.selected.as_deref());
        let r = write_bundle(&plan2, &chosen, &st2, &opts2, &d2);
        let _ = std::fs::remove_dir_all(&st2);
        r
    })
    .await??;
    let d3 = dest.clone();
    let sha256 = tokio::task::spawn_blocking(move || crate::net::sha256_file(&d3)).await??;
    let size = tokio::fs::metadata(&dest).await?.len();
    Ok(BundleInfo {
        path: dest.to_string_lossy().to_string(),
        file_name,
        size,
        sha256,
        name: plan.name,
        mc_version: plan.mc_version,
        loader: plan.loader,
        files: linked + embedded,
        embedded,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::serverpack::{EntryOrigin, PackEntry};

    fn plan_with(entries: Vec<Entry>) -> Plan {
        Plan {
            name: "Testpack".into(),
            version_name: Some("1.0".into()),
            format: "instance",
            mc_version: "1.21.1".into(),
            loader: Loader { kind: LoaderKind::Fabric, version: Some("0.16.9".into()) },
            entries,
            configs: Configs::None,
            archive: None,
            missing: vec![],
            warnings: vec![],
            client_skipped: 0,
            instance: None,
        }
    }

    fn e(path: &str, side: Side, src: EntrySrc) -> Entry {
        Entry { info: PackEntry { path: path.into(), name: path.into(), side, enabled: true, include: side != Side::Client, origin: EntryOrigin::Download, size: Some(3) }, src }
    }

    #[test]
    fn bundle_roundtrip_reads_as_server_pack() {
        let dir = std::env::temp_dir().join(format!("vibe-bundle-{}", uuid::Uuid::new_v4()));
        let staged = dir.join("staged");
        std::fs::create_dir_all(staged.join("mods")).unwrap();
        std::fs::write(staged.join("mods/local.jar"), "jar").unwrap();
        let plan = plan_with(vec![
            e("mods/lithium.jar", Side::Both, EntrySrc::Url { url: "https://cdn.modrinth.com/data/gvQqBUqZ/versions/a/lithium.jar".into(), sha1: Some("abc".into()), sha512: None }),
            e("mods/local.jar", Side::Server, EntrySrc::File(staged.join("mods/local.jar"))),
            e("mods/sodium.jar", Side::Client, EntrySrc::Url { url: "https://cdn.modrinth.com/x.jar".into(), sha1: Some("d".into()), sha512: None }),
        ]);
        let chosen = plan.selected(None);
        assert_eq!(chosen.len(), 2);
        let dest = dir.join("out.mrpack");
        let (linked, embedded) = write_bundle(&plan, &chosen, &staged, &PackOptions::default(), &dest).unwrap();
        assert_eq!((linked, embedded), (1, 1));
        let f = std::fs::File::open(&dest).unwrap();
        let mut z = zip::ZipArchive::new(f).unwrap();
        let mut idx = String::new();
        std::io::Read::read_to_string(&mut z.by_name("modrinth.index.json").unwrap(), &mut idx).unwrap();
        let v: serde_json::Value = serde_json::from_str(&idx).unwrap();
        assert_eq!(v["dependencies"]["fabric-loader"], "0.16.9");
        assert_eq!(v["files"].as_array().unwrap().len(), 1);
        assert!(z.by_name("overrides/mods/local.jar").is_ok());
        let (files, _) = read::mrpack_server_files(idx.as_bytes()).unwrap();
        assert_eq!(files.len(), 1);
        let (mods, _, _, _) = read::archive_scan(&dest, &["overrides/".to_string()]).unwrap();
        assert_eq!(mods[0].0, "mods/local.jar");
        let _ = std::fs::remove_dir_all(&dir);
    }
}
