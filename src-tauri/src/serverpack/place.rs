use super::filter::{self, PathKind};
use crate::error::{AppError, AppResult};
use crate::instance::Loader;
use crate::util::safe_join;
use serde::{Deserialize, Serialize};
use std::path::Path;

pub const MANIFEST: &str = "vibe-pack.json";
pub const STAGING: &str = ".vibe-pack-staging";

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(default)]
pub struct Manifest {
    pub name: String,
    pub version_name: Option<String>,
    pub format: String,
    pub mc_version: String,
    pub loader: Option<Loader>,
    pub files: Vec<String>,
    pub applied_at: i64,
}

pub fn load_manifest(dir: &Path) -> Option<Manifest> {
    let b = std::fs::read(dir.join(MANIFEST)).ok()?;
    serde_json::from_slice(&b).ok()
}

pub fn save_manifest(dir: &Path, m: &Manifest) -> AppResult<()> {
    crate::util::write_json_atomic(&dir.join(MANIFEST), m)
}

pub fn removals(dir: &Path, m: Option<&Manifest>) -> Vec<String> {
    match m {
        Some(m) => m.files.iter().filter(|r| safe_join(dir, r).is_some_and(|p| p.is_file() || p.with_file_name(format!("{}.disabled", file_of(r))).is_file())).cloned().collect(),
        None => {
            let mut out = Vec::new();
            if let Ok(rd) = std::fs::read_dir(dir.join("mods")) {
                for e in rd.flatten() {
                    let n = e.file_name().to_string_lossy().to_string();
                    let l = n.to_ascii_lowercase();
                    if e.path().is_file() && (l.ends_with(".jar") || l.ends_with(".jar.disabled")) {
                        out.push(format!("mods/{n}"));
                    }
                }
            }
            out.sort();
            out
        }
    }
}

fn file_of(rel: &str) -> &str {
    rel.rsplit('/').next().unwrap_or(rel)
}

pub fn remove_all(dir: &Path, rels: &[String]) {
    for r in rels {
        if let Some(p) = safe_join(dir, r) {
            let _ = std::fs::remove_file(&p);
            let _ = std::fs::remove_file(p.with_file_name(format!("{}.disabled", file_of(r))));
        }
    }
}

fn replace_file(src: &Path, dst: &Path) -> std::io::Result<()> {
    if let Some(p) = dst.parent() {
        std::fs::create_dir_all(p)?;
    }
    if dst.exists() {
        std::fs::remove_file(dst)?;
    }
    if std::fs::rename(src, dst).is_err() {
        std::fs::copy(src, dst)?;
        let _ = std::fs::remove_file(src);
    }
    Ok(())
}

pub fn install_staged(staging: &Path, dir: &Path, rels: &[String]) -> AppResult<()> {
    for r in rels {
        let src = safe_join(staging, r).ok_or_else(|| AppError::Invalid(format!("Ungültiger Pfad: {r}")))?;
        let dst = safe_join(dir, r).ok_or_else(|| AppError::Invalid(format!("Ungültiger Pfad: {r}")))?;
        if !src.is_file() {
            return Err(AppError::msg(format!("{r} fehlt nach dem Download.")));
        }
        replace_file(&src, &dst)?;
    }
    Ok(())
}

pub fn extract_entry(zip_path: &Path, name: &str, dst: &Path) -> AppResult<()> {
    let f = std::fs::File::open(zip_path)?;
    let mut zip = zip::ZipArchive::new(std::io::BufReader::new(f))?;
    let mut e = zip.by_name(name)?;
    if let Some(p) = dst.parent() {
        std::fs::create_dir_all(p)?;
    }
    let mut out = std::fs::File::create(dst)?;
    std::io::copy(&mut e, &mut out)?;
    Ok(())
}

pub fn zip_configs(zip_path: &Path, prefixes: &[String]) -> AppResult<Vec<(String, String)>> {
    let f = std::fs::File::open(zip_path)?;
    let zip = zip::ZipArchive::new(std::io::BufReader::new(f))?;
    let names: Vec<String> = zip.file_names().map(|n| n.replace('\\', "/")).collect();
    let mut out: std::collections::BTreeMap<String, String> = Default::default();
    for prefix in prefixes {
        for n in &names {
            if n.ends_with('/') {
                continue;
            }
            let Some(rel) = n.strip_prefix(prefix.as_str()) else { continue };
            if rel.is_empty() || safe_join(Path::new("base"), rel).is_none() || filter::classify(rel) != PathKind::Config {
                continue;
            }
            out.insert(rel.to_string(), n.clone());
        }
    }
    Ok(out.into_iter().collect())
}

pub fn copy_zip_configs(zip_path: &Path, prefixes: &[String], dir: &Path) -> AppResult<u32> {
    let list = zip_configs(zip_path, prefixes)?;
    let f = std::fs::File::open(zip_path)?;
    let mut zip = zip::ZipArchive::new(std::io::BufReader::new(f))?;
    let mut n = 0;
    for (rel, name) in list {
        let Some(dst) = safe_join(dir, &rel) else { continue };
        let Ok(mut e) = zip.by_name(&name) else { continue };
        if let Some(p) = dst.parent() {
            std::fs::create_dir_all(p)?;
        }
        let tmp = dst.with_file_name(format!(".{}.vltmp", file_of(&rel)));
        {
            let mut out = std::fs::File::create(&tmp)?;
            std::io::copy(&mut e, &mut out)?;
        }
        replace_file(&tmp, &dst)?;
        n += 1;
    }
    Ok(n)
}

pub fn dir_configs(root: &Path) -> Vec<String> {
    let mut out = Vec::new();
    for d in filter::CONFIG_DIRS {
        let base = root.join(d);
        if !base.is_dir() {
            continue;
        }
        for e in walkdir::WalkDir::new(&base).into_iter().flatten().filter(|e| e.file_type().is_file()) {
            if let Ok(rel) = e.path().strip_prefix(root) {
                out.push(rel.to_string_lossy().replace('\\', "/"));
            }
        }
    }
    out
}

pub fn copy_dir_configs(root: &Path, dir: &Path) -> AppResult<u32> {
    let mut n = 0;
    for rel in dir_configs(root) {
        let (Some(src), Some(dst)) = (safe_join(root, &rel), safe_join(dir, &rel)) else { continue };
        if let Some(p) = dst.parent() {
            std::fs::create_dir_all(p)?;
        }
        if dst.exists() {
            let _ = std::fs::remove_file(&dst);
        }
        std::fs::copy(&src, &dst)?;
        n += 1;
    }
    Ok(n)
}

pub fn top_dirs(rels: &[String]) -> Vec<String> {
    let mut d: Vec<String> = rels.iter().map(|r| r.split('/').next().unwrap_or(r).to_string()).collect();
    d.sort();
    d.dedup();
    d
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn tmpdir(tag: &str) -> std::path::PathBuf {
        let d = std::env::temp_dir().join(format!("vibe-sp-{tag}-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn manifest_removals_and_staging() {
        let dir = tmpdir("place");
        std::fs::create_dir_all(dir.join("mods")).unwrap();
        std::fs::write(dir.join("mods/old.jar"), "o").unwrap();
        std::fs::write(dir.join("mods/user.jar.disabled"), "u").unwrap();
        assert_eq!(removals(&dir, None), vec!["mods/old.jar".to_string(), "mods/user.jar.disabled".to_string()]);
        let m = Manifest { files: vec!["mods/old.jar".into()], ..Default::default() };
        assert_eq!(removals(&dir, Some(&m)), vec!["mods/old.jar".to_string()]);
        remove_all(&dir, &removals(&dir, Some(&m)));
        assert!(!dir.join("mods/old.jar").exists());
        assert!(dir.join("mods/user.jar.disabled").exists());

        let staging = dir.join(STAGING);
        std::fs::create_dir_all(staging.join("mods")).unwrap();
        std::fs::write(staging.join("mods/new.jar"), "n").unwrap();
        install_staged(&staging, &dir, &["mods/new.jar".into()]).unwrap();
        assert_eq!(std::fs::read_to_string(dir.join("mods/new.jar")).unwrap(), "n");
        assert!(install_staged(&staging, &dir, &["mods/missing.jar".into()]).is_err());
        save_manifest(&dir, &Manifest { name: "P".into(), files: vec!["mods/new.jar".into()], ..Default::default() }).unwrap();
        assert_eq!(load_manifest(&dir).unwrap().files, vec!["mods/new.jar".to_string()]);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn zip_overrides_server_only() {
        let dir = tmpdir("zip");
        let zp = dir.join("p.mrpack");
        {
            let f = std::fs::File::create(&zp).unwrap();
            let mut z = zip::ZipWriter::new(f);
            let o = zip::write::SimpleFileOptions::default();
            for (n, c) in [
                ("overrides/config/a.toml", "a=1"),
                ("overrides/options.txt", "x"),
                ("overrides/resourcepacks/r.zip", "r"),
                ("server-overrides/config/a.toml", "a=2"),
                ("client-overrides/config/c.toml", "c"),
                ("overrides/mods/inside.jar", "j"),
            ] {
                z.start_file(n, o).unwrap();
                z.write_all(c.as_bytes()).unwrap();
            }
            z.finish().unwrap();
        }
        let prefixes = vec!["overrides/".to_string(), "server-overrides/".to_string()];
        let list = zip_configs(&zp, &prefixes).unwrap();
        assert_eq!(list, vec![("config/a.toml".to_string(), "server-overrides/config/a.toml".to_string())]);
        let out = dir.join("srv");
        assert_eq!(copy_zip_configs(&zp, &prefixes, &out).unwrap(), 1);
        assert_eq!(std::fs::read_to_string(out.join("config/a.toml")).unwrap(), "a=2");
        let (mods, cfg, dirs, skipped) = super::super::read::archive_scan(&zp, &prefixes).unwrap();
        assert_eq!(mods.len(), 1);
        assert_eq!(mods[0].0, "mods/inside.jar");
        assert_eq!(cfg, 1);
        assert_eq!(dirs, vec!["config".to_string()]);
        assert_eq!(skipped, 1);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
