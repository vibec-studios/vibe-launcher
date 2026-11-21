use crate::error::{AppError, AppResult};
use crate::instance::Loader;
use crate::server::platform::Platform;
use crate::util::safe_join;
use serde::{Deserialize, Serialize};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

const DIRS: &[&str] = &["mods", "config", "defaultconfigs", "kubejs", "scripts", "global_packs"];
const FILES: &[&str] = &[super::place::MANIFEST, "vibe-addons.json"];
const META: &str = "vibe-snapshot.json";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SnapMeta {
    pub mc_version: String,
    pub loader: Loader,
    #[serde(default)]
    pub platform: Option<Platform>,
    #[serde(default)]
    pub label: Option<String>,
    #[serde(default)]
    pub created: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct PackSnapshot {
    pub name: String,
    pub created: i64,
    pub size: u64,
    pub label: Option<String>,
    pub mc_version: Option<String>,
    pub loader: Option<Loader>,
}

pub fn snap_dir(server_dir: &Path) -> PathBuf {
    server_dir.join("backups").join("modpack")
}

pub fn create(server_dir: &Path, meta: &SnapMeta) -> AppResult<String> {
    let dir = snap_dir(server_dir);
    std::fs::create_dir_all(&dir)?;
    let stamp = chrono::Local::now().format("%Y-%m-%d_%H-%M-%S").to_string();
    let name = format!("vor-modpack_{stamp}.zip");
    let dest = dir.join(&name);
    let tmp = dest.with_extension("zip.part");
    let f = std::fs::File::create(&tmp)?;
    let mut z = zip::ZipWriter::new(std::io::BufWriter::new(f));
    let opts = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated).large_file(true);
    z.start_file(META, opts)?;
    z.write_all(&serde_json::to_vec_pretty(meta)?)?;
    let add = |rel: String, path: &Path, z: &mut zip::ZipWriter<std::io::BufWriter<std::fs::File>>| -> AppResult<()> {
        let mut r = std::fs::File::open(path)?;
        z.start_file(rel, opts)?;
        std::io::copy(&mut r, z)?;
        Ok(())
    };
    for d in DIRS {
        let base = server_dir.join(d);
        if !base.is_dir() {
            continue;
        }
        for e in walkdir::WalkDir::new(&base).into_iter().flatten().filter(|e| e.file_type().is_file()) {
            let Ok(rel) = e.path().strip_prefix(server_dir) else { continue };
            add(rel.to_string_lossy().replace('\\', "/"), e.path(), &mut z)?;
        }
    }
    for f in FILES {
        let p = server_dir.join(f);
        if p.is_file() {
            add(f.to_string(), &p, &mut z)?;
        }
    }
    z.finish()?.flush()?;
    std::fs::rename(&tmp, &dest)?;
    Ok(name)
}

fn read_meta(path: &Path) -> Option<SnapMeta> {
    let f = std::fs::File::open(path).ok()?;
    let mut z = zip::ZipArchive::new(std::io::BufReader::new(f)).ok()?;
    let mut e = z.by_name(META).ok()?;
    let mut b = Vec::new();
    e.read_to_end(&mut b).ok()?;
    serde_json::from_slice(&b).ok()
}

pub fn list(server_dir: &Path) -> Vec<PackSnapshot> {
    let mut out = Vec::new();
    if let Ok(rd) = std::fs::read_dir(snap_dir(server_dir)) {
        for e in rd.flatten() {
            let name = e.file_name().to_string_lossy().to_string();
            if !name.ends_with(".zip") {
                continue;
            }
            let Ok(m) = e.metadata() else { continue };
            let meta = read_meta(&e.path());
            let modified = m.modified().ok().and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_millis() as i64).unwrap_or(0);
            out.push(PackSnapshot {
                created: meta.as_ref().map(|x| x.created).filter(|c| *c > 0).unwrap_or(modified),
                size: m.len(),
                label: meta.as_ref().and_then(|x| x.label.clone()),
                mc_version: meta.as_ref().map(|x| x.mc_version.clone()),
                loader: meta.map(|x| x.loader),
                name,
            });
        }
    }
    out.sort_by_key(|s| std::cmp::Reverse(s.created));
    out
}

pub fn delete(server_dir: &Path, name: &str) -> AppResult<()> {
    let p = safe_join(&snap_dir(server_dir), name).ok_or_else(|| AppError::Invalid("Ungültiger Name".into()))?;
    std::fs::remove_file(p)?;
    Ok(())
}

pub fn restore(server_dir: &Path, name: &str) -> AppResult<SnapMeta> {
    let p = safe_join(&snap_dir(server_dir), name).ok_or_else(|| AppError::Invalid("Ungültiger Name".into()))?;
    let meta = read_meta(&p).ok_or_else(|| AppError::Invalid("Kein Modpack-Snapshot".into()))?;
    for d in DIRS {
        let base = server_dir.join(d);
        if base.is_dir() {
            std::fs::remove_dir_all(&base)?;
        }
    }
    for f in FILES {
        let _ = std::fs::remove_file(server_dir.join(f));
    }
    let f = std::fs::File::open(&p)?;
    let mut z = zip::ZipArchive::new(std::io::BufReader::new(f))?;
    for i in 0..z.len() {
        let mut e = z.by_index(i)?;
        if e.is_dir() || e.name() == META {
            continue;
        }
        let Some(out) = safe_join(server_dir, e.name()) else { continue };
        if let Some(parent) = out.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let mut w = std::fs::File::create(&out)?;
        std::io::copy(&mut e, &mut w)?;
    }
    Ok(meta)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::instance::LoaderKind;

    #[test]
    fn roundtrip() {
        let dir = std::env::temp_dir().join(format!("vibe-snap-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(dir.join("mods")).unwrap();
        std::fs::create_dir_all(dir.join("config")).unwrap();
        std::fs::create_dir_all(dir.join("world")).unwrap();
        std::fs::write(dir.join("mods/a.jar"), "a").unwrap();
        std::fs::write(dir.join("config/c.toml"), "c=1").unwrap();
        std::fs::write(dir.join("world/level.dat"), "w").unwrap();
        let meta = SnapMeta { mc_version: "1.21.1".into(), loader: Loader { kind: LoaderKind::Fabric, version: Some("0.16.9".into()) }, platform: None, label: Some("Test".into()), created: 5 };
        let name = create(&dir, &meta).unwrap();
        std::fs::write(dir.join("mods/b.jar"), "b").unwrap();
        std::fs::remove_file(dir.join("mods/a.jar")).unwrap();
        std::fs::write(dir.join("config/c.toml"), "c=2").unwrap();
        let l = list(&dir);
        assert_eq!(l.len(), 1);
        assert_eq!(l[0].label.as_deref(), Some("Test"));
        let back = restore(&dir, &name).unwrap();
        assert_eq!(back.mc_version, "1.21.1");
        assert!(dir.join("mods/a.jar").is_file());
        assert!(!dir.join("mods/b.jar").exists());
        assert_eq!(std::fs::read_to_string(dir.join("config/c.toml")).unwrap(), "c=1");
        assert!(dir.join("world/level.dat").is_file());
        delete(&dir, &name).unwrap();
        assert!(list(&dir).is_empty());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
