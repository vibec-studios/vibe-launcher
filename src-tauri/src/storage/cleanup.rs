use super::usage::FolderKind;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

pub const CLEARABLE_CACHES: &[&str] = &["world-map", "world-preview", "thumbs", "api", "minecraftcapes"];
const KEPT_TMP: &[&str] = &["modrinth-db-", "norisk-db-"];
const TMP_MIN_AGE: Duration = Duration::from_secs(3600);
const CRASH_KEEP: Duration = Duration::from_secs(14 * 24 * 3600);

fn age(path: &Path) -> Duration {
    std::fs::symlink_metadata(path).and_then(|m| m.modified()).ok().and_then(|t| SystemTime::now().duration_since(t).ok()).unwrap_or_default()
}

pub fn size_of(path: &Path) -> u64 {
    match std::fs::symlink_metadata(path) {
        Ok(m) if m.is_dir() => walkdir::WalkDir::new(path).into_iter().flatten().filter(|e| e.file_type().is_file()).filter_map(|e| e.metadata().ok()).map(|m| m.len()).sum(),
        Ok(m) => m.len(),
        Err(_) => 0,
    }
}

pub fn remove(path: &Path) -> u64 {
    let n = size_of(path);
    let ok = match std::fs::symlink_metadata(path) {
        Ok(m) if m.is_dir() => std::fs::remove_dir_all(path).is_ok(),
        Ok(_) => std::fs::remove_file(path).is_ok(),
        Err(_) => false,
    };
    if ok { n } else { 0 }
}

fn entries(dir: &Path) -> Vec<PathBuf> {
    std::fs::read_dir(dir).map(|rd| rd.flatten().map(|e| e.path()).collect()).unwrap_or_default()
}

fn tmp_leftovers(tmp: &Path, keep_db: bool) -> Vec<PathBuf> {
    let mut out = Vec::new();
    for p in entries(tmp) {
        let name = p.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
        if keep_db && KEPT_TMP.iter().any(|k| name.starts_with(k)) {
            continue;
        }
        if name == "packs" && p.is_dir() {
            out.extend(entries(&p).into_iter().filter(|q| age(q) >= TMP_MIN_AGE));
        } else if age(&p) >= TMP_MIN_AGE {
            out.push(p);
        }
    }
    out
}

pub fn clear_tmp(data: &Path, keep_db: bool) -> u64 {
    tmp_leftovers(&data.join("cache").join("tmp"), keep_db).iter().map(|p| remove(p)).sum()
}

fn cache_targets(data: &Path) -> Vec<PathBuf> {
    let cache = data.join("cache");
    let mut out = tmp_leftovers(&cache.join("tmp"), false);
    out.extend(CLEARABLE_CACHES.iter().map(|n| cache.join(n)));
    out.extend(entries(&cache.join("server-packs")).into_iter().filter(|p| age(p) >= TMP_MIN_AGE));
    out
}

pub fn cache_reclaimable(data: &Path) -> u64 {
    cache_targets(data).iter().map(|p| size_of(p)).sum()
}

pub fn clear_cache(data: &Path) -> u64 {
    cache_targets(data).iter().map(|p| remove(p)).sum()
}

pub fn old_launcher_logs(dir: &Path) -> Vec<PathBuf> {
    let mut logs: Vec<PathBuf> = entries(dir).into_iter().filter(|p| p.is_file() && p.file_name().is_some_and(|n| n.to_string_lossy().starts_with("launcher.log"))).collect();
    logs.sort();
    logs.pop();
    logs
}

pub fn clear_launcher_logs(data: &Path) -> u64 {
    old_launcher_logs(&data.join("logs")).iter().map(|p| remove(p)).sum()
}

pub fn old_instance_logs(game: &Path) -> (Vec<PathBuf>, u64) {
    let mut out = Vec::new();
    for e in walkdir::WalkDir::new(game.join("logs")).into_iter().flatten() {
        let name = e.file_name().to_string_lossy();
        if e.file_type().is_file() && (name.ends_with(".log.gz") || name.ends_with(".gz")) {
            out.push(e.path().to_path_buf());
        }
    }
    for p in entries(&game.join("crash-reports")) {
        if p.is_file() && age(&p) > CRASH_KEEP {
            out.push(p);
        }
    }
    let bytes = out.iter().map(|p| size_of(p)).sum();
    (out, bytes)
}

pub fn clear_instance_logs(game: &Path) -> u64 {
    old_instance_logs(game).0.iter().map(|p| remove(p)).sum()
}

pub fn clear_mod_caches(game: &Path) -> u64 {
    [".fabric", ".mixin.out"].iter().map(|d| remove(&game.join(d))).sum()
}

pub fn clear_folder(game: &Path, name: &str) -> Result<u64, String> {
    if name.is_empty() || name.contains(['/', '\\']) || name == "." || name == ".." {
        return Err("Ungültiger Ordner".into());
    }
    if !FolderKind::of(name).clearable() {
        return Err("Dieser Ordner kann hier nicht geleert werden.".into());
    }
    Ok(remove(&game.join(name)))
}

pub fn prune_dir(dir: &Path, max_bytes: u64, max_age: Duration) -> u64 {
    let mut files: Vec<(SystemTime, u64, PathBuf)> = walkdir::WalkDir::new(dir)
        .into_iter()
        .flatten()
        .filter(|e| e.file_type().is_file())
        .filter_map(|e| {
            let m = e.metadata().ok()?;
            Some((m.modified().ok()?, m.len(), e.path().to_path_buf()))
        })
        .collect();
    files.sort_by_key(|f| f.0);
    let mut total: u64 = files.iter().map(|f| f.1).sum();
    let now = SystemTime::now();
    let mut freed = 0;
    for (time, len, path) in files {
        let old = now.duration_since(time).unwrap_or_default() > max_age;
        if !old && total <= max_bytes {
            break;
        }
        if std::fs::remove_file(&path).is_ok() {
            total -= len;
            freed += len;
        }
    }
    for e in walkdir::WalkDir::new(dir).min_depth(1).contents_first(true).into_iter().flatten() {
        if e.file_type().is_dir() {
            let _ = std::fs::remove_dir(e.path());
        }
    }
    freed
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prune_dir_drops_oldest_until_under_limit() {
        let dir = super::super::test_dir("prune");
        for (i, name) in ["a/1.png", "a/2.png", "b/3.png"].iter().enumerate() {
            let p = dir.join(name);
            std::fs::create_dir_all(p.parent().unwrap()).unwrap();
            std::fs::write(&p, vec![0u8; 100]).unwrap();
            let t = SystemTime::now() - Duration::from_secs(1000 - i as u64 * 100);
            std::fs::File::options().write(true).open(&p).unwrap().set_modified(t).unwrap();
        }
        assert_eq!(prune_dir(&dir, 150, Duration::from_secs(10_000)), 200);
        assert!(dir.join("b/3.png").exists());
        assert!(!dir.join("a").exists());
        assert_eq!(prune_dir(&dir, 1000, Duration::from_secs(1)), 100);
    }

    #[test]
    fn launcher_logs_keep_newest_and_folders_are_guarded() {
        let dir = super::super::test_dir("logs");
        for d in ["launcher.log.2026-11-01", "launcher.log.2026-11-02", "other.txt"] {
            std::fs::write(dir.join(d), "x").unwrap();
        }
        assert_eq!(old_launcher_logs(&dir), vec![dir.join("launcher.log.2026-11-01")]);
        assert!(clear_folder(&dir, "saves").is_err());
        assert!(clear_folder(&dir, "../x").is_err());
        assert_eq!(clear_folder(&dir, ".fabric"), Ok(0));
    }

    #[test]
    fn tmp_keeps_fresh_and_db_copies() {
        let data = super::super::test_dir("tmp");
        let tmp = data.join("cache/tmp");
        std::fs::create_dir_all(tmp.join("packs")).unwrap();
        std::fs::create_dir_all(tmp.join("modrinth-db-1")).unwrap();
        let old = SystemTime::now() - Duration::from_secs(7200);
        for p in ["packs/old.mrpack", "leftover.zip", "modrinth-db-1/app.db"] {
            std::fs::write(tmp.join(p), vec![1u8; 10]).unwrap();
            std::fs::File::options().write(true).open(tmp.join(p)).unwrap().set_modified(old).unwrap();
        }
        std::fs::write(tmp.join("packs/new.mrpack"), vec![1u8; 10]).unwrap();
        assert_eq!(clear_tmp(&data, true), 20);
        assert!(tmp.join("packs/new.mrpack").exists());
        assert!(tmp.join("modrinth-db-1/app.db").exists());
    }
}
