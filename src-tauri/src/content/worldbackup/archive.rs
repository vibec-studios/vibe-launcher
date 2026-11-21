use super::*;

/// Leser, der Bytes zählt, Fortschritt meldet und Abbruch prüft.
pub(super) struct Counting<'a, R, P> {
    pub(super) inner: R,
    pub(super) done: &'a mut u64,
    pub(super) total: u64,
    pub(super) prog: &'a P,
    pub(super) last: u64,
}

impl<R: Read, P: Prog> Read for Counting<'_, R, P> {
    fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
        let n = self.inner.read(buf)?;
        *self.done += n as u64;
        if *self.done - self.last >= 1 << 20 {
            self.last = *self.done;
            if self.prog.check().is_err() {
                return Err(std::io::Error::other("abgebrochen"));
            }
            if self.total > 0 {
                self.prog.set(*self.done as f64 / self.total as f64);
            }
        }
        Ok(n)
    }
}

pub(super) fn copy_counting(r: impl Read, w: &mut impl Write, done: &mut u64, total: u64, prog: &impl Prog) -> AppResult<()> {
    let last = *done;
    let mut c = Counting { inner: r, done, total, prog, last };
    match std::io::copy(&mut c, w) {
        Ok(_) => Ok(()),
        Err(_) if prog.check().is_err() => Err(AppError::Cancelled),
        Err(e) => Err(e.into()),
    }
}

/// Weltordner als ZIP schreiben (Einträge unter `<prefix>/`). Gibt die Größe der ZIP zurück.
pub(super) fn zip_dir(src: &Path, prefix: &str, out: &Path, prog: &impl Prog) -> AppResult<u64> {
    let (files, dirs) = list_tree(src)?;
    let total: u64 = files.iter().map(|f| f.2.len()).sum();
    if let Some(p) = out.parent() {
        std::fs::create_dir_all(p)?;
    }
    let part = out.with_extension("zip.part");
    let res = (|| -> AppResult<()> {
        let f = std::fs::File::create(&part)?;
        let mut zip = zip::ZipWriter::new(std::io::BufWriter::new(f));
        let base = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated).compression_level(Some(3));
        zip.add_directory(format!("{prefix}/"), base)?;
        for d in &dirs {
            zip.add_directory(format!("{prefix}/{d}/"), base)?;
        }
        let mut done = 0u64;
        for (rel, path, m) in &files {
            prog.check()?;
            zip.start_file(format!("{prefix}/{rel}"), base.large_file(m.len() >= u32::MAX as u64))?;
            let f = std::fs::File::open(path).map_err(|e| AppError::msg(format!("{rel} nicht lesbar (läuft das Spiel?): {e}")))?;
            copy_counting(std::io::BufReader::with_capacity(256 * 1024, f), &mut zip, &mut done, total, prog)?;
        }
        zip.finish()?.flush()?;
        Ok(())
    })();
    if let Err(e) = res {
        let _ = std::fs::remove_file(&part);
        return Err(e);
    }
    std::fs::rename(&part, out)?;
    Ok(std::fs::metadata(out)?.len())
}

/// Wurzel der Welt in einer ZIP: `level.dat` direkt oder eine Ebene tiefer. Liefert das Präfix
/// (`""` oder `"Ordner/"`).
pub(super) fn find_root<R: Read + std::io::Seek>(zip: &zip::ZipArchive<R>) -> Option<String> {
    let mut deeper: Option<String> = None;
    for name in zip.file_names() {
        let n = name.replace('\\', "/");
        if n.starts_with("__MACOSX/") {
            continue;
        }
        if n == "level.dat" {
            return Some(String::new());
        }
        let parts: Vec<&str> = n.split('/').collect();
        if parts.len() == 2 && parts[1] == "level.dat" && !parts[0].is_empty() && deeper.is_none() {
            deeper = Some(format!("{}/", parts[0]));
        }
    }
    deeper
}

/// ZIP-Inhalt unter `prefix` nach `dest` entpacken (Zip-Slip-sicher).
pub(super) fn extract(zip_path: &Path, prefix: Option<&str>, dest: &Path, prog: &impl Prog) -> AppResult<()> {
    let f = std::fs::File::open(zip_path)?;
    let mut zip = zip::ZipArchive::new(std::io::BufReader::new(f)).map_err(|e| AppError::Invalid(format!("Keine gültige ZIP-Datei: {e}")))?;
    let prefix = match prefix {
        Some(p) => p.to_string(),
        None => find_root(&zip).ok_or_else(|| AppError::Invalid("In der ZIP wurde keine Minecraft-Welt (level.dat) gefunden.".into()))?,
    };
    let total: u64 = (0..zip.len()).filter_map(|i| zip.by_index_raw(i).ok().map(|f| f.size())).sum();
    let mut done = 0u64;
    std::fs::create_dir_all(dest)?;
    for i in 0..zip.len() {
        prog.check()?;
        let mut entry = zip.by_index(i)?;
        let name = entry.name().replace('\\', "/");
        let Some(rel) = name.strip_prefix(prefix.as_str()) else { continue };
        if rel.is_empty() || rel.trim_matches('/').is_empty() || rel.starts_with("__MACOSX/") {
            continue;
        }
        if SKIP.contains(&rel.trim_matches('/')) {
            continue;
        }
        let target = crate::util::safe_join(dest, rel).ok_or_else(|| AppError::Invalid(format!("Unsicherer Pfad in der ZIP: {name}")))?;
        if entry.is_dir() {
            std::fs::create_dir_all(&target)?;
            continue;
        }
        if let Some(p) = target.parent() {
            std::fs::create_dir_all(p)?;
        }
        let mut out = std::io::BufWriter::new(std::fs::File::create(&target)?);
        copy_counting(&mut entry, &mut out, &mut done, total, prog)?;
        out.flush()?;
    }
    if !dest.join("level.dat").exists() {
        return Err(AppError::Invalid("In der ZIP wurde keine Minecraft-Welt (level.dat) gefunden.".into()));
    }
    Ok(())
}

/// Freier Ordnername: `Welt`, `Welt (2)`, `Welt (3)` …
pub(crate) fn unique_folder(saves: &Path, base: &str) -> String {
    let base = crate::paths::sanitize_file_name(base);
    let base = if valid_name(&base) && !base.starts_with('.') { base } else { "Welt".to_string() };
    if !saves.join(&base).exists() {
        return base;
    }
    (2..).map(|n| format!("{base} ({n})")).find(|n| !saves.join(n).exists()).unwrap_or(base)
}

pub(super) fn tmp_dir(saves: &Path, what: &str) -> PathBuf {
    saves.join(format!(".vl-{what}-{}", &uuid::Uuid::new_v4().simple().to_string()[..8]))
}
