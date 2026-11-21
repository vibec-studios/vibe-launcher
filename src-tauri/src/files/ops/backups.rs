use super::*;

pub(super) fn backup_dir(r: &FileRoot, rel: &str) -> PathBuf {
    let mut p = r.backups.clone();
    for c in rel.split('/') {
        p.push(c);
    }
    p
}

/// Sicherungen einer Datei, älteste zuerst (Namen sind sortierbare Zeitstempel).
pub fn list_backups(r: &FileRoot, rel: &str) -> Vec<PathBuf> {
    let Ok(rd) = std::fs::read_dir(backup_dir(r, rel)) else { return Vec::new() };
    let mut v: Vec<PathBuf> = rd
        .flatten()
        .filter(|e| e.file_type().map(|t| t.is_file()).unwrap_or(false))
        .map(|e| e.path())
        .filter(|p| !p.to_string_lossy().ends_with(TMP_SUFFIX))
        .collect();
    v.sort();
    v
}

pub(super) fn has_backup(r: &FileRoot, rel: &str) -> bool {
    std::fs::read_dir(backup_dir(r, rel))
        .map(|mut rd| rd.any(|e| e.map(|e| e.file_type().map(|t| t.is_file()).unwrap_or(false)).unwrap_or(false)))
        .unwrap_or(false)
}

/// Inhalt als neue Sicherung ablegen und alte über `KEEP_BACKUPS` hinaus löschen.
pub(super) fn add_backup(r: &FileRoot, rel: &str, data: &[u8]) -> AppResult<PathBuf> {
    let dir = backup_dir(r, rel);
    std::fs::create_dir_all(&dir)?;
    // Name `<ms, 13 Stellen>-<lfd. Nr.>`: muss lexikografisch nach allen vorhandenen liegen
    let mut ts = crate::util::now_ms();
    let mut seq = 0u32;
    if let Some(last) = list_backups(r, rel).last().and_then(|p| p.file_name().map(|n| n.to_string_lossy().to_string())) {
        let (lts, lseq) = last.split_once('-').unwrap_or((last.as_str(), "0"));
        if let Ok(lts) = lts.parse::<i64>() {
            if lts >= ts {
                ts = lts;
                seq = lseq.parse::<u32>().unwrap_or(0) + 1;
            }
        }
    }
    let path = dir.join(format!("{ts:013}-{seq:03}"));
    write_atomic(&path, data)?;
    let all = list_backups(r, rel);
    if all.len() > KEEP_BACKUPS {
        for old in &all[..all.len() - KEEP_BACKUPS] {
            let _ = std::fs::remove_file(old);
        }
    }
    Ok(path)
}

/// Sicherungen beim Umbenennen mitnehmen (best effort).
pub(super) fn move_backups(r: &FileRoot, from: &str, to: &str) {
    let src = backup_dir(r, from);
    if !src.is_dir() {
        return;
    }
    let dst = backup_dir(r, to);
    if dst.exists() {
        return;
    }
    if let Some(p) = dst.parent() {
        let _ = std::fs::create_dir_all(p);
    }
    let _ = std::fs::rename(src, dst);
}

pub(super) fn write_atomic(path: &Path, data: &[u8]) -> AppResult<()> {
    let name = path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
    let tmp = path.with_file_name(format!(".{name}{TMP_SUFFIX}"));
    std::fs::write(&tmp, data)?;
    if let Err(e) = std::fs::rename(&tmp, path) {
        let _ = std::fs::remove_file(&tmp);
        return Err(e.into());
    }
    Ok(())
}
