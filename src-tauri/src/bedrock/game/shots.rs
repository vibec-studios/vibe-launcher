use super::*;

/// Ordner der Xbox-Game-Bar-Aufnahmen (Standard: Videos\Captures).
pub(super) fn captures_dir() -> Option<PathBuf> {
    if let Some(r) = super::super::dev_root() {
        return Some(r.join("Captures"));
    }
    dirs::video_dir().map(|v| v.join("Captures"))
}

/// Aufnahmen von Minecraft aus der Sitzung in die Galerie (`screenshots/` der Instanz) kopieren.
/// Die Originale bleiben unberührt.
pub fn copy_screenshots(paths: &crate::paths::Paths, id: &str, from_ms: i64, to_ms: i64) -> usize {
    let Some(dir) = captures_dir() else { return 0 };
    copy_shots_from(&dir, &paths.game_dir(id).join("screenshots"), from_ms, to_ms)
}

pub fn copy_shots_from(dir: &std::path::Path, dest: &std::path::Path, from_ms: i64, to_ms: i64) -> usize {
    let Ok(rd) = std::fs::read_dir(dir) else { return 0 };
    let mut n = 0;
    for e in rd.flatten() {
        let name = e.file_name().to_string_lossy().to_string();
        let lower = name.to_ascii_lowercase();
        if !lower.starts_with("minecraft") || !(lower.ends_with(".png") || lower.ends_with(".jpg") || lower.ends_with(".jpeg")) {
            continue;
        }
        let Some(t) = e.metadata().ok().and_then(|m| m.modified().ok()).and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_millis() as i64) else { continue };
        if t < from_ms - 5_000 || t > to_ms + 60_000 {
            continue;
        }
        let target = dest.join(&name);
        if target.exists() || std::fs::create_dir_all(dest).is_err() {
            continue;
        }
        if std::fs::copy(e.path(), &target).is_ok() {
            n += 1;
        }
    }
    n
}
