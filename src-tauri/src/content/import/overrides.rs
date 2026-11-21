use super::*;

// ------------------------------------------------------------------ Ausführung

/// Zusätzliche Angaben (Modpack-Installation aus dem Katalog).
#[derive(Debug, Clone, Default)]
pub struct ImportOptions {
    pub name: Option<String>,
    pub source: Option<PackSource>,
    pub icon_url: Option<String>,
    /// Quelle für spätere Modpack-Updates (Modrinth/CurseForge/Store)
    pub pack_source: Option<Source>,
}

/// Overrides aus dem Archiv in den Spielordner entpacken (blockierend).
/// `progress` meldet 0..1 und liefert `Err(Cancelled)` bei Abbruch.
pub(crate) fn extract_overrides(zip_path: &Path, prefixes: &[String], game_dir: &Path, progress: &dyn Fn(f64) -> AppResult<()>) -> AppResult<()> {
    extract_overrides_only(zip_path, prefixes, game_dir, None, progress)
}

/// Wie `extract_overrides`, optional nur bestimmte relative Pfade.
pub(crate) fn extract_overrides_only(
    zip_path: &Path,
    prefixes: &[String],
    game_dir: &Path,
    only: Option<&HashSet<String>>,
    progress: &dyn Fn(f64) -> AppResult<()>,
) -> AppResult<()> {
    let f = std::fs::File::open(zip_path)?;
    let mut zip = zip::ZipArchive::new(std::io::BufReader::new(f))?;
    let total = (zip.len() * prefixes.len()).max(1);
    for (pi, prefix) in prefixes.iter().enumerate() {
        for i in 0..zip.len() {
            if i % 64 == 0 {
                progress((pi * zip.len() + i) as f64 / total as f64)?;
            }
            let mut entry = zip.by_index(i)?;
            let name = entry.name().replace('\\', "/");
            let Some(rel) = name.strip_prefix(prefix.as_str()) else { continue };
            if rel.is_empty() || only.is_some_and(|o| !o.contains(rel.trim_end_matches('/'))) {
                continue;
            }
            let Some(target) = safe_join(game_dir, rel) else {
                return Err(AppError::Invalid(format!("Das Pack enthält einen unzulässigen Pfad: {name}")));
            };
            if entry.is_dir() {
                std::fs::create_dir_all(&target)?;
                continue;
            }
            if let Some(p) = target.parent() {
                std::fs::create_dir_all(p)?;
            }
            // Über Temp-Datei + Umbenennen schreiben: vorhandene Dateien können Hardlinks in den
            // Snapshot-Speicher sein und dürfen nicht an Ort und Stelle verändert werden.
            let tmp = target.with_file_name(format!(".{}.vltmp", target.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default()));
            {
                let mut out = std::fs::File::create(&tmp)?;
                std::io::copy(&mut entry, &mut out)?;
            }
            if target.exists() {
                let _ = std::fs::remove_file(&target);
            }
            std::fs::rename(&tmp, &target)?;
        }
    }
    progress(1.0)
}

/// Override-Dateien im Archiv: relativer Pfad -> (SHA-1, Größe). Spätere Präfixe gewinnen.
pub(crate) fn override_entries(zip_path: &Path, prefixes: &[String]) -> AppResult<std::collections::BTreeMap<String, (String, u64)>> {
    use sha1::Digest;
    let f = std::fs::File::open(zip_path)?;
    let mut zip = zip::ZipArchive::new(std::io::BufReader::new(f))?;
    let mut out = std::collections::BTreeMap::new();
    for prefix in prefixes {
        for i in 0..zip.len() {
            let mut entry = zip.by_index(i)?;
            if entry.is_dir() {
                continue;
            }
            let name = entry.name().replace('\\', "/");
            let Some(rel) = name.strip_prefix(prefix.as_str()) else { continue };
            if rel.is_empty() || safe_join(Path::new("base"), rel).is_none() {
                continue;
            }
            let mut h = sha1::Sha1::new();
            let mut buf = [0u8; 64 * 1024];
            let mut size = 0u64;
            loop {
                let n = entry.read(&mut buf)?;
                if n == 0 {
                    break;
                }
                size += n as u64;
                h.update(&buf[..n]);
            }
            out.insert(rel.to_string(), (hex::encode(h.finalize()), size));
        }
    }
    Ok(out)
}
