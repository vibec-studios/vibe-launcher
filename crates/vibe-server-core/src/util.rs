//! Kleine Helfer.
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

/// Einfaches Shell-artiges Aufteilen (Leerzeichen, "…" und '…').
pub fn split_args(s: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut cur = String::new();
    let mut quote: Option<char> = None;
    let mut has = false;
    for c in s.chars() {
        match quote {
            Some(q) if c == q => quote = None,
            Some(_) => cur.push(c),
            None if c == '"' || c == '\'' => {
                quote = Some(c);
                has = true;
            }
            None if c.is_whitespace() => {
                if has || !cur.is_empty() {
                    out.push(std::mem::take(&mut cur));
                    has = false;
                }
            }
            None => cur.push(c),
        }
    }
    if has || !cur.is_empty() {
        out.push(cur);
    }
    out
}

/// Wert einer Entwickler-Umgebungsvariable – nur in Debug-Builds, in Release immer `None`.
pub fn debug_override(name: &str) -> Option<String> {
    #[cfg(debug_assertions)]
    {
        std::env::var(name).ok().map(|s| s.trim().to_string()).filter(|s| !s.is_empty())
    }
    #[cfg(not(debug_assertions))]
    {
        let _ = name;
        None
    }
}
