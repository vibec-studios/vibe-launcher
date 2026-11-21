use super::*;

// ------------------------------------------------------------------ Erkennung (rein, getestet)

/// Was über die erwartete Datei bekannt ist.
#[derive(Debug, Clone, Copy)]
pub struct Expected<'a> {
    pub file_name: &'a str,
    pub size: Option<u64>,
    pub sha1: Option<&'a str>,
    pub fingerprint: Option<u32>,
}

pub(super) fn split_ext(name: &str) -> (&str, &str) {
    match name.rsplit_once('.') {
        Some((stem, ext)) if !stem.is_empty() => (stem, ext),
        _ => (name, ""),
    }
}

/// Gleicher Dateiname – auch so, wie Browser doppelte Downloads umbenennen: `name (1).jar`, `name(2).jar`.
pub fn name_matches(expected: &str, actual: &str) -> bool {
    if actual.eq_ignore_ascii_case(expected) {
        return true;
    }
    let (stem, ext) = split_ext(expected);
    let (astem, aext) = split_ext(actual);
    if !aext.eq_ignore_ascii_case(ext) {
        return false;
    }
    let Some(head) = astem.get(..stem.len()).filter(|h| h.eq_ignore_ascii_case(stem)) else { return false };
    let rest = astem[head.len()..].trim_start();
    rest.strip_prefix('(').and_then(|r| r.strip_suffix(')')).is_some_and(|n| !n.is_empty() && n.len() <= 4 && n.bytes().all(|b| b.is_ascii_digit()))
}

/// Unfertige Browser-Downloads (Chrome/Edge, Firefox, Safari, Opera) nie anfassen.
pub(super) fn is_partial(name: &str) -> bool {
    let l = name.to_ascii_lowercase();
    [".crdownload", ".part", ".partial", ".tmp", ".download", ".opdownload"].iter().any(|s| l.ends_with(s))
}

/// Hash-Werte einer Datei, gecacht nach (Pfad, Größe, Änderungszeit) – große Dateien nicht in jedem Takt neu lesen.
/// Pfad, Größe, Änderungszeit -> (SHA-1, Murmur2)
pub(super) type HashKey = (PathBuf, u64, SystemTime);
pub(super) type HashVal = (Option<String>, Option<u32>);

#[derive(Default)]
pub struct HashCache {
    pub(super) map: HashMap<HashKey, HashVal>,
}

impl HashCache {
    pub(super) fn get(&mut self, p: &Path, len: u64, mtime: SystemTime, want_sha1: bool, want_fp: bool) -> (Option<String>, Option<u32>) {
        if self.map.len() > 256 {
            self.map.clear();
        }
        let e = self.map.entry((p.to_path_buf(), len, mtime)).or_default();
        if want_sha1 && e.0.is_none() {
            e.0 = crate::net::sha1_file(p).ok();
        }
        if want_fp && e.1.is_none() {
            e.1 = std::fs::read(p).ok().map(|b| crate::content::murmur::cf_fingerprint(&b));
        }
        e.clone()
    }
}

/// Ist `p` genau die erwartete Datei? Größe (falls bekannt) und SHA-1 bzw. Fingerprint müssen passen.
/// Ohne bekannten Hash wird nie bestätigt.
pub fn verify(p: &Path, exp: &Expected, cache: &mut HashCache) -> bool {
    let Ok(m) = std::fs::metadata(p) else { return false };
    if !m.is_file() || exp.size.is_some_and(|s| s != m.len()) {
        return false;
    }
    let mtime = m.modified().unwrap_or(SystemTime::UNIX_EPOCH);
    match (exp.sha1, exp.fingerprint) {
        (Some(h), _) => cache.get(p, m.len(), mtime, true, false).0.is_some_and(|x| x.eq_ignore_ascii_case(h)),
        (None, Some(fp)) => cache.get(p, m.len(), mtime, false, true).1 == Some(fp),
        (None, None) => false,
    }
}

/// Passende Datei im Ordner suchen (nur oberste Ebene). Kandidaten: gleicher Name (auch „(1)“) oder gleiche
/// Größe + Endung (Browser hat umbenannt); bestätigt wird nur per Hash.
pub fn find_in_dir(dir: &Path, exp: &Expected, cache: &mut HashCache) -> Option<PathBuf> {
    let (_, ext) = split_ext(exp.file_name);
    let mut cands: Vec<(u8, SystemTime, PathBuf)> = Vec::new();
    for e in std::fs::read_dir(dir).ok()?.flatten() {
        let name = e.file_name().to_string_lossy().to_string();
        if is_partial(&name) {
            continue;
        }
        let Ok(m) = e.metadata() else { continue };
        if !m.is_file() {
            continue;
        }
        let rank = if name.eq_ignore_ascii_case(exp.file_name) {
            0
        } else if name_matches(exp.file_name, &name) {
            1
        } else if exp.size.is_some_and(|s| s == m.len()) && split_ext(&name).1.eq_ignore_ascii_case(ext) {
            2
        } else {
            continue;
        };
        cands.push((rank, m.modified().unwrap_or(SystemTime::UNIX_EPOCH), e.path()));
    }
    // Exakter Name zuerst, sonst der neueste Download
    cands.sort_by(|a, b| a.0.cmp(&b.0).then(b.1.cmp(&a.1)));
    cands.into_iter().map(|(_, _, p)| p).find(|p| verify(p, exp, cache))
}

/// Verschieben (über Laufwerke hinweg: kopieren + löschen).
pub(super) fn move_file(src: &Path, dst: &Path) -> std::io::Result<()> {
    if let Some(parent) = dst.parent() {
        std::fs::create_dir_all(parent)?;
    }
    if std::fs::rename(src, dst).is_ok() {
        return Ok(());
    }
    let tmp = dst.with_file_name(format!(".{}.part", dst.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default()));
    std::fs::copy(src, &tmp)?;
    std::fs::rename(&tmp, dst)?;
    let _ = std::fs::remove_file(src);
    Ok(())
}

/// Ergebnis eines Durchlaufs.
#[derive(Debug, Default)]
pub struct Outcome {
    /// Aus dem Download-Ordner übernommen
    pub arrived: Vec<MissingEntry>,
    /// Liegt (vom Nutzer abgelegt) schon im Instanzordner
    pub present: Vec<MissingEntry>,
    pub remaining: Vec<MissingEntry>,
}

/// Einträge gegen Instanz- und Download-Ordner prüfen; passende Downloads in den Instanzordner verschieben.
/// Waren alle ersetzten Dateien deaktiviert, bleibt die neue Datei es auch.
pub fn scan_dirs(game_dir: &Path, downloads: Option<&Path>, list: Vec<MissingEntry>, cache: &mut HashCache) -> Outcome {
    let mut out = Outcome::default();
    for e in list {
        let dst = target(game_dir, e.info.kind, &e.info.file_name);
        // Schon im Instanzordner (vom Nutzer abgelegt)? Mit bekanntem Hash nur, wenn er passt – sonst ist es z. B.
        // die alte Version gleichen Namens (manuelles Update) und wird durch den passenden Download ersetzt.
        let existing = [dst.clone(), with_disabled(&dst)].into_iter().find(|p| p.is_file());
        let has_hash = e.sha1.is_some() || e.fingerprint.is_some();
        if let Some(ex) = &existing {
            if !has_hash || verify(ex, &e.expected(), cache) {
                out.present.push(e);
                continue;
            }
        }
        let found = downloads.filter(|d| d.is_dir()).and_then(|d| find_in_dir(d, &e.expected(), cache));
        let Some(src) = found else {
            out.remaining.push(e);
            continue;
        };
        let was_disabled = existing.as_ref().is_some_and(|p| *p != dst)
            || (!e.replaces.is_empty()
                && e.replaces.iter().all(|k| {
                    let p = game_dir.join(k);
                    !p.exists() && with_disabled(&p).exists()
                }));
        if let Some(ex) = &existing {
            if let Err(err) = std::fs::remove_file(ex) {
                tracing::warn!("Alte Datei {:?} konnte nicht ersetzt werden: {err}", ex);
                out.remaining.push(e);
                continue;
            }
        }
        let dst = if was_disabled { with_disabled(&dst) } else { dst };
        match move_file(&src, &dst) {
            Ok(()) => out.arrived.push(e),
            Err(err) => {
                tracing::warn!("Manueller Download {:?} konnte nicht übernommen werden: {err}", src);
                out.remaining.push(e);
            }
        }
    }
    out
}
