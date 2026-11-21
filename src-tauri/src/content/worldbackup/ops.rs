use super::*;

pub(super) fn world_name(dir: &Path, folder: &str) -> String {
    crate::content::worlds::read_world(dir).map(|w| w.name).unwrap_or_else(|| folder.to_string())
}

// ------------------------------------------------------------------ Kernabläufe (blockierend)

pub(super) fn stamp(dir: &Path) -> String {
    let base = chrono::Local::now().format("%Y-%m-%d_%H-%M-%S").to_string();
    if !dir.join(format!("{base}.zip")).exists() {
        return base;
    }
    (2..).map(|n| format!("{base}_{n}")).find(|s| !dir.join(format!("{s}.zip")).exists()).unwrap_or(base)
}

pub(super) fn backup_sync(paths: &Paths, instance_id: &str, folder: &str, auto: bool, prog: &impl Prog) -> AppResult<WorldBackup> {
    check_folder(folder)?;
    let dir = saves(paths, instance_id).join(folder);
    if !dir.join("level.dat").is_file() {
        return Err(AppError::NotFound(format!("Welt {folder}")));
    }
    let name = world_name(&dir, folder);
    prog.message(&format!("„{name}“ wird gesichert …"));
    let fp = fingerprint(&dir)?;
    let out_dir = worlds_root(paths, instance_id).join(folder);
    std::fs::create_dir_all(&out_dir)?;
    let st = stamp(&out_dir);
    let zip = out_dir.join(format!("{st}.zip"));
    let size = zip_dir(&dir, folder, &zip, prog)?;
    let created = crate::util::now_ms();
    let side = Sidecar { world_name: name.clone(), created, size, auto, fingerprint: fp };
    crate::util::write_json_atomic(&out_dir.join(format!("{st}.json")), &side)?;
    Ok(WorldBackup { id: format!("{folder}/{st}"), folder: folder.to_string(), world_name: name, created, size, auto })
}

pub(super) fn read_backup(folder: &str, zip: &Path) -> Option<(WorldBackup, String)> {
    let stem = zip.file_stem()?.to_string_lossy().to_string();
    let side: Option<Sidecar> = std::fs::read(zip.with_extension("json")).ok().and_then(|b| serde_json::from_slice(&b).ok());
    let md = std::fs::metadata(zip).ok()?;
    let (name, created, auto, fp) = match side {
        Some(s) => (s.world_name, s.created, s.auto, s.fingerprint),
        None => {
            let t = md.modified().ok().and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_millis() as i64).unwrap_or(0);
            (folder.to_string(), t, false, String::new())
        }
    };
    Some((WorldBackup { id: format!("{folder}/{stem}"), folder: folder.to_string(), world_name: name, created, size: md.len(), auto }, fp))
}

/// Backups einer Welt, neueste zuerst (mit Fingerabdruck).
pub(super) fn list_world(paths: &Paths, instance_id: &str, folder: &str) -> Vec<(WorldBackup, String)> {
    let Ok(rd) = std::fs::read_dir(worlds_root(paths, instance_id).join(folder)) else { return vec![] };
    let mut v: Vec<_> = rd.flatten().map(|e| e.path()).filter(|p| p.extension().is_some_and(|e| e == "zip")).filter_map(|p| read_backup(folder, &p)).collect();
    v.sort_by(|a, b| b.0.created.cmp(&a.0.created).then(b.0.id.cmp(&a.0.id)));
    v
}

pub(super) fn list_sync(paths: &Paths, instance_id: &str) -> Vec<WorldBackup> {
    let Ok(rd) = std::fs::read_dir(worlds_root(paths, instance_id)) else { return vec![] };
    let mut v: Vec<WorldBackup> = rd
        .flatten()
        .filter(|e| e.path().is_dir())
        .flat_map(|e| list_world(paths, instance_id, &e.file_name().to_string_lossy()))
        .map(|(b, _)| b)
        .collect();
    v.sort_by(|a, b| b.created.cmp(&a.created).then(b.id.cmp(&a.id)));
    v
}

pub(super) fn delete_sync(paths: &Paths, instance_id: &str, id: &str) -> AppResult<()> {
    let (folder, st) = parse_id(id)?;
    let dir = worlds_root(paths, instance_id).join(folder);
    let zip = dir.join(format!("{st}.zip"));
    if !zip.is_file() {
        return Err(AppError::NotFound("Welt-Backup".into()));
    }
    std::fs::remove_file(&zip)?;
    let _ = std::fs::remove_file(dir.join(format!("{st}.json")));
    let _ = std::fs::remove_dir(&dir); // nur wenn leer
    Ok(())
}

/// Älteste automatische Backups einer Welt über der Grenze löschen.
pub(super) fn prune(paths: &Paths, instance_id: &str, folder: &str, keep: u32, protect: &[&str]) -> usize {
    let keep = keep.max(1) as usize;
    let mut removed = 0;
    for (b, _) in list_world(paths, instance_id, folder).into_iter().filter(|(b, _)| b.auto).skip(keep) {
        if protect.contains(&b.id.as_str()) {
            continue;
        }
        if delete_sync(paths, instance_id, &b.id).is_ok() {
            removed += 1;
        }
    }
    removed
}

pub(super) fn restore_sync<P: Prog>(paths: &Paths, instance_id: &str, id: &str, keep: u32, prog: &P) -> AppResult<()> {
    let (folder, st) = parse_id(id)?;
    let zip = worlds_root(paths, instance_id).join(folder).join(format!("{st}.zip"));
    if !zip.is_file() {
        return Err(AppError::NotFound("Welt-Backup".into()));
    }
    let saves = saves(paths, instance_id);
    let dest = saves.join(folder);
    let (p_backup, p_extract) = if dest.join("level.dat").is_file() { (prog.sub(0.0, 0.5), prog.sub(0.5, 1.0)) } else { (prog.sub(0.0, 0.0), prog.clone()) };
    if dest.join("level.dat").is_file() {
        backup_sync(paths, instance_id, folder, true, &p_backup)?;
        prune(paths, instance_id, folder, keep, &[id]);
    }
    prog.message("Welt wird wiederhergestellt …");
    let tmp = tmp_dir(&saves, "restore");
    if let Err(e) = extract(&zip, None, &tmp, &p_extract) {
        let _ = std::fs::remove_dir_all(&tmp);
        return Err(e);
    }
    if dest.exists() {
        let old = tmp_dir(&saves, "old");
        if let Err(e) = std::fs::rename(&dest, &old) {
            let _ = std::fs::remove_dir_all(&tmp);
            return Err(AppError::msg(format!("Welt konnte nicht ersetzt werden (läuft das Spiel noch?): {e}")));
        }
        if let Err(e) = std::fs::rename(&tmp, &dest) {
            let _ = std::fs::rename(&old, &dest);
            let _ = std::fs::remove_dir_all(&tmp);
            return Err(e.into());
        }
        let _ = std::fs::remove_dir_all(&old);
    } else {
        std::fs::rename(&tmp, &dest)?;
    }
    Ok(())
}

pub(super) fn copy_sync(paths: &Paths, instance_id: &str, folder: &str, target_id: &str, prog: &impl Prog) -> AppResult<String> {
    check_folder(folder)?;
    let src = saves(paths, instance_id).join(folder);
    if !src.join("level.dat").is_file() {
        return Err(AppError::NotFound(format!("Welt {folder}")));
    }
    let dst_saves = saves(paths, target_id);
    std::fs::create_dir_all(&dst_saves)?;
    prog.message(&format!("„{}“ wird kopiert …", world_name(&src, folder)));
    let (files, dirs) = list_tree(&src)?;
    let total: u64 = files.iter().map(|f| f.2.len()).sum();
    let tmp = tmp_dir(&dst_saves, "copy");
    let res = (|| -> AppResult<()> {
        std::fs::create_dir_all(&tmp)?;
        for d in &dirs {
            std::fs::create_dir_all(tmp.join(d))?;
        }
        let mut done = 0u64;
        for (rel, path, _) in &files {
            prog.check()?;
            let target = tmp.join(rel);
            if let Some(p) = target.parent() {
                std::fs::create_dir_all(p)?;
            }
            let r = std::fs::File::open(path).map_err(|e| AppError::msg(format!("{rel} nicht lesbar: {e}")))?;
            let mut w = std::io::BufWriter::new(std::fs::File::create(&target)?);
            copy_counting(r, &mut w, &mut done, total, prog)?;
            w.flush()?;
        }
        Ok(())
    })();
    if let Err(e) = res {
        let _ = std::fs::remove_dir_all(&tmp);
        return Err(e);
    }
    let name = unique_folder(&dst_saves, folder);
    std::fs::rename(&tmp, dst_saves.join(&name)).inspect_err(|_| {
        let _ = std::fs::remove_dir_all(&tmp);
    })?;
    Ok(name)
}

pub(super) fn import_sync(paths: &Paths, instance_id: &str, zip_path: &Path, prog: &impl Prog) -> AppResult<String> {
    let f = std::fs::File::open(zip_path).map_err(|e| AppError::msg(format!("Datei nicht lesbar: {e}")))?;
    let zip = zip::ZipArchive::new(std::io::BufReader::new(f)).map_err(|e| AppError::Invalid(format!("Keine gültige ZIP-Datei: {e}")))?;
    let prefix = find_root(&zip).ok_or_else(|| AppError::Invalid("In der ZIP wurde keine Minecraft-Welt (level.dat) gefunden.".into()))?;
    drop(zip);
    let base = if prefix.is_empty() {
        zip_path.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_else(|| "Welt".into())
    } else {
        prefix.trim_end_matches('/').to_string()
    };
    let saves = saves(paths, instance_id);
    std::fs::create_dir_all(&saves)?;
    prog.message("Welt wird importiert …");
    let tmp = tmp_dir(&saves, "import");
    if let Err(e) = extract(zip_path, Some(&prefix), &tmp, prog) {
        let _ = std::fs::remove_dir_all(&tmp);
        return Err(e);
    }
    let name = unique_folder(&saves, &base);
    std::fs::rename(&tmp, saves.join(&name)).inspect_err(|_| {
        let _ = std::fs::remove_dir_all(&tmp);
    })?;
    Ok(name)
}

/// Welten, die sich seit ihrem letzten Backup geändert haben (oder noch keins haben).
pub(super) fn changed_worlds(paths: &Paths, instance_id: &str) -> Vec<String> {
    let Ok(rd) = std::fs::read_dir(saves(paths, instance_id)) else { return vec![] };
    let mut out = Vec::new();
    for e in rd.flatten() {
        let folder = e.file_name().to_string_lossy().to_string();
        if folder.starts_with('.') || !valid_name(&folder) || !e.path().join("level.dat").is_file() {
            continue;
        }
        let Ok(fp) = fingerprint(&e.path()) else { continue };
        let last = list_world(paths, instance_id, &folder).into_iter().next().map(|(_, f)| f);
        if last.as_deref() != Some(fp.as_str()) {
            out.push(folder);
        }
    }
    out.sort();
    out
}

pub(super) fn size_text(n: u64) -> String {
    if n >= 1 << 30 {
        format!("{:.1} GB", n as f64 / (1u64 << 30) as f64)
    } else if n >= 1 << 20 {
        format!("{:.1} MB", n as f64 / (1u64 << 20) as f64)
    } else {
        format!("{} KB", n.div_ceil(1024))
    }
}
