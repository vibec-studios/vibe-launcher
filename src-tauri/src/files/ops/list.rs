use super::*;

pub(super) fn entry_for(r: &FileRoot, rel: String, abs: &Path, meta: &std::fs::Metadata) -> FileEntry {
    let is_dir = meta.is_dir();
    let children = if is_dir {
        std::fs::read_dir(abs).ok().map(|rd| {
            rd.flatten()
                .filter(|e| !e.file_name().to_string_lossy().ends_with(TMP_SUFFIX))
                .filter(|e| !(rel.is_empty() && r.sandbox.is_hidden_top(&e.file_name().to_string_lossy())))
                .count() as u32
        })
    } else {
        None
    };
    FileEntry {
        name: base_name(&rel).to_string(),
        kind: if is_dir { "dir" } else { kind_of(&rel, abs, meta.len()) },
        has_backup: !is_dir && has_backup(r, &rel),
        size: if is_dir { 0 } else { meta.len() },
        modified: mtime_ms(meta),
        children,
        is_dir,
        path: rel,
    }
}

/// Direkte Einträge eines Ordners (leer = Wurzel). Symlinks, tmp-Dateien und geschützte Einträge fehlen.
pub fn list_dir(r: &FileRoot, dir: &str) -> AppResult<Vec<FileEntry>> {
    if !r.sandbox.root.exists() {
        return Ok(Vec::new());
    }
    let d = r.sandbox.existing(dir, true)?;
    if !d.abs.is_dir() {
        return Err(invalid("Das ist kein Ordner"));
    }
    let mut out = Vec::new();
    for e in std::fs::read_dir(&d.abs)?.flatten() {
        let name = e.file_name().to_string_lossy().to_string();
        if name.ends_with(TMP_SUFFIX) || (d.is_root() && r.sandbox.is_hidden_top(&name)) {
            continue;
        }
        let Ok(meta) = std::fs::symlink_metadata(e.path()) else { continue };
        if is_link(&meta) {
            continue;
        }
        out.push(entry_for(r, join_rel(&d.rel, &name), &e.path(), &meta));
    }
    out.sort_by(|a, b| b.is_dir.cmp(&a.is_dir).then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase())));
    Ok(out)
}

/// Einzelner Eintrag (für die Kopfzeile / nach Aktionen).
pub fn stat(r: &FileRoot, rel: &str) -> AppResult<FileEntry> {
    let p = r.sandbox.existing(rel, true)?;
    let meta = std::fs::symlink_metadata(&p.abs)?;
    Ok(entry_for(r, p.rel.clone(), &p.abs, &meta))
}

/// Alle Einträge unterhalb der Wurzel durchlaufen (ohne Symlinks/geschützte Einträge/tmp-Dateien).
pub(super) fn walk(r: &FileRoot, mut f: impl FnMut(&str, &walkdir::DirEntry) -> bool) -> AppResult<bool> {
    if !r.sandbox.root.exists() {
        return Ok(false);
    }
    let root = r.sandbox.canon_root()?;
    let mut seen = 0usize;
    let it = walkdir::WalkDir::new(&root).min_depth(1).follow_links(false).sort_by_file_name().into_iter().filter_entry(|e| {
        let name = e.file_name().to_string_lossy();
        if e.path_is_symlink() || name.ends_with(TMP_SUFFIX) {
            return false;
        }
        if e.depth() == 1 && r.sandbox.is_hidden_top(&name) {
            return false;
        }
        // Junctions (Windows) wie Symlinks behandeln
        e.metadata().map(|m| !is_link(&m)).unwrap_or(false)
    });
    for e in it.flatten() {
        seen += 1;
        if seen > MAX_WALK {
            return Ok(true);
        }
        let Some(rel) = r.sandbox.rel_of(&root, e.path()) else { continue };
        if !f(&rel, &e) {
            return Ok(true);
        }
    }
    Ok(false)
}

/// Dateien/Ordner, deren Name die Suche enthält (ohne Groß-/Kleinschreibung).
pub fn find(r: &FileRoot, query: &str) -> AppResult<FindResult> {
    let q = query.trim().to_lowercase();
    let mut entries = Vec::new();
    if q.is_empty() {
        return Ok(FindResult { entries, truncated: false });
    }
    let mut truncated = walk(r, |rel, e| {
        if e.file_name().to_string_lossy().to_lowercase().contains(&q) {
            if let Ok(meta) = e.metadata() {
                entries.push(entry_for(r, rel.to_string(), e.path(), &meta));
            }
        }
        entries.len() < MAX_FIND
    })?;
    truncated |= entries.len() >= MAX_FIND;
    Ok(FindResult { entries, truncated })
}

/// Volltextsuche (ohne Groß-/Kleinschreibung) in Textdateien bis `SEARCH_MAX_FILE`, optional nur unter `dir`.
pub fn search(r: &FileRoot, query: &str, dir: Option<&str>) -> AppResult<SearchResult> {
    let q = query.trim().to_lowercase();
    let mut res = SearchResult { hits: Vec::new(), truncated: false, files_scanned: 0, files_skipped: 0 };
    if q.is_empty() {
        return Ok(res);
    }
    let prefix = match dir.map(str::trim).filter(|d| !d.is_empty()) {
        Some(d) => Some(format!("{}/", r.sandbox.existing(d, false)?.rel)),
        None => None,
    };
    let mut total = 0u64;
    let mut stop = false;
    let walked = walk(r, |rel, e| {
        if !e.file_type().is_file() || prefix.as_ref().is_some_and(|p| !rel.starts_with(p.as_str())) {
            return true;
        }
        let Ok(meta) = e.metadata() else { return true };
        if kind_of(rel, e.path(), meta.len()) != "text" {
            return true;
        }
        if meta.len() > SEARCH_MAX_FILE {
            res.files_skipped += 1;
            return true;
        }
        total += meta.len();
        if total > SEARCH_MAX_TOTAL {
            stop = true;
            return false;
        }
        let Ok(bytes) = std::fs::read(e.path()) else { return true };
        res.files_scanned += 1;
        let text = String::from_utf8_lossy(&bytes);
        for (i, line) in text.lines().enumerate() {
            if line.to_lowercase().contains(&q) {
                let t = line.trim().trim_start_matches(BOM);
                let t: String = if t.chars().count() > 200 { t.chars().take(200).chain("…".chars()).collect() } else { t.to_string() };
                res.hits.push(SearchHit { path: rel.to_string(), line: i as u32 + 1, text: t });
                if res.hits.len() >= MAX_HITS {
                    stop = true;
                    return false;
                }
            }
        }
        true
    })?;
    res.truncated = walked || stop;
    Ok(res)
}
