use super::*;

/// Marker der allerersten Sicherung eines Kanals.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BackupMarker {
    pub path: PathBuf,
    pub created: i64,
    pub size: u64,
    pub slots: Vec<String>,
}

/// Ordner rekursiv kopieren, Fortschritt in Bytes, abbrechbar.
pub fn copy_tree(src: &Path, dst: &Path, on_bytes: &dyn Fn(u64), cancelled: &dyn Fn() -> bool) -> AppResult<()> {
    std::fs::create_dir_all(dst)?;
    for entry in walkdir::WalkDir::new(src).min_depth(1) {
        if cancelled() {
            return Err(AppError::Cancelled);
        }
        let entry = entry.map_err(|e| AppError::msg(e.to_string()))?;
        let rel = entry.path().strip_prefix(src).map_err(|e| AppError::msg(e.to_string()))?;
        let to = dst.join(rel);
        if entry.file_type().is_dir() {
            std::fs::create_dir_all(&to)?;
        } else if entry.file_type().is_file() {
            if let Some(p) = to.parent() {
                std::fs::create_dir_all(p)?;
            }
            let n = std::fs::copy(entry.path(), &to)?;
            on_bytes(n);
        }
    }
    Ok(())
}

/// Alle Slots von `base` nach `dest` kopieren: erst nach `<dest>.partial`, dann umbenennen –
/// ein halb fertiges Ergebnis ist so immer als solches erkennbar.
pub fn copy_slots(base: &Path, layout: Layout, dest: &Path, on_bytes: &dyn Fn(u64), cancelled: &dyn Fn() -> bool) -> AppResult<Vec<String>> {
    let slots = layout.slots(base);
    let partial = dest.with_extension("partial");
    if partial.exists() {
        std::fs::remove_dir_all(&partial)?;
    }
    let r = (|| {
        for s in &slots {
            copy_tree(&slot_path(base, s), &slot_path(&partial, s), on_bytes, cancelled)?;
        }
        Ok::<_, AppError>(())
    })();
    if let Err(e) = r {
        let _ = std::fs::remove_dir_all(&partial);
        return Err(e);
    }
    std::fs::create_dir_all(&partial)?;
    if let Some(p) = dest.parent() {
        std::fs::create_dir_all(p)?;
    }
    std::fs::rename(&partial, dest)?;
    Ok(slots)
}

/// Vollständige Sicherung der Nutzerdaten vor dem allerersten Tausch eines Kanals (einmalig).
/// Gibt den Sicherungsordner zurück, falls jetzt eine angelegt wurde.
pub fn ensure_initial_backup(
    base: &Path,
    layout: Layout,
    backups: &Path,
    marker: &Path,
    on_bytes: &dyn Fn(u64),
    cancelled: &dyn Fn() -> bool,
) -> AppResult<Option<PathBuf>> {
    if marker.exists() {
        return Ok(None);
    }
    let stamp = chrono::Local::now().format("%Y-%m-%d_%H-%M-%S").to_string();
    let dest = backups.join(format!("erste-sicherung-{stamp}"));
    let slots = copy_slots(base, layout, &dest, on_bytes, cancelled)?;
    let m = BackupMarker { size: super::super::dir_size(&dest), path: dest.clone(), created: crate::util::now_ms(), slots };
    crate::util::write_json_atomic(marker, &m)?;
    Ok(Some(dest))
}
