use super::*;

// ------------------------------------------------------------------ Pfade

pub(crate) fn backups_root(paths: &Paths) -> PathBuf {
    paths.root.join("backups")
}

pub(super) fn object_path(root: &Path, sha1: &str) -> PathBuf {
    root.join("objects").join(&sha1[..2.min(sha1.len())]).join(sha1)
}

pub(super) fn snapshot_dir(root: &Path, instance_id: &str) -> PathBuf {
    root.join("snapshots").join(instance_id)
}

/// IDs/Ordnernamen aus dem Frontend prüfen (kein Ausbruch aus dem Ordner).
pub(crate) fn valid_name(s: &str) -> bool {
    !s.is_empty() && s != "." && s != ".." && !s.contains(['/', '\\', ':']) && !s.chars().any(|c| c.is_control())
}

pub(super) fn check_id(id: &str, what: &str) -> AppResult<()> {
    if valid_name(id) {
        Ok(())
    } else {
        Err(AppError::Invalid(format!("Ungültige {what}: {id}")))
    }
}

/// Wird per Hardlink abgelegt (wird nie an Ort und Stelle verändert)?
pub(super) fn linkable(rel: &str) -> bool {
    let l = rel.to_ascii_lowercase();
    let l = l.strip_suffix(".disabled").unwrap_or(&l);
    l.ends_with(".jar") || l.ends_with(".zip")
}

pub(super) fn rel_string(base: &Path, p: &Path) -> Option<String> {
    let rel = p.strip_prefix(base).ok()?;
    let parts: Vec<String> = rel.components().map(|c| c.as_os_str().to_string_lossy().to_string()).collect();
    if parts.is_empty() { None } else { Some(parts.join("/")) }
}

pub(super) fn mtime_ms(m: &std::fs::Metadata) -> i64 {
    m.modified().ok().and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_millis() as i64).unwrap_or(0)
}
