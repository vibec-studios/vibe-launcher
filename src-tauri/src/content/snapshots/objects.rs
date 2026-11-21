use super::*;

// ------------------------------------------------------------------ Bestand einlesen

pub(super) struct Found {
    /// (rel_path, absoluter Pfad, Größe, mtime)
    pub(super) files: Vec<(String, PathBuf, u64, i64)>,
    pub(super) dirs: Vec<String>,
    pub(super) meta: Vec<(String, PathBuf, u64)>,
}

pub(super) fn scan(game: &Path, inst: &Path, sel: &Sel) -> AppResult<Found> {
    let mut files = Vec::new();
    let mut dirs = Vec::new();
    for d in sel.dirs() {
        let root = game.join(d);
        if !root.is_dir() {
            continue;
        }
        for e in walkdir::WalkDir::new(&root).follow_links(false) {
            let e = e.map_err(|e| AppError::msg(format!("Ordner nicht lesbar: {e}")))?;
            let Some(rel) = rel_string(game, e.path()) else { continue };
            if e.file_type().is_dir() {
                dirs.push(rel);
            } else if e.file_type().is_file() {
                let m = e.metadata().map_err(|e| AppError::msg(format!("Datei nicht lesbar: {e}")))?;
                files.push((rel, e.path().to_path_buf(), m.len(), mtime_ms(&m)));
            }
        }
    }
    for f in sel.files() {
        let p = game.join(f);
        if let Ok(m) = std::fs::metadata(&p) {
            if m.is_file() {
                files.push((f.to_string(), p, m.len(), mtime_ms(&m)));
            }
        }
    }
    let mut meta = Vec::new();
    for f in sel.meta() {
        let p = inst.join(f);
        if let Ok(m) = std::fs::metadata(&p) {
            if m.is_file() {
                meta.push((f.to_string(), p, m.len()));
            }
        }
    }
    files.sort_by(|a, b| a.0.cmp(&b.0));
    dirs.sort();
    Ok(Found { files, dirs, meta })
}

// ------------------------------------------------------------------ Hash-Cache (nur .jar/.zip)

pub(super) type HashCache = HashMap<String, (u64, i64, String)>;

pub(super) fn load_cache(root: &Path, instance_id: &str) -> HashCache {
    std::fs::read(snapshot_dir(root, instance_id).join("hashes.cache")).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default()
}

pub(super) fn save_cache(root: &Path, instance_id: &str, cache: &HashCache) {
    let p = snapshot_dir(root, instance_id).join("hashes.cache");
    if let Err(e) = crate::util::write_json_atomic(&p, cache) {
        tracing::debug!("Hash-Cache nicht gespeichert: {e}");
    }
}

pub(super) fn hash_cached(cache: &mut HashCache, rel: &str, path: &Path, size: u64, mtime: i64) -> AppResult<String> {
    if linkable(rel) {
        if let Some((s, m, h)) = cache.get(rel) {
            if *s == size && *m == mtime && mtime != 0 {
                return Ok(h.clone());
            }
        }
    }
    let h = crate::net::sha1_file(path).map_err(|e| AppError::msg(format!("{rel} nicht lesbar: {e}")))?;
    if linkable(rel) {
        cache.insert(rel.to_string(), (size, mtime, h.clone()));
    }
    Ok(h)
}

// ------------------------------------------------------------------ Objekte

pub(super) fn tmp_name(p: &Path) -> PathBuf {
    let name = p.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
    p.with_file_name(format!(".{name}.vl-{}", &uuid::Uuid::new_v4().simple().to_string()[..8]))
}

/// Datei in den Objektspeicher legen (Hardlink für `.jar`/`.zip`, sonst Kopie).
pub(super) fn store_object(root: &Path, src: &Path, sha1: &str, size: u64, link: bool) -> std::io::Result<()> {
    let obj = object_path(root, sha1);
    if let Ok(m) = std::fs::metadata(&obj) {
        if m.len() == size {
            return Ok(());
        }
        std::fs::remove_file(&obj)?;
    }
    if let Some(p) = obj.parent() {
        std::fs::create_dir_all(p)?;
    }
    if link && std::fs::hard_link(src, &obj).is_ok() {
        return Ok(());
    }
    let tmp = tmp_name(&obj);
    if let Err(e) = std::fs::copy(src, &tmp).and_then(|_| std::fs::rename(&tmp, &obj)) {
        let _ = std::fs::remove_file(&tmp);
        return Err(e);
    }
    Ok(())
}

/// Objekt an `target` ablegen (Hardlink oder Kopie, atomar über eine temporäre Datei).
pub(super) fn place_object(obj: &Path, target: &Path, link: bool) -> std::io::Result<()> {
    if let Some(p) = target.parent() {
        std::fs::create_dir_all(p)?;
    }
    let tmp = tmp_name(target);
    let linked = link && std::fs::hard_link(obj, &tmp).is_ok();
    if !linked {
        if let Err(e) = std::fs::copy(obj, &tmp) {
            let _ = std::fs::remove_file(&tmp);
            return Err(e);
        }
    }
    if let Err(e) = std::fs::rename(&tmp, target) {
        let _ = std::fs::remove_file(&tmp);
        return Err(e);
    }
    Ok(())
}
