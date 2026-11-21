pub mod fetch;
pub mod model;

use super::import::{modrinth_ids_from_url, CfRef, PackFile, PackPlan};
use super::{modrinth as mr, PackFormat, Source};
use crate::error::{AppError, AppResult};
use crate::state::AppState;
use fetch::Loc;
use futures::StreamExt;
use model::{IndexFile, MetaToml};
use std::collections::HashMap;
use std::io::Write;
use std::path::{Path, PathBuf};

pub struct Loaded {
    pub plan: PackPlan,
    pub cf_refs: Vec<CfRef>,
    pub zip: PathBuf,
    pub index_hash: String,
    pub location: String,
}

pub struct Remote {
    pub index_hash: String,
    pub version: Option<String>,
    pub name: Option<String>,
}

pub fn looks_like_packwiz(input: &str) -> bool {
    let s = input.trim().split(['?', '#']).next().unwrap_or("").to_ascii_lowercase();
    s.ends_with(".toml") || Path::new(input.trim()).is_dir()
}

fn index_hash_of(pack: &model::PackToml, index_bytes: Option<&[u8]>) -> String {
    pack.index.hash.clone().filter(|h| !h.trim().is_empty()).or_else(|| index_bytes.and_then(|b| fetch::hash_hex("sha256", b))).unwrap_or_default().to_ascii_lowercase()
}

pub async fn remote(state: &AppState, input: &str) -> AppResult<Remote> {
    let root = Loc::parse(input)?;
    let pack = model::parse_pack(&root.fetch(state).await?)?;
    let index_bytes = if pack.index.hash.is_none() { Some(root.join(&pack.index.file)?.fetch(state).await?) } else { None };
    Ok(Remote { index_hash: index_hash_of(&pack, index_bytes.as_deref()), version: pack.version.clone(), name: pack.name.clone() })
}

enum Entry {
    File(PackFile),
    Cf(CfRef),
    Override(String, Vec<u8>),
    Skip,
}

fn meta_entry(f: &IndexFile, meta: MetaToml) -> AppResult<Entry> {
    if !meta.wanted_on_client() {
        return Ok(Entry::Skip);
    }
    if meta.is_curseforge_metadata() {
        let cf = meta.update.curseforge.as_ref().ok_or_else(|| AppError::Invalid(format!("{}: CurseForge-Angaben fehlen", f.file)))?;
        return Ok(Entry::Cf(CfRef { project_id: cf.project_id, file_id: cf.file_id, required: true }));
    }
    let url = meta.download.url.clone().filter(|u| u.starts_with("https://") || u.starts_with("http://")).ok_or_else(|| AppError::Invalid(format!("{}: keine Download-Adresse", f.file)))?;
    let path = model::join_rel(model::folder_of(&f.file), &meta.filename);
    if !model::valid_rel(&path) || meta.filename.contains('/') || meta.filename.contains('\\') {
        return Err(AppError::Invalid(format!("Das Pack enthält einen unzulässigen Pfad: {path}")));
    }
    let origin = match (&meta.update.modrinth, &meta.update.curseforge) {
        (Some(m), _) => Some((Source::Modrinth, m.mod_id.clone(), m.version.clone())),
        (None, Some(c)) => Some((Source::Curseforge, c.project_id.to_string(), c.file_id.to_string())),
        _ => modrinth_ids_from_url(&url).map(|(p, v)| (Source::Modrinth, p, v)),
    };
    let sha1 = meta.download.hash.clone().filter(|_| meta.download.hash_format.as_deref().is_some_and(|h| h.eq_ignore_ascii_case("sha1"))).map(|h| h.to_ascii_lowercase());
    Ok(Entry::File(PackFile { path, url, sha1, size: None, origin, side: Some(meta.side()) }))
}

async fn entry(state: &AppState, index_loc: &Loc, default_fmt: Option<&str>, f: &IndexFile) -> AppResult<Entry> {
    let bytes = index_loc.join(&f.file)?.fetch(state).await?;
    fetch::verify(f.hash_format.as_deref().or(default_fmt), f.hash.as_deref(), &bytes, &f.file)?;
    if f.metafile || f.file.ends_with(".pw.toml") {
        return meta_entry(f, model::parse_meta(&bytes, &f.file)?);
    }
    let target = f.alias.clone().unwrap_or_else(|| f.file.clone()).replace('\\', "/");
    if !model::valid_rel(&target) {
        return Err(AppError::Invalid(format!("Das Pack enthält einen unzulässigen Pfad: {target}")));
    }
    Ok(Entry::Override(target, bytes))
}

async fn fill_modrinth_hashes(state: &AppState, files: &mut [PackFile]) {
    let ids: Vec<String> = files.iter().filter(|f| f.sha1.is_none()).filter_map(|f| f.origin.as_ref().filter(|o| o.0 == Source::Modrinth).map(|o| o.2.clone())).collect();
    if ids.is_empty() {
        return;
    }
    let versions = match mr::raw_versions_batch(state, &ids).await {
        Ok(v) => v,
        Err(e) => {
            tracing::warn!("Packwiz: Modrinth-Versionen nicht abrufbar: {e}");
            return;
        }
    };
    let by_id: HashMap<&str, &mr::MrVersion> = versions.iter().map(|v| (v.id.as_str(), v)).collect();
    for f in files.iter_mut().filter(|f| f.sha1.is_none()) {
        let Some((_, _, vid)) = &f.origin else { continue };
        let Some(v) = by_id.get(vid.as_str()) else { continue };
        let name = f.path.rsplit('/').next().unwrap_or(&f.path);
        if let Some(file) = v.files.iter().find(|x| x.filename == name || x.url == f.url) {
            f.sha1 = file.hashes.sha1.clone();
            f.size = Some(file.size).filter(|s| *s > 0);
        }
    }
}

fn write_zip(path: &Path, overrides: &[(String, Vec<u8>)]) -> AppResult<()> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let f = std::fs::File::create(path)?;
    let mut w = zip::ZipWriter::new(std::io::BufWriter::new(f));
    let opt = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated).large_file(false);
    for (rel, bytes) in overrides {
        w.start_file(format!("overrides/{rel}"), opt)?;
        w.write_all(bytes)?;
    }
    w.finish()?;
    Ok(())
}

pub async fn load(state: &AppState, input: &str, zip_out: &Path) -> AppResult<Loaded> {
    let root = Loc::parse(input)?;
    let pack = model::parse_pack(&root.fetch(state).await?)?;
    let index_loc = root.join(&pack.index.file)?;
    let index_bytes = index_loc.fetch(state).await?;
    fetch::verify(pack.index.hash_format.as_deref(), pack.index.hash.as_deref(), &index_bytes, "index.toml")?;
    let index = model::parse_index(&index_bytes)?;
    let default_fmt = index.hash_format.clone();
    let jobs = index.files.into_iter().map(|f| {
        let st = state.clone();
        let loc = index_loc.clone();
        let fmt = default_fmt.clone();
        async move { entry(&st, &loc, fmt.as_deref(), &f).await }
    });
    let results: Vec<AppResult<Entry>> = futures::stream::iter(jobs).buffered(8).collect().await;
    let mut files = Vec::new();
    let mut cf_refs = Vec::new();
    let mut overrides = Vec::new();
    for r in results {
        match r? {
            Entry::File(f) => files.push(f),
            Entry::Cf(c) => cf_refs.push(c),
            Entry::Override(rel, b) => overrides.push((rel, b)),
            Entry::Skip => {}
        }
    }
    fill_modrinth_hashes(state, &mut files).await;
    let zp = zip_out.to_path_buf();
    tokio::task::spawn_blocking(move || write_zip(&zp, &overrides)).await??;
    let name = pack.name.clone().filter(|n| !n.trim().is_empty()).unwrap_or_else(|| "Packwiz-Pack".into());
    let plan = PackPlan {
        format: PackFormat::Mrpack,
        name,
        version_name: pack.version.clone(),
        author: pack.author.clone(),
        mc_version: pack.mc_version(),
        loader: pack.loader(),
        icon: None,
        overrides: vec!["overrides/".into()],
        files,
        cf_files: cf_refs.clone(),
        prism: None,
        embedded_mods: 0,
    };
    Ok(Loaded { plan, cf_refs, zip: zip_out.to_path_buf(), index_hash: index_hash_of(&pack, Some(&index_bytes)), location: root.display() })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detect() {
        assert!(looks_like_packwiz("https://example.com/pack.toml"));
        assert!(looks_like_packwiz("https://example.com/pack.toml?ref=main"));
        assert!(!looks_like_packwiz("https://example.com/pack.mrpack"));
        assert!(!looks_like_packwiz("C:/x/pack.zip"));
    }

    #[test]
    fn meta_to_file() {
        let f = IndexFile { file: "mods/sodium.pw.toml".into(), hash: None, hash_format: None, alias: None, metafile: true };
        let m = model::parse_meta(
            b"name = \"Sodium\"\nfilename = \"sodium.jar\"\nside = \"client\"\n[download]\nurl = \"https://cdn.modrinth.com/data/AANobbMI/versions/b4hTi3mo/sodium.jar\"\nhash-format = \"sha1\"\nhash = \"ABC\"\n",
            "mods/sodium.pw.toml",
        )
        .unwrap();
        let Entry::File(p) = meta_entry(&f, m).unwrap() else { panic!("Datei erwartet") };
        assert_eq!(p.path, "mods/sodium.jar");
        assert_eq!(p.sha1.as_deref(), Some("abc"));
        assert_eq!(p.origin, Some((Source::Modrinth, "AANobbMI".into(), "b4hTi3mo".into())));
        let server = model::parse_meta(b"filename = \"s.jar\"\nside = \"server\"\n[download]\nurl = \"https://x/s.jar\"\n", "mods/s.pw.toml").unwrap();
        assert!(matches!(meta_entry(&f, server).unwrap(), Entry::Skip));
        let evil = model::parse_meta(b"filename = \"../../x.jar\"\n[download]\nurl = \"https://x/s.jar\"\n", "mods/e.pw.toml").unwrap();
        assert!(meta_entry(&f, evil).is_err());
    }
}
