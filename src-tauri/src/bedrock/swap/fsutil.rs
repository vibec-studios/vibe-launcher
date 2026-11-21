use super::*;

pub(super) fn rename_retry(from: &Path, to: &Path) -> std::io::Result<()> {
    let mut wait = 40;
    for _ in 0..5 {
        match std::fs::rename(from, to) {
            Err(e) if matches!(e.raw_os_error(), Some(5) | Some(32)) => {
                std::thread::sleep(std::time::Duration::from_millis(wait));
                wait *= 2;
            }
            r => return r,
        }
    }
    std::fs::rename(from, to)
}

/// Ordner verschieben (gleiches Laufwerk -> atomar). Legt den Elternordner an.
pub(super) fn mv(from: &Path, to: &Path) -> AppResult<()> {
    crash_point()?;
    if let Some(p) = to.parent() {
        std::fs::create_dir_all(p)?;
    }
    rename_retry(from, to).map_err(|e| {
        // 17 = ERROR_NOT_SAME_DEVICE (Windows), 18 = EXDEV (Unix)
        if matches!(e.raw_os_error(), Some(17) | Some(18)) {
            AppError::msg("Der Launcher-Datenordner liegt auf einem anderen Laufwerk als Minecraft Bedrock. Für eigene Profile müssen beide auf demselben Laufwerk liegen – oder nutze „Gemeinsames Profil“.")
        } else if super::super::issues::is_lock_error(&e) {
            super::super::issues::locked_error(from)
        } else {
            AppError::msg(format!("{from:?} -> {to:?} verschieben: {e}"))
        }
    })
}

pub(super) fn is_empty_dir(p: &Path) -> bool {
    std::fs::read_dir(p).map(|mut r| r.next().is_none()).unwrap_or(false)
}

/// Leere Ordner unter `root` (inkl. `root`) entfernen – nur wirklich leere, nie Dateien.
pub(super) fn remove_empty_dirs(root: &Path) {
    let dirs: Vec<PathBuf> = walkdir::WalkDir::new(root).contents_first(true).into_iter().flatten().filter(|e| e.file_type().is_dir()).map(|e| e.into_path()).collect();
    for d in dirs {
        let _ = std::fs::remove_dir(&d); // schlägt bei nicht leeren Ordnern fehl – gewollt
    }
}

/// Nächster vorhandener Vorfahr (für Laufwerksvergleich noch nicht angelegter Ordner).
pub(super) fn existing_ancestor(p: &Path) -> Option<PathBuf> {
    let mut cur = Some(p);
    while let Some(c) = cur {
        if c.exists() {
            return c.canonicalize().ok();
        }
        cur = c.parent();
    }
    None
}

#[cfg(windows)]
pub(super) fn volume_of(p: &Path) -> Option<String> {
    let c = existing_ancestor(p)?;
    c.components().next().map(|c| c.as_os_str().to_string_lossy().to_lowercase())
}

#[cfg(unix)]
pub(super) fn volume_of(p: &Path) -> Option<String> {
    use std::os::unix::fs::MetadataExt;
    let c = existing_ancestor(p)?;
    std::fs::metadata(c).ok().map(|m| m.dev().to_string())
}

/// Beide Orte müssen auf demselben Laufwerk liegen, sonst wäre `rename` kein atomares Verschieben.
pub fn check_same_volume(a: &Path, b: &Path) -> AppResult<()> {
    match (volume_of(a), volume_of(b)) {
        (Some(x), Some(y)) if x != y => Err(AppError::Invalid(
            "Der Launcher-Datenordner liegt auf einem anderen Laufwerk als Minecraft Bedrock. Für eigene Profile müssen beide auf demselben Laufwerk liegen – oder nutze „Gemeinsames Profil“.".into(),
        )),
        _ => Ok(()),
    }
}
