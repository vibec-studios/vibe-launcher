use super::*;

// ------------------------------------------------------------------ Nachkopieren

/// Eine Kopieraktion.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CopyOp {
    pub from: PathBuf,
    /// relativ zum Spielordner
    pub rel: PathBuf,
    pub size: u64,
    /// ersetzt eine vorhandene Datei
    pub replace: bool,
}

#[derive(Debug, Clone, Default)]
pub struct CopyPlan {
    pub ops: Vec<CopyOp>,
    /// Welten (Ordnername in `saves/`), die komplett ersetzt werden – vorher Welt-Backup
    pub replace_worlds: Vec<String>,
}

impl CopyPlan {
    pub fn is_empty(&self) -> bool {
        self.ops.is_empty()
    }
    pub fn total(&self) -> u64 {
        self.ops.iter().map(|o| o.size).sum()
    }
    /// Berührt der Plan Bereiche, die ein Snapshot sichert (Configs, Packs, Optionen)?
    pub fn touches_snapshot(&self) -> bool {
        self.ops.iter().any(|o| {
            let top = o.rel.components().next().map(|c| c.as_os_str().to_string_lossy().to_string()).unwrap_or_default();
            crate::content::snapshots::DIRS.iter().chain(crate::content::snapshots::FILES).any(|d| d.eq_ignore_ascii_case(&top))
        })
    }
}

/// Gewählte Einträge in Kopieraktionen übersetzen (frisch gegen den aktuellen Stand geprüft).
/// Nur Einträge, die [`scan`] anbietet; Pfade außerhalb des Spielordners werden verworfen.
pub fn plan(src: &Path, ov: &[Overlay], dst: &Path, kind: LauncherKind, prior: &Prior, picks: &[DataPick]) -> CopyPlan {
    let offered: Vec<DataEntry> = scan(src, ov, dst, kind, prior);
    let mut plan = CopyPlan::default();
    let mut seen = HashSet::new();
    let mut budget = MAX_FILES;
    for p in picks {
        let Some(e) = offered.iter().find(|e| e.path == p.path) else { continue };
        if !seen.insert(e.path.clone()) {
            continue;
        }
        let rel = PathBuf::from(&e.path);
        let top = rel.components().next().map(|c| c.as_os_str().to_string_lossy().to_string()).unwrap_or_default();
        let always = ALWAYS_COMPARE.iter().any(|a| a.eq_ignore_ascii_case(&top));
        match e.kind {
            DataKind::World => {
                let exists = dst.join(&rel).exists();
                if exists && !p.overwrite {
                    continue;
                }
                if exists {
                    plan.replace_worlds.push(rel.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default());
                }
                for f in srctree::files(src, &rel, ov, &mut budget) {
                    plan.ops.push(CopyOp { size: f.meta.len(), from: f.abs, rel: f.rel, replace: false });
                }
            }
            DataKind::File | DataKind::Dir => {
                let restore = e.status == DataStatus::Removed;
                for fe in srctree::files(src, &rel, ov, &mut budget) {
                    let (f, m, r) = (fe.abs, fe.meta, fe.rel);
                    let st = file_state(&f, &m, &dst.join(&r), &top, prior);
                    let (take, replace) = match st {
                        FileState::Missing => (true, false),
                        FileState::Deleted => (restore, false),
                        FileState::Newer => (p.overwrite, true),
                        FileState::Older => (p.overwrite && always, true),
                        FileState::Same => (false, false),
                    };
                    if take {
                        plan.ops.push(CopyOp { from: f, rel: r, size: m.len(), replace });
                    }
                }
            }
        }
    }
    plan
}

/// Plan ausführen. Ersetzte Dateien außerhalb der Snapshot-Bereiche und außerhalb ersetzter Welten werden vorher
/// nach `keep` gesichert (gleiche relative Pfade). Welten in `replace_worlds` werden vorher geleert
/// (Welt-Backup macht der Aufrufer). `on_progress(kopierte Bytes)`; `check` bricht ab.
pub fn execute(
    plan: &CopyPlan,
    dst: &Path,
    keep: &Path,
    mut on_progress: impl FnMut(u64),
    check: impl Fn() -> crate::error::AppResult<()>,
) -> crate::error::AppResult<u32> {
    use crate::error::AppError;
    let in_snapshot = |rel: &Path| {
        let top = rel.components().next().map(|c| c.as_os_str().to_string_lossy().to_string()).unwrap_or_default();
        crate::content::snapshots::DIRS.iter().chain(crate::content::snapshots::FILES).any(|d| d.eq_ignore_ascii_case(&top))
    };
    for w in &plan.replace_worlds {
        if w.is_empty() || w.contains(['/', '\\']) || w == ".." {
            continue;
        }
        let d = dst.join("saves").join(w);
        if d.is_dir() {
            std::fs::remove_dir_all(&d).map_err(|e| AppError::msg(format!("Welt {w} konnte nicht ersetzt werden: {e}")))?;
        }
    }
    let mut done = 0u64;
    let mut n = 0u32;
    for (i, op) in plan.ops.iter().enumerate() {
        if i % 32 == 0 {
            check()?;
        }
        // Nur innerhalb des Spielordners schreiben
        if op.rel.is_absolute() || op.rel.components().any(|c| matches!(c, std::path::Component::ParentDir | std::path::Component::Prefix(_) | std::path::Component::RootDir)) {
            continue;
        }
        let to = dst.join(&op.rel);
        if op.replace && to.is_file() && !in_snapshot(&op.rel) {
            let b = keep.join(&op.rel);
            if let Some(p) = b.parent() {
                std::fs::create_dir_all(p)?;
            }
            std::fs::copy(&to, &b).map_err(|e| AppError::msg(format!("{} konnte nicht gesichert werden: {e}", op.rel.display())))?;
        }
        if let Some(p) = to.parent() {
            std::fs::create_dir_all(p)?;
        }
        std::fs::copy(&op.from, &to).map_err(|e| AppError::msg(format!("{} konnte nicht kopiert werden: {e}", rel_str(&op.rel))))?;
        done += op.size;
        n += 1;
        on_progress(done);
    }
    Ok(n)
}

/// Namen der obersten Ebene, die ein Import übernommen hat (für `external.json`).
pub fn top_names<'a>(rels: impl Iterator<Item = &'a Path>) -> Vec<String> {
    let mut v: Vec<String> = rels.filter_map(|r| r.components().next()).map(|c| c.as_os_str().to_string_lossy().to_string()).collect();
    v.sort_by_key(|s| s.to_lowercase());
    v.dedup_by(|a, b| a.eq_ignore_ascii_case(b));
    v
}
