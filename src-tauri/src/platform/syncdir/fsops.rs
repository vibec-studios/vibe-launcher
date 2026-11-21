use super::*;

/// Junction oder Symlink (Windows meldet Junctions ebenfalls als Verknüpfung)?
pub fn is_link(p: &Path) -> bool {
    std::fs::symlink_metadata(p).is_ok_and(|m| m.file_type().is_symlink())
}

/// Systemdateien und eigene Zwischendateien nie abgleichen.
pub fn ignored(name: &str) -> bool {
    name.starts_with('.') || name.eq_ignore_ascii_case("desktop.ini") || name.eq_ignore_ascii_case("thumbs.db")
}

pub(super) fn mtime_ms(m: &std::fs::Metadata) -> i64 {
    m.modified().ok().and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_millis() as i64).unwrap_or(0)
}

pub(super) fn fnv(h: u64, s: &str) -> u64 {
    let mut h = h;
    for b in s.bytes().chain([0u8]) {
        h ^= b as u64;
        h = h.wrapping_mul(0x100000001b3);
    }
    h
}

/// Fingerabdruck eines Eintrags (Datei oder Ordner). None = existiert nicht.
pub fn stamp(p: &Path) -> Option<Stamp> {
    let m = std::fs::symlink_metadata(p).ok()?;
    if m.is_file() {
        return Some(Stamp { size: m.len(), mtime: mtime_ms(&m), files: 1, names: 0 });
    }
    if !m.is_dir() {
        return None;
    }
    let mut s = Stamp { size: 0, mtime: 0, files: 0, names: 0xcbf29ce484222325 };
    let mut rels: Vec<String> = vec![];
    for e in walkdir::WalkDir::new(p).min_depth(1).follow_links(false).into_iter().flatten() {
        if !e.file_type().is_file() {
            continue;
        }
        if let Ok(md) = e.metadata() {
            s.size += md.len();
            s.mtime = s.mtime.max(mtime_ms(&md));
            s.files += 1;
        }
        if let Ok(r) = e.path().strip_prefix(p) {
            rels.push(r.to_string_lossy().replace('\\', "/"));
        }
    }
    rels.sort();
    for r in &rels {
        s.names = fnv(s.names, r);
    }
    Some(s)
}

/// Einträge der obersten Ebene.
pub(super) fn entries(dir: &Path) -> BTreeMap<String, Stamp> {
    let mut out = BTreeMap::new();
    let Ok(rd) = std::fs::read_dir(dir) else { return out };
    for e in rd.flatten() {
        let name = e.file_name().to_string_lossy().to_string();
        if ignored(&name) {
            continue;
        }
        if let Some(s) = stamp(&e.path()) {
            out.insert(name, s);
        }
    }
    out
}

pub(super) fn sha1(p: &Path) -> Option<String> {
    crate::net::sha1_file(p).ok()
}

/// Gleicher Inhalt (Datei: Bytes, Ordner: gleiche Dateien mit gleichem Inhalt)?
pub fn same_content(a: &Path, b: &Path) -> bool {
    let (Ok(ma), Ok(mb)) = (std::fs::symlink_metadata(a), std::fs::symlink_metadata(b)) else { return false };
    if ma.is_file() && mb.is_file() {
        return ma.len() == mb.len() && sha1(a).is_some() && sha1(a) == sha1(b);
    }
    if !(ma.is_dir() && mb.is_dir()) {
        return false;
    }
    let list = |root: &Path| -> BTreeMap<String, PathBuf> {
        walkdir::WalkDir::new(root)
            .min_depth(1)
            .follow_links(false)
            .into_iter()
            .flatten()
            .filter(|e| e.file_type().is_file())
            .filter_map(|e| Some((e.path().strip_prefix(root).ok()?.to_string_lossy().replace('\\', "/"), e.path().to_path_buf())))
            .collect()
    };
    let (la, lb) = (list(a), list(b));
    la.len() == lb.len() && la.iter().all(|(k, pa)| lb.get(k).is_some_and(|pb| same_content(pa, pb)))
}

pub(super) fn tmp_sibling(p: &Path) -> PathBuf {
    let name = p.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
    p.with_file_name(format!(".{name}.vl-{}", &uuid::Uuid::new_v4().simple().to_string()[..8]))
}

/// Datei als Hardlink (groß) oder Kopie (klein / Hardlink nicht möglich) anlegen.
pub fn link_or_copy(src: &Path, dst: &Path) -> std::io::Result<()> {
    let big = std::fs::metadata(src).map(|m| m.len() >= LINK_MIN).unwrap_or(false);
    if big && std::fs::hard_link(src, dst).is_ok() {
        return Ok(());
    }
    std::fs::copy(src, dst).map(|_| ())
}

pub(super) fn remove_any(p: &Path) -> std::io::Result<()> {
    match std::fs::symlink_metadata(p) {
        Ok(m) if m.is_dir() => std::fs::remove_dir_all(p),
        Ok(_) => std::fs::remove_file(p),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e),
    }
}

/// Eintrag `src` nach `dst` übertragen (ersetzt `dst`). Erst vollständig daneben anlegen, dann umbenennen.
pub fn place(src: &Path, dst: &Path) -> std::io::Result<()> {
    if let Some(p) = dst.parent() {
        std::fs::create_dir_all(p)?;
    }
    let tmp = tmp_sibling(dst);
    let res = (|| {
        if std::fs::symlink_metadata(src)?.is_dir() {
            std::fs::create_dir_all(&tmp)?;
            for e in walkdir::WalkDir::new(src).min_depth(1).follow_links(false) {
                let e = e.map_err(std::io::Error::other)?;
                let rel = e.path().strip_prefix(src).map_err(std::io::Error::other)?;
                let t = tmp.join(rel);
                if e.file_type().is_dir() {
                    std::fs::create_dir_all(&t)?;
                } else if e.file_type().is_file() {
                    if let Some(p) = t.parent() {
                        std::fs::create_dir_all(p)?;
                    }
                    link_or_copy(e.path(), &t)?;
                }
            }
        } else {
            link_or_copy(src, &tmp)?;
        }
        // Datei über Datei: rename ersetzt atomar; sonst erst das Alte entfernen
        let dst_dir = std::fs::symlink_metadata(dst).map(|m| m.is_dir()).unwrap_or(false);
        if dst_dir || std::fs::symlink_metadata(&tmp)?.is_dir() {
            remove_any(dst)?;
        }
        std::fs::rename(&tmp, dst)
    })();
    if res.is_err() {
        let _ = remove_any(&tmp);
    }
    res
}

/// In den Papierkorb verschieben (`<trash>/<Zeitstempel>_<Name>`).
pub fn to_trash(p: &Path, trash: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(trash)?;
    let name = p.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
    let stamp = chrono::Local::now().format("%Y%m%d-%H%M%S");
    let mut target = trash.join(format!("{stamp}_{name}"));
    let mut n = 2;
    while target.exists() {
        target = trash.join(format!("{stamp}-{n}_{name}"));
        n += 1;
    }
    std::fs::rename(p, &target)
}

/// Alte Papierkorb-Einträge entfernen.
pub fn prune_trash(trash: &Path) {
    let Ok(rd) = std::fs::read_dir(trash) else { return };
    let limit = chrono::Local::now().naive_local() - chrono::Duration::days(TRASH_DAYS);
    for e in rd.flatten() {
        let name = e.file_name().to_string_lossy().to_string();
        let Some(ts) = name.get(..15) else { continue };
        if let Ok(t) = chrono::NaiveDateTime::parse_from_str(ts, "%Y%m%d-%H%M%S") {
            if t < limit {
                let _ = remove_any(&e.path());
            }
        }
    }
}

/// Freier Name „Stamm (Zusatz).ext“, der in keinem der Ordner existiert.
pub fn unique_name(name: &str, suffix: &str, dirs: &[&Path], is_dir: bool) -> String {
    let (stem, ext) = match name.rfind('.') {
        Some(i) if i > 0 && !is_dir => (&name[..i], &name[i..]),
        _ => (name, ""),
    };
    let suffix = crate::paths::sanitize_file_name(suffix);
    let mut n = 1;
    loop {
        let cand = if n == 1 { format!("{stem} ({suffix}){ext}") } else { format!("{stem} ({suffix} {n}){ext}") };
        if !dirs.iter().any(|d| d.join(&cand).exists()) {
            return cand;
        }
        n += 1;
    }
}
