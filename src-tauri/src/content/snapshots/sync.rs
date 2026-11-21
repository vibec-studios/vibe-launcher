use super::*;

// ------------------------------------------------------------------ Kernabläufe (blockierend)

#[cfg(test)]
#[allow(clippy::too_many_arguments)]
pub(super) fn create_sync(root: &Path, instance_id: &str, game: &Path, inst: &Path, name: &str, auto: bool, sel: &Sel, prog: &impl Prog) -> AppResult<Manifest> {
    create_with_version(root, instance_id, game, inst, name, auto, sel, prog, None)
}

#[allow(clippy::too_many_arguments)]
pub(super) fn create_with_version(root: &Path, instance_id: &str, game: &Path, inst: &Path, name: &str, auto: bool, sel: &Sel, prog: &impl Prog, migration: Option<MigrationState>) -> AppResult<Manifest> {
    prog.message("Dateien werden erfasst …");
    let found = scan(game, inst, sel)?;
    let total: u64 = found.files.iter().map(|f| f.2).sum::<u64>() + found.meta.iter().map(|f| f.2).sum::<u64>();
    let mut done = 0u64;
    let mut cache = load_cache(root, instance_id);
    let mut files = Vec::with_capacity(found.files.len());
    prog.message("Snapshot wird erstellt …");
    for (rel, path, size, mtime) in &found.files {
        prog.check()?;
        let sha1 = hash_cached(&mut cache, rel, path, *size, *mtime)?;
        store_object(root, path, &sha1, *size, linkable(rel)).map_err(|e| AppError::msg(format!("{rel} konnte nicht gesichert werden: {e}")))?;
        files.push(FileEntry { rel_path: rel.clone(), sha1, size: *size });
        done += size;
        if total > 0 {
            prog.set(done as f64 / total as f64);
        }
    }
    let mut meta = Vec::new();
    for (rel, path, size) in &found.meta {
        prog.check()?;
        let sha1 = crate::net::sha1_file(path).map_err(|e| AppError::msg(format!("{rel} nicht lesbar: {e}")))?;
        store_object(root, path, &sha1, *size, false).map_err(|e| AppError::msg(format!("{rel} konnte nicht gesichert werden: {e}")))?;
        meta.push(FileEntry { rel_path: rel.clone(), sha1, size: *size });
        done += size;
    }
    let created = crate::util::now_ms();
    let id = format!("{created}-{}", &uuid::Uuid::new_v4().simple().to_string()[..6]);
    let name = name.trim();
    let name = if name.is_empty() { format!("Snapshot vom {}", chrono::Local::now().format("%d.%m.%Y %H:%M")) } else { name.chars().take(80).collect() };
    let m = Manifest { version: 1, id: id.clone(), name, created, auto, files, dirs: found.dirs, meta, scopes: sel.scopes(), migration };
    crate::util::write_json_atomic(&snapshot_dir(root, instance_id).join(format!("{id}.json")), &m)?;
    save_cache(root, instance_id, &cache);
    prog.set(1.0);
    Ok(m)
}

/// Spielordner/Metadaten exakt auf den Stand des Manifests bringen – nur in den Bereichen des Manifests.
pub(crate) fn restore_sync(root: &Path, instance_id: &str, game: &Path, inst: &Path, m: &Manifest, prog: &impl Prog) -> AppResult<()> {
    verify(root, m)?;
    let sel = m.sel();
    let found = scan(game, inst, &sel)?;
    let want: HashMap<&str, &FileEntry> = m.files.iter().map(|f| (f.rel_path.as_str(), f)).collect();
    let want_dirs: HashSet<&str> = m.dirs.iter().map(String::as_str).collect();
    let io = |rel: &str, e: std::io::Error| AppError::msg(format!("{rel} konnte nicht wiederhergestellt werden (läuft das Spiel noch?): {e}"));

    // 1. Überzählige Dateien und Ordner entfernen
    prog.message("Dateien werden abgeglichen …");
    let mut current: HashMap<String, (PathBuf, u64, i64)> = HashMap::new();
    for (rel, path, size, mtime) in found.files {
        if want.contains_key(rel.as_str()) {
            current.insert(rel, (path, size, mtime));
        } else {
            std::fs::remove_file(&path).map_err(|e| io(&rel, e))?;
        }
    }
    let mut extra_dirs: Vec<&String> = found.dirs.iter().filter(|d| !want_dirs.contains(d.as_str())).collect();
    extra_dirs.sort_by_key(|d| std::cmp::Reverse(d.matches('/').count()));
    for d in extra_dirs {
        let p = game.join(d);
        if p.is_dir() {
            std::fs::remove_dir_all(&p).map_err(|e| io(d, e))?;
        }
    }

    // 2. Fehlende/geänderte Dateien schreiben
    let mut cache = load_cache(root, instance_id);
    let total: u64 = m.files.iter().map(|f| f.size).sum::<u64>().max(1);
    let mut done = 0u64;
    prog.message("Dateien werden wiederhergestellt …");
    for f in &m.files {
        let target = crate::util::safe_join(game, &f.rel_path).ok_or_else(|| AppError::Invalid(format!("Unsicherer Pfad im Snapshot: {}", f.rel_path)))?;
        let same = match current.get(&f.rel_path) {
            Some((path, size, mtime)) if *size == f.size => hash_cached(&mut cache, &f.rel_path, path, *size, *mtime).is_ok_and(|h| h == f.sha1),
            _ => false,
        };
        if !same {
            if target.is_dir() {
                std::fs::remove_dir_all(&target).map_err(|e| io(&f.rel_path, e))?;
            }
            place_object(&object_path(root, &f.sha1), &target, linkable(&f.rel_path)).map_err(|e| io(&f.rel_path, e))?;
            if linkable(&f.rel_path) {
                if let Ok(md) = std::fs::metadata(&target) {
                    cache.insert(f.rel_path.clone(), (md.len(), mtime_ms(&md), f.sha1.clone()));
                }
            }
        }
        done += f.size;
        prog.set(done as f64 / total as f64);
    }
    // 3. Leere Ordner aus dem Snapshot anlegen
    for d in &m.dirs {
        if let Some(p) = crate::util::safe_join(game, d) {
            std::fs::create_dir_all(&p).map_err(|e| io(d, e))?;
        }
    }
    // 4. Metadaten der Instanz (nur die zum Bereich gehörenden)
    let want_meta: HashMap<&str, &FileEntry> = m.meta.iter().map(|f| (f.rel_path.as_str(), f)).collect();
    for name in sel.meta() {
        let target = inst.join(name);
        if name == "content.json" && !sel.is_all() {
            // Teil-Snapshot: nur die Einträge der enthaltenen Ordner zurücksetzen
            let snap = match want_meta.get(name) {
                Some(f) => Some(std::fs::read(object_path(root, &f.sha1)).map_err(|e| io(name, e))?),
                None => None,
            };
            let cur = std::fs::read(&target).ok();
            let merged = merge_index(cur.as_deref(), snap.as_deref(), &sel.content_prefixes());
            write_atomic(&target, &merged).map_err(|e| io(name, e))?;
            continue;
        }
        match want_meta.get(name) {
            Some(f) => place_object(&object_path(root, &f.sha1), &target, false).map_err(|e| io(name, e))?,
            None if target.is_file() => std::fs::remove_file(&target).map_err(|e| io(name, e))?,
            None => {}
        }
    }
    save_cache(root, instance_id, &cache);
    prog.set(1.0);
    Ok(())
}

/// Älteste automatische Snapshots über der Grenze löschen (außer `protect`).
pub(crate) fn prune_auto(root: &Path, instance_id: &str, keep: u32, protect: &[&str]) -> AppResult<usize> {
    let keep = keep.max(1) as usize;
    let autos: Vec<Manifest> = manifests(root, instance_id).into_iter().filter(|m| m.auto).collect();
    let mut removed = 0;
    for m in autos.iter().skip(keep) {
        if protect.contains(&m.id.as_str()) {
            continue;
        }
        std::fs::remove_file(snapshot_dir(root, instance_id).join(format!("{}.json", m.id)))?;
        removed += 1;
    }
    if removed > 0 {
        gc(root)?;
    }
    Ok(removed)
}

/// Objekte löschen, auf die kein Manifest mehr verweist. Bricht ab (ohne zu löschen), wenn ein
/// Manifest unlesbar ist.
pub(crate) fn gc(root: &Path) -> AppResult<usize> {
    let mut used: HashSet<String> = HashSet::new();
    if let Ok(rd) = std::fs::read_dir(root.join("snapshots")) {
        for inst in rd.flatten().filter(|e| e.path().is_dir()) {
            for e in std::fs::read_dir(inst.path())?.flatten() {
                let p = e.path();
                if p.extension().is_some_and(|x| x == "json") {
                    let m = read_manifest(&p).map_err(|e| AppError::msg(format!("Aufräumen übersprungen, Manifest {p:?} unlesbar: {e}")))?;
                    used.extend(m.files.into_iter().chain(m.meta).map(|f| f.sha1));
                }
            }
        }
    }
    let mut removed = 0;
    let objects = root.join("objects");
    if !objects.is_dir() {
        return Ok(0);
    }
    for e in walkdir::WalkDir::new(&objects).min_depth(2).max_depth(2).into_iter().flatten() {
        if !e.file_type().is_file() {
            continue;
        }
        let name = e.file_name().to_string_lossy();
        if !used.contains(name.as_ref()) && std::fs::remove_file(e.path()).is_ok() {
            removed += 1;
        }
    }
    // Leere Präfix-Ordner entfernen
    if let Ok(rd) = std::fs::read_dir(&objects) {
        for e in rd.flatten() {
            let _ = std::fs::remove_dir(e.path());
        }
    }
    Ok(removed)
}
