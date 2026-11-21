use super::*;

/// Toleranz für Zeitstempel (FAT/Netzlaufwerke runden auf 2 s).
pub(super) const MTIME_SLACK_MS: i64 = 2_000;
/// Höchstens so viele Dateien je Instanz vergleichen.
pub(super) const MAX_FILES: usize = 200_000;

pub(super) fn mtime_ms(m: &std::fs::Metadata) -> i64 {
    m.modified().ok().and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_millis() as i64).unwrap_or(0)
}

pub(super) fn same_content(a: &Path, b: &Path, size: u64) -> bool {
    use sha1::Digest;
    if size > 8 * 1024 * 1024 {
        return false;
    }
    match (std::fs::read(a), std::fs::read(b)) {
        (Ok(x), Ok(y)) => sha1::Sha1::digest(x) == sha1::Sha1::digest(y),
        _ => false,
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum FileState {
    Same,
    /// fehlt in Vibe, ist neu in der Quelle
    Missing,
    /// fehlt in Vibe, kam aber beim Import mit
    Deleted,
    Newer,
    /// unterschiedlich, Vibe neuer
    Older,
}

pub(super) fn file_state(src: &Path, sm: &std::fs::Metadata, dst: &Path, top: &str, prior: &Prior) -> FileState {
    let Ok(dm) = std::fs::metadata(dst) else {
        return if prior.copied_file(top, sm) { FileState::Deleted } else { FileState::Missing };
    };
    if !dm.is_file() {
        return FileState::Same;
    }
    let (st, dt) = (mtime_ms(sm), mtime_ms(&dm));
    if sm.len() == dm.len() && (st - dt).abs() <= MTIME_SLACK_MS {
        return FileState::Same;
    }
    if sm.len() == dm.len() && same_content(src, dst, sm.len()) {
        return FileState::Same;
    }
    if st > dt + MTIME_SLACK_MS {
        FileState::Newer
    } else {
        FileState::Older
    }
}

/// Dateien unterhalb eines Ordners (Junctions/Symlinks werden mit Zyklusschutz verfolgt, ohne Konten/Tokens).
pub(super) fn walk_files(dir: &Path, budget: &mut usize) -> Vec<(PathBuf, std::fs::Metadata)> {
    srctree::walk(dir, budget).into_iter().map(|(abs, _, m)| (abs, m)).collect()
}

pub(super) fn rel_str(p: &Path) -> String {
    p.to_string_lossy().replace('\\', "/")
}

/// Weltordner? (`level.dat` vorhanden)
pub(super) fn is_world(dir: &Path) -> bool {
    dir.join("level.dat").is_file() || dir.join("level.dat_old").is_file()
}

pub(super) fn world_name(dir: &Path) -> Option<String> {
    let bytes = std::fs::read(dir.join("level.dat")).ok()?;
    let root = crate::content::nbt::parse_maybe_gzip(&bytes).ok()?;
    let data = root.get("Data").cloned().unwrap_or(root);
    data.get("LevelName").and_then(|v| v.as_str()).map(str::to_string).filter(|s| !s.trim().is_empty())
}

/// Top-Level-Einträge der Quelle (samt Overlays), die nachimportiert werden können (sortiert).
pub(super) fn top_entries(src: &Path, ov: &[Overlay], kind: LauncherKind) -> Vec<(String, PathBuf)> {
    srctree::tops(src, ov).into_iter().filter(|n| !skip_top(kind, Purpose::Reimport, n)).filter_map(|n| Some((n.clone(), srctree::locate(src, Path::new(&n), ov)?))).collect()
}

pub(super) fn world_entry(src_world: &Path, dst_world: &Path, rel: String, prior: &Prior, budget: &mut usize) -> Option<DataEntry> {
    let files = walk_files(src_world, budget);
    let size: u64 = files.iter().map(|(_, m)| m.len()).sum();
    let name = world_name(src_world);
    let level = |d: &Path| std::fs::metadata(d.join("level.dat")).or_else(|_| std::fs::metadata(d.join("level.dat_old"))).ok();
    let count = files.len() as u32;
    let (status, default_on) = if !dst_world.exists() {
        let sm = std::fs::metadata(src_world).ok()?;
        if prior.copied_file("saves", &level(src_world).unwrap_or(sm)) {
            (DataStatus::Removed, false)
        } else {
            (DataStatus::Missing, true)
        }
    } else {
        // In der Quelle weitergespielt? (level.dat wird bei jedem Speichern geschrieben)
        let (Some(a), Some(b)) = (level(src_world), level(dst_world)) else { return None };
        if mtime_ms(&a) > mtime_ms(&b) + MTIME_SLACK_MS {
            (DataStatus::Newer, false)
        } else {
            return None;
        }
    };
    let missing = matches!(status, DataStatus::Missing | DataStatus::Removed);
    Some(DataEntry {
        path: rel,
        kind: DataKind::World,
        name,
        status,
        size,
        missing_files: if missing { count } else { 0 },
        missing_size: if missing { size } else { 0 },
        overwrite_files: if missing { 0 } else { count },
        overwrite_size: if missing { 0 } else { size },
        default_on,
    })
}

/// Vergleicht den Spielordner der Quelle mit dem der Vibe-Instanz. Gleiche Einträge fehlen in der Liste.
pub fn scan(src: &Path, ov: &[Overlay], dst: &Path, kind: LauncherKind, prior: &Prior) -> Vec<DataEntry> {
    let mut out = Vec::new();
    let mut worlds = Vec::new();
    let mut budget = MAX_FILES;
    for (name, path) in top_entries(src, ov, kind) {
        let Ok(meta) = std::fs::metadata(&path) else { continue };
        let always = ALWAYS_COMPARE.iter().any(|a| a.eq_ignore_ascii_case(&name));
        if meta.is_dir() && name.eq_ignore_ascii_case("saves") {
            // Welten einzeln (Ordner ohne level.dat werden ignoriert)
            let dirs: Vec<(String, PathBuf)> = srctree::children(src, Path::new(&name), ov)
                .into_iter()
                .filter_map(|f| Some((f.clone(), srctree::locate(src, &Path::new(&name).join(&f), ov)?)))
                .filter(|(_, p)| p.is_dir() && is_world(p))
                .collect();
            for (folder, w) in dirs {
                if let Some(e) = world_entry(&w, &dst.join(&name).join(&folder), format!("{name}/{folder}"), prior, &mut budget) {
                    worlds.push(e);
                }
            }
            continue;
        }
        if meta.is_file() {
            if budget == 0 {
                break;
            }
            budget -= 1;
            let st = file_state(&path, &meta, &dst.join(&name), &name, prior);
            let (status, missing, over) = match st {
                FileState::Same => continue,
                FileState::Older if !always => continue,
                FileState::Missing => (DataStatus::Missing, true, false),
                FileState::Deleted => (DataStatus::Removed, true, false),
                FileState::Newer => (DataStatus::Newer, false, true),
                FileState::Older => (DataStatus::Changed, false, true),
            };
            out.push(DataEntry {
                path: name.clone(),
                kind: DataKind::File,
                name: None,
                status,
                size: meta.len(),
                missing_files: missing as u32,
                missing_size: if missing { meta.len() } else { 0 },
                overwrite_files: over as u32,
                overwrite_size: if over { meta.len() } else { 0 },
                default_on: status == DataStatus::Missing,
            });
            continue;
        }
        if !meta.is_dir() {
            continue;
        }
        let files: Vec<srctree::Entry> = srctree::files(src, Path::new(&name), ov, &mut budget);
        if files.is_empty() {
            continue;
        }
        let dst_exists = dst.join(&name).is_dir();
        let mut e = DataEntry {
            path: name.clone(),
            kind: DataKind::Dir,
            name: None,
            status: DataStatus::Missing,
            size: 0,
            missing_files: 0,
            missing_size: 0,
            overwrite_files: 0,
            overwrite_size: 0,
            default_on: false,
        };
        let mut deleted = (0u32, 0u64);
        for fe in &files {
            let (f, m, rel) = (&fe.abs, &fe.meta, &fe.rel);
            e.size += m.len();
            match file_state(f, m, &dst.join(rel), &name, prior) {
                FileState::Missing => {
                    e.missing_files += 1;
                    e.missing_size += m.len();
                }
                FileState::Deleted => {
                    deleted.0 += 1;
                    deleted.1 += m.len();
                }
                FileState::Newer => {
                    e.overwrite_files += 1;
                    e.overwrite_size += m.len();
                }
                FileState::Older if always => {
                    e.overwrite_files += 1;
                    e.overwrite_size += m.len();
                }
                _ => {}
            }
        }
        if !dst_exists && e.missing_files == 0 && deleted.0 > 0 {
            // Ganzer Ordner in Vibe gelöscht: zum Wiederherstellen anbieten, aber nicht vorauswählen
            e.status = DataStatus::Removed;
            e.missing_files = deleted.0;
            e.missing_size = deleted.1;
        } else if e.missing_files > 0 {
            e.status = if dst_exists { DataStatus::Partial } else { DataStatus::Missing };
            e.default_on = true;
        } else if e.overwrite_files > 0 {
            e.status = if always && !has_newer(&files, dst, &name, prior) { DataStatus::Changed } else { DataStatus::Newer };
        } else {
            continue;
        }
        out.push(e);
    }
    out.extend(worlds);
    out
}

pub(super) fn has_newer(files: &[srctree::Entry], dst: &Path, top: &str, prior: &Prior) -> bool {
    files.iter().any(|e| file_state(&e.abs, &e.meta, &dst.join(&e.rel), top, prior) == FileState::Newer)
}
