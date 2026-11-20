//! Kleine Helfer.
pub mod diskspace;
pub mod spacecheck;
#[cfg(test)]
pub mod testdir;
use crate::error::AppResult;
use serde::Serialize;
use std::path::Path;

/// JSON atomar schreiben (tmp + rename), damit ein Absturz nie halbe Dateien hinterlässt.
pub fn write_json_atomic<T: Serialize>(path: &Path, value: &T) -> AppResult<()> {
    if let Some(p) = path.parent() {
        std::fs::create_dir_all(p)?;
    }
    let tmp = path.with_extension("json.tmp");
    let data = serde_json::to_vec_pretty(value)?;
    std::fs::write(&tmp, data)?;
    std::fs::rename(&tmp, path)?;
    Ok(())
}

pub fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

/// Ordner rekursiv kopieren (blockierend).
pub fn copy_dir_all(src: &Path, dst: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(dst)?;
    for entry in walkdir::WalkDir::new(src).min_depth(1) {
        let entry = entry.map_err(std::io::Error::other)?;
        let rel = entry.path().strip_prefix(src).map_err(std::io::Error::other)?;
        let target = dst.join(rel);
        if entry.file_type().is_dir() {
            std::fs::create_dir_all(&target)?;
        } else if entry.file_type().is_file() {
            if let Some(p) = target.parent() {
                std::fs::create_dir_all(p)?;
            }
            std::fs::copy(entry.path(), &target)?;
        }
    }
    Ok(())
}

/// Ordner/Datei im Datei-Explorer öffnen.
pub fn open_in_explorer(path: &Path) -> AppResult<()> {
    #[cfg(windows)]
    {
        std::process::Command::new("explorer").arg(path).spawn()?;
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open").arg(path).spawn()?;
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        std::process::Command::new("xdg-open").arg(path).spawn()?;
    }
    Ok(())
}

/// Sicherstellen, dass ein relativer Pfad aus einem Archiv nicht aus `base` ausbricht (Zip-Slip).
pub fn safe_join(base: &Path, rel: &str) -> Option<std::path::PathBuf> {
    let rel = rel.replace('\\', "/");
    let mut out = base.to_path_buf();
    for comp in rel.split('/') {
        match comp {
            "" | "." => {}
            ".." => return None,
            c if c.contains(':') => return None,
            c => out.push(c),
        }
    }
    if out == base { None } else { Some(out) }
}
