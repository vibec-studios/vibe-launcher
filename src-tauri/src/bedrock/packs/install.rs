use super::*;

/// Ordnername aus dem Pack-Namen.
pub(super) fn folder_name(name: &str) -> String {
    let s: String = crate::paths::sanitize_file_name(name).chars().filter(|c| !c.is_control()).take(60).collect();
    let s = s.trim().trim_end_matches('.').to_string();
    if s.is_empty() { "pack".into() } else { s }
}

/// Dateien in einen neuen Ordner schreiben (erst in einen Temp-Ordner daneben, dann umbenennen).
pub(super) fn write_tree(dest: &Path, files: &[(&str, &[u8])]) -> AppResult<()> {
    let parent = dest.parent().ok_or_else(|| AppError::msg("Kein Zielordner"))?;
    std::fs::create_dir_all(parent)?;
    let tmp = parent.join(format!(".vibe-tmp-{}", uuid::Uuid::new_v4().simple()));
    let r = (|| {
        for (rel, data) in files {
            let p = crate::util::safe_join(&tmp, rel).ok_or_else(|| AppError::Invalid(format!("Unsicherer Pfad: {rel}")))?;
            if let Some(pp) = p.parent() {
                std::fs::create_dir_all(pp)?;
            }
            std::fs::write(&p, data)?;
        }
        std::fs::rename(&tmp, dest)?;
        Ok::<_, AppError>(())
    })();
    if r.is_err() {
        let _ = std::fs::remove_dir_all(&tmp);
    }
    r
}

/// Ersetzen: alten Ordner beiseite, neuen an seine Stelle, alten weg. Bricht nichts halb ab.
pub(super) fn replace_dir(old: &Path, files: &[(&str, &[u8])]) -> AppResult<()> {
    let parent = old.parent().ok_or_else(|| AppError::msg("Kein Zielordner"))?;
    let aside = parent.join(format!(".vibe-old-{}", uuid::Uuid::new_v4().simple()));
    std::fs::rename(old, &aside)?;
    match write_tree(old, files) {
        Ok(()) => {
            let _ = std::fs::remove_dir_all(&aside);
            Ok(())
        }
        Err(e) => {
            let _ = std::fs::rename(&aside, old);
            Err(e)
        }
    }
}

/// Ergebnis eines Imports.
#[derive(Debug, Clone, Serialize, Default)]
pub struct ImportResult {
    /// Installierte bzw. aktualisierte Packs (Namen)
    pub packs: Vec<String>,
    /// Importierte Welten (Ordnernamen unter `minecraftWorlds`)
    pub worlds: Vec<String>,
    /// Bereits vorhandene Packs, die ersetzt wurden
    pub updated: Vec<String>,
}

/// Ein Pack installieren: gleiche UUID im Zielordner -> ersetzen (Update), sonst neuer Ordner.
pub fn install_pack(packs_dir: &Path, m: &Manifest, files: &[(&str, &[u8])], source: Option<&PackSource>) -> AppResult<(String, bool)> {
    let folder = m.kind.folder();
    let base = packs_dir.join(folder);
    std::fs::create_dir_all(&base)?;
    let mut owned: Vec<(String, Vec<u8>)> = files.iter().filter(|(r, _)| *r != SOURCE_FILE).map(|(r, d)| (r.to_string(), d.to_vec())).collect();
    if let Some(s) = source {
        owned.push((SOURCE_FILE.into(), serde_json::to_vec_pretty(s)?));
    }
    let refs: Vec<(&str, &[u8])> = owned.iter().map(|(r, d)| (r.as_str(), d.as_slice())).collect();
    // Vorhandenes Pack mit gleicher UUID?
    if let Ok(rd) = std::fs::read_dir(&base) {
        for e in rd.flatten() {
            if e.path().is_dir() && read_pack_dir(&e.path()).is_some_and(|x| x.uuid == m.uuid) {
                replace_dir(&e.path(), &refs)?;
                return Ok((format!("{folder}/{}", e.file_name().to_string_lossy()), true));
            }
        }
    }
    let stem = folder_name(&m.name);
    let mut name = stem.clone();
    let mut n = 2;
    while base.join(&name).exists() {
        name = format!("{stem} ({n})");
        n += 1;
    }
    write_tree(&base.join(&name), &refs)?;
    Ok((format!("{folder}/{name}"), false))
}

/// Zufälliger Weltordnername wie im Spiel (12 Zeichen).
pub fn new_world_folder(worlds_dir: &Path) -> String {
    loop {
        let s: String = uuid::Uuid::new_v4().simple().to_string().chars().take(12).collect();
        if !worlds_dir.join(&s).exists() {
            return s;
        }
    }
}

/// Archiv (bereits gelesen) in die Instanz übernehmen.
/// `worlds_dir`: Ziel für Welten (`None`, wenn es noch keinen Spielerordner gibt).
pub fn import_entries(packs_dir: &Path, worlds_dir: Option<&Path>, entries: &[Entry], source: Option<&PackSource>) -> AppResult<ImportResult> {
    let found = manifest::analyze(entries)?;
    if found.is_empty() {
        return Err(AppError::Invalid("In der Datei wurde kein Bedrock-Pack und keine Welt gefunden.".into()));
    }
    if worlds_dir.is_none() && found.iter().any(|f| matches!(f, Found::World { .. })) {
        return Err(AppError::Invalid("Für Welten braucht die Instanz einen Spielerordner: Starte sie einmal, dann klappt der Import.".into()));
    }
    // Innere Archive einmal entpacken
    let mut nested: std::collections::HashMap<String, Vec<Entry>> = Default::default();
    for f in &found {
        let n = match f {
            Found::Pack { nested: Some(n), .. } | Found::World { nested: Some(n), .. } => n,
            _ => continue,
        };
        if !nested.contains_key(n) {
            let data = entries.iter().find(|e| &e.path == n).map(|e| e.data.as_slice()).unwrap_or_default();
            nested.insert(n.clone(), manifest::read_zip(data)?);
        }
    }
    let mut res = ImportResult::default();
    for f in &found {
        match f {
            Found::Pack { manifest, root, nested: n } => {
                let src = n.as_ref().map(|n| nested[n].as_slice()).unwrap_or(entries);
                let files = manifest::files_of(src, root);
                let (_, updated) = install_pack(packs_dir, manifest, &files, source)?;
                if updated {
                    res.updated.push(manifest.name.clone());
                }
                res.packs.push(manifest.name.clone());
            }
            Found::World { root, nested: n, .. } => {
                let wd = worlds_dir.expect("oben geprüft");
                let src = n.as_ref().map(|n| nested[n].as_slice()).unwrap_or(entries);
                let files = manifest::files_of(src, root);
                std::fs::create_dir_all(wd)?;
                let folder = new_world_folder(wd);
                write_tree(&wd.join(&folder), &files)?;
                res.worlds.push(folder);
            }
        }
    }
    Ok(res)
}

/// Ordnerinhalt als ZIP (Wurzel = Ordnerinhalt) schreiben, z. B. `.mcpack`/`.mcworld`.
pub fn zip_dir(src: &Path, out: &Path) -> AppResult<()> {
    use std::io::Write;
    let tmp = out.with_extension("vibe-tmp");
    let r = (|| {
        let f = std::fs::File::create(&tmp)?;
        let mut z = zip::ZipWriter::new(std::io::BufWriter::new(f));
        let opts = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated).large_file(true);
        for e in walkdir::WalkDir::new(src).min_depth(1).into_iter().flatten() {
            let rel = e.path().strip_prefix(src).map_err(|e| AppError::msg(e.to_string()))?.to_string_lossy().replace('\\', "/");
            if rel == SOURCE_FILE || rel.ends_with("session.lock") {
                continue;
            }
            if e.file_type().is_dir() {
                z.add_directory(format!("{rel}/"), opts)?;
            } else if e.file_type().is_file() {
                z.start_file(rel, opts)?;
                let mut f = std::fs::File::open(e.path())?;
                std::io::copy(&mut f, &mut z)?;
            }
        }
        z.finish()?.flush()?;
        Ok::<_, AppError>(())
    })();
    match r {
        Ok(()) => {
            std::fs::rename(&tmp, out)?;
            Ok(())
        }
        Err(e) => {
            let _ = std::fs::remove_file(&tmp);
            Err(e)
        }
    }
}
