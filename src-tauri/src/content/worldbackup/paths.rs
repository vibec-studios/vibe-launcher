use super::*;

pub(super) fn worlds_root(paths: &Paths, instance_id: &str) -> PathBuf {
    crate::content::snapshots::backups_root(paths).join("worlds").join(instance_id)
}

pub(super) fn saves(paths: &Paths, instance_id: &str) -> PathBuf {
    paths.game_dir(instance_id).join("saves")
}

pub(super) fn check_folder(folder: &str) -> AppResult<()> {
    if valid_name(folder) {
        Ok(())
    } else {
        Err(AppError::Invalid(format!("Ungültiger Weltordner: {folder}")))
    }
}

pub(super) fn parse_id(id: &str) -> AppResult<(&str, &str)> {
    let (folder, stamp) = id.split_once('/').ok_or_else(|| AppError::Invalid(format!("Ungültige Backup-ID: {id}")))?;
    if !valid_name(folder) || !valid_name(stamp) {
        return Err(AppError::Invalid(format!("Ungültige Backup-ID: {id}")));
    }
    Ok((folder, stamp))
}

pub(super) fn rel_string(base: &Path, p: &Path) -> Option<String> {
    let rel = p.strip_prefix(base).ok()?;
    let parts: Vec<String> = rel.components().map(|c| c.as_os_str().to_string_lossy().to_string()).collect();
    if parts.is_empty() { None } else { Some(parts.join("/")) }
}

/// Dateien und Ordner einer Welt (ohne `session.lock`), sortiert.
pub(super) type Tree = (Vec<(String, PathBuf, std::fs::Metadata)>, Vec<String>);

pub(super) fn list_tree(dir: &Path) -> AppResult<Tree> {
    let mut files = Vec::new();
    let mut dirs = Vec::new();
    for e in walkdir::WalkDir::new(dir).min_depth(1).follow_links(false).sort_by_file_name() {
        let e = e.map_err(|e| AppError::msg(format!("Welt nicht lesbar: {e}")))?;
        let Some(rel) = rel_string(dir, e.path()) else { continue };
        if e.file_type().is_dir() {
            dirs.push(rel);
        } else if e.file_type().is_file() && !SKIP.contains(&rel.as_str()) {
            let m = e.metadata().map_err(|e| AppError::msg(format!("Welt nicht lesbar: {e}")))?;
            files.push((rel, e.path().to_path_buf(), m));
        }
    }
    Ok((files, dirs))
}

/// Fingerabdruck aus Pfad + Größe + Änderungszeit aller Dateien (ändert sich, sobald gespielt wurde).
pub(super) fn fingerprint(dir: &Path) -> AppResult<String> {
    let (files, _) = list_tree(dir)?;
    let mut h = Sha1::new();
    for (rel, _, m) in files {
        let mt = m.modified().ok().and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_millis()).unwrap_or(0);
        h.update(rel.as_bytes());
        h.update([0]);
        h.update(m.len().to_le_bytes());
        h.update(mt.to_le_bytes());
    }
    Ok(hex::encode(h.finalize()))
}
