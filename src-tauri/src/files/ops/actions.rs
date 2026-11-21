use super::*;

/// Neue leere Datei bzw. neuen Ordner in `dir` anlegen. Liefert den relativen Pfad.
pub fn create(r: &FileRoot, dir: &str, name: &str, is_dir: bool) -> AppResult<String> {
    check_name(name)?;
    let d = r.sandbox.existing(dir, true)?;
    if !d.abs.is_dir() {
        return Err(invalid("Das Ziel ist kein Ordner"));
    }
    let p = r.sandbox.resolve(&join_rel(&d.rel, name), false)?;
    if p.exists {
        return Err(AppError::Invalid(format!("„{name}“ gibt es hier schon")));
    }
    if is_dir {
        std::fs::create_dir(&p.abs)?;
    } else {
        std::fs::OpenOptions::new().write(true).create_new(true).open(&p.abs)?;
    }
    Ok(p.rel)
}

/// Umbenennen (bleibt im selben Ordner). Liefert den neuen relativen Pfad.
pub fn rename(r: &FileRoot, rel: &str, new_name: &str) -> AppResult<String> {
    check_name(new_name)?;
    let from = r.sandbox.existing(rel, false)?;
    let to = r.sandbox.resolve(&join_rel(&from.parent_rel(), new_name), false)?;
    if to.rel == from.rel {
        return Ok(to.rel);
    }
    // Nur Groß-/Kleinschreibung geändert: auf Windows/macOS ist das dieselbe Datei
    let case_only = to.rel.to_lowercase() == from.rel.to_lowercase();
    if to.exists && !case_only {
        return Err(AppError::Invalid(format!("„{new_name}“ gibt es hier schon")));
    }
    std::fs::rename(&from.abs, &to.abs)?;
    move_backups(r, &from.rel, &to.rel);
    Ok(to.rel)
}

/// Freien Namen „name (Kopie).ext“ / „name (Kopie 2).ext“ bzw. für Importe „name (2).ext“ finden.
pub(super) fn free_name(dir_abs: &Path, name: &str, is_dir: bool, copy_label: bool) -> String {
    if !copy_label && std::fs::symlink_metadata(dir_abs.join(name)).is_err() {
        return name.to_string();
    }
    let (stem, ext) = match name.rfind('.') {
        Some(i) if i > 0 && !is_dir => (&name[..i], &name[i..]),
        _ => (name, ""),
    };
    for n in 1..10_000 {
        let tag = match (copy_label, n) {
            (true, 1) => " (Kopie)".to_string(),
            (true, n) => format!(" (Kopie {n})"),
            (false, n) => format!(" ({})", n + 1),
        };
        let cand = format!("{stem}{tag}{ext}");
        if std::fs::symlink_metadata(dir_abs.join(&cand)).is_err() {
            return cand;
        }
    }
    format!("{stem} ({}){ext}", uuid::Uuid::new_v4())
}

/// Kopie neben dem Original. Liefert den relativen Pfad der Kopie.
pub fn duplicate(r: &FileRoot, rel: &str) -> AppResult<String> {
    let src = r.sandbox.existing(rel, false)?;
    let parent = r.sandbox.existing(&src.parent_rel(), true)?;
    let meta = std::fs::metadata(&src.abs)?;
    let name = free_name(&parent.abs, base_name(&src.rel), meta.is_dir(), true);
    let dst = r.sandbox.resolve(&join_rel(&parent.rel, &name), false)?;
    if meta.is_dir() {
        crate::util::copy_dir_all(&src.abs, &dst.abs)?;
    } else {
        std::fs::copy(&src.abs, &dst.abs)?;
    }
    Ok(dst.rel)
}

/// Löschen: in den Papierkorb, oder mit `permanent` endgültig. Klappt der Papierkorb nicht, wird nichts
/// gelöscht und `trash_error` gesetzt (das Frontend fragt dann nach).
pub fn delete(r: &FileRoot, rels: &[String], permanent: bool) -> AppResult<DeleteOutcome> {
    let mut targets = Vec::new();
    for rel in rels {
        targets.push(r.sandbox.existing(rel, false)?);
    }
    // Ordner und darin enthaltene Einträge nicht doppelt löschen
    targets.sort_by_key(|a| a.rel.len());
    let mut uniq: Vec<Resolved> = Vec::new();
    for t in targets {
        if !uniq.iter().any(|u| t.rel == u.rel || t.rel.starts_with(&format!("{}/", u.rel))) {
            uniq.push(t);
        }
    }
    if uniq.is_empty() {
        return Ok(DeleteOutcome { deleted: 0, trashed: false, trash_error: None });
    }
    if !permanent {
        let paths: Vec<PathBuf> = uniq.iter().map(|t| plain(&t.abs)).collect();
        return Ok(match trash::delete_all(&paths) {
            Ok(()) => {
                for t in &uniq {
                    let _ = std::fs::remove_dir_all(backup_dir(r, &t.rel));
                }
                DeleteOutcome { deleted: uniq.len() as u32, trashed: true, trash_error: None }
            }
            Err(e) => {
                tracing::warn!("Papierkorb nicht möglich: {e}");
                // Teilweise verschoben? Dann zählt das, was weg ist
                let gone = uniq.iter().filter(|t| std::fs::symlink_metadata(&t.abs).is_err()).count() as u32;
                DeleteOutcome { deleted: gone, trashed: gone > 0, trash_error: Some(e.to_string()) }
            }
        });
    }
    let mut n = 0;
    for t in &uniq {
        let m = std::fs::symlink_metadata(&t.abs)?;
        if m.is_dir() {
            std::fs::remove_dir_all(&t.abs)?;
        } else {
            std::fs::remove_file(&t.abs)?;
        }
        let _ = std::fs::remove_dir_all(backup_dir(r, &t.rel));
        n += 1;
    }
    Ok(DeleteOutcome { deleted: n, trashed: false, trash_error: None })
}

/// Externe Dateien/Ordner (absolute Pfade, z. B. per Drag & Drop) nach `dir` kopieren. Vorhandene Namen
/// werden nicht überschrieben („name (2).ext“). Liefert die neuen relativen Pfade.
pub fn import(r: &FileRoot, dir: &str, sources: &[String]) -> AppResult<Vec<String>> {
    let d = r.sandbox.existing(dir, true)?;
    if !d.abs.is_dir() {
        return Err(invalid("Das Ziel ist kein Ordner"));
    }
    let target_canon = d.abs.canonicalize()?;
    let mut out = Vec::new();
    for s in sources {
        let src = PathBuf::from(s);
        if !src.is_absolute() {
            return Err(invalid("Quelle muss ein absoluter Pfad sein"));
        }
        let meta = std::fs::metadata(&src).map_err(|_| AppError::NotFound(s.clone()))?;
        let name = src.file_name().map(|n| n.to_string_lossy().to_string()).ok_or_else(|| invalid("Ungültige Quelle"))?;
        check_name(&name)?;
        if meta.is_dir() {
            // Ordner nicht in sich selbst kopieren
            let sc = src.canonicalize()?;
            if target_canon.starts_with(&sc) {
                return Err(invalid("Ein Ordner kann nicht in sich selbst kopiert werden"));
            }
        }
        let fname = free_name(&d.abs, &name, meta.is_dir(), false);
        let dst = r.sandbox.resolve(&join_rel(&d.rel, &fname), false)?;
        if meta.is_dir() {
            crate::util::copy_dir_all(&src, &dst.abs)?;
        } else {
            std::fs::copy(&src, &dst.abs)?;
        }
        out.push(dst.rel);
    }
    Ok(out)
}

/// Absoluter Pfad in normaler Schreibweise (zum Kopieren/Anzeigen).
pub fn abs_path(r: &FileRoot, rel: &str) -> AppResult<PathBuf> {
    let p = r.sandbox.existing(rel, true)?;
    Ok(plain(&p.abs))
}
