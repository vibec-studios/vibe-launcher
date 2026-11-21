//! Ordner-Sync für Resourcepacks und Shaderpacks: ein gemeinsamer Ordner (`<data>/sync/<bereich>`), mit dem jede
//! synchronisierte Instanz vor dem Start und nach dem Beenden abgeglichen wird (3-Wege-Abgleich).
//!
//! Warum Kopien/Hardlinks statt Junctions/Symlinks: Die Instanzordner bleiben ganz normale Ordner. Snapshots,
//! Export, Löschen einer Instanz, Virenscanner und andere Programme sehen nie einen Verweis in einen fremden Ordner,
//! Abschalten verliert nichts (die Dateien liegen ja schon in der Instanz) und eine laufende Instanz wird nie
//! angefasst – abgeglichen wird nur die Instanz, die gerade startet bzw. beendet wurde. Große Dateien werden als
//! Hardlink abgelegt (gleiche Partition, kein Admin nötig, kein doppelter Speicher), kleine kopiert; klappt ein
//! Hardlink nicht, wird kopiert.
//!
//! Einheit ist ein Eintrag der obersten Ebene (Pack als `.zip` oder als Ordner, Shader-Einstellungen `.txt`).
//! `Base` merkt sich je Eintrag, wie er nach dem letzten Abgleich auf beiden Seiten aussah (Größe, Änderungszeit,
//! Dateianzahl, Namen). Daraus folgt, wer was geändert hat:
//! - nur eine Seite geändert -> auf die andere übertragen (auch Löschen; im gemeinsamen Ordner landet Gelöschtes
//!   im Papierkorb `<data>/sync/trash`, 30 Tage)
//! - beide geändert, gleicher Inhalt -> nichts zu tun
//! - eine Seite gelöscht, andere geändert -> die Änderung gewinnt (nichts geht verloren)
//! - beide geändert, unterschiedlicher Inhalt (Konflikt) -> der gemeinsame Stand behält den Namen, die Fassung der
//!   Instanz wird als „Name (Instanz).zip“ in beide Ordner gelegt und gemeldet.
//!
//! Gesperrte Dateien (z. B. von einer anderen laufenden Instanz geöffnet) werden übersprungen und beim nächsten
//! Abgleich erneut versucht.
use crate::error::AppResult;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};

/// Dateien ab dieser Größe werden per Hardlink abgelegt, kleinere (Einstellungen) kopiert.
const LINK_MIN: u64 = 256 * 1024;
/// Papierkorb-Einträge älter als das werden entfernt.
const TRASH_DAYS: i64 = 30;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
pub struct Stamp {
    pub size: u64,
    pub mtime: i64,
    pub files: u32,
    /// Prüfsumme über die (sortierten) Dateinamen bei Ordnern
    pub names: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
pub struct BaseEntry {
    pub inst: Option<Stamp>,
    pub shared: Option<Stamp>,
}

pub type Base = BTreeMap<String, BaseEntry>;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Conflict {
    pub name: String,
    /// Neuer Name der Fassung aus der Instanz
    pub renamed: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct DirReport {
    pub to_shared: Vec<String>,
    pub to_instance: Vec<String>,
    pub removed_shared: Vec<String>,
    pub removed_instance: Vec<String>,
    pub conflicts: Vec<Conflict>,
    pub errors: Vec<String>,
}

impl DirReport {
    pub fn changes(&self) -> usize {
        self.to_shared.len() + self.to_instance.len() + self.removed_shared.len() + self.removed_instance.len() + self.conflicts.len()
    }
}

/// Junction oder Symlink (Windows meldet Junctions ebenfalls als Verknüpfung)?
pub fn is_link(p: &Path) -> bool {
    std::fs::symlink_metadata(p).is_ok_and(|m| m.file_type().is_symlink())
}

/// Systemdateien und eigene Zwischendateien nie abgleichen.
pub fn ignored(name: &str) -> bool {
    name.starts_with('.') || name.eq_ignore_ascii_case("desktop.ini") || name.eq_ignore_ascii_case("thumbs.db")
}

fn mtime_ms(m: &std::fs::Metadata) -> i64 {
    m.modified().ok().and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_millis() as i64).unwrap_or(0)
}

fn fnv(h: u64, s: &str) -> u64 {
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
fn entries(dir: &Path) -> BTreeMap<String, Stamp> {
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

fn sha1(p: &Path) -> Option<String> {
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

fn tmp_sibling(p: &Path) -> PathBuf {
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

fn remove_any(p: &Path) -> std::io::Result<()> {
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

/// Instanzordner `inst` mit dem gemeinsamen Ordner `shared` abgleichen. `suffix` (Instanzname) benennt
/// Konfliktfassungen. `base` wird auf den neuen Stand gebracht (bei Fehlern bleibt der Eintrag offen und wird beim
/// nächsten Mal erneut versucht).
pub fn sync(inst: &Path, shared: &Path, trash: &Path, base: &mut Base, suffix: &str) -> AppResult<DirReport> {
    if is_link(inst) {
        // Selbst angelegte Verknüpfung (Junction/Symlink): nicht hineinschreiben, sonst träfe es fremde Ordner
        return Ok(DirReport { errors: vec!["Der Ordner ist eine Verknüpfung und wird nicht abgeglichen".into()], ..Default::default() });
    }
    std::fs::create_dir_all(inst)?;
    std::fs::create_dir_all(shared)?;
    let li = entries(inst);
    let ls = entries(shared);
    let names: BTreeSet<String> = li.keys().chain(ls.keys()).chain(base.keys()).cloned().collect();
    let mut rep = DirReport::default();
    for name in names {
        let (ip, sp) = (inst.join(&name), shared.join(&name));
        let i = li.get(&name).copied();
        let s = ls.get(&name).copied();
        let b = base.get(&name).cloned().unwrap_or_default();
        let ic = i != b.inst;
        let sc = s != b.shared;
        let res: std::io::Result<()> = (|| {
            match (ic, sc, i.is_some(), s.is_some()) {
                (false, false, ..) => {}
                // Nur in der Instanz geändert
                (true, false, true, _) => {
                    place(&ip, &sp)?;
                    rep.to_shared.push(name.clone());
                }
                (true, false, false, true) => {
                    to_trash(&sp, trash)?;
                    rep.removed_shared.push(name.clone());
                }
                (true, false, false, false) => {}
                // Nur im gemeinsamen Ordner geändert
                (false, true, _, true) => {
                    place(&sp, &ip)?;
                    rep.to_instance.push(name.clone());
                }
                (false, true, true, false) => {
                    remove_any(&ip)?;
                    rep.removed_instance.push(name.clone());
                }
                (false, true, false, false) => {}
                // Beide Seiten geändert
                (true, true, false, false) => {}
                (true, true, true, false) => {
                    place(&ip, &sp)?;
                    rep.to_shared.push(name.clone());
                }
                (true, true, false, true) => {
                    place(&sp, &ip)?;
                    rep.to_instance.push(name.clone());
                }
                (true, true, true, true) => {
                    if !same_content(&ip, &sp) {
                        let is_dir = ip.is_dir();
                        let renamed = unique_name(&name, suffix, &[inst, shared], is_dir);
                        let (ip2, sp2) = (inst.join(&renamed), shared.join(&renamed));
                        std::fs::rename(&ip, &ip2)?;
                        place(&ip2, &sp2)?;
                        place(&sp, &ip)?;
                        base.insert(renamed.clone(), BaseEntry { inst: stamp(&ip2), shared: stamp(&sp2) });
                        rep.conflicts.push(Conflict { name: name.clone(), renamed });
                    }
                }
            }
            Ok(())
        })();
        match res {
            Ok(()) => {
                let e = BaseEntry { inst: stamp(&ip), shared: stamp(&sp) };
                if e.inst.is_none() && e.shared.is_none() {
                    base.remove(&name);
                } else {
                    base.insert(name, e);
                }
            }
            Err(e) => {
                tracing::warn!("Sync: {name} übersprungen: {e}");
                rep.errors.push(format!("{name}: {e}"));
            }
        }
    }
    prune_trash(trash);
    Ok(rep)
}

/// Einseitig sammeln (Screenshots): neue Dateien der Instanz zusätzlich in den gemeinsamen Ordner legen. Bereits
/// gesammelte (`seen`) werden nicht erneut übertragen – im gemeinsamen Ordner gelöschte Bilder kommen also nicht
/// wieder. Gibt die Anzahl neu gesammelter Dateien zurück.
pub fn collect(inst: &Path, shared: &Path, seen: &mut BTreeSet<String>, suffix: &str) -> AppResult<usize> {
    if is_link(inst) {
        return Ok(0);
    }
    let Ok(rd) = std::fs::read_dir(inst) else { return Ok(0) };
    std::fs::create_dir_all(shared)?;
    let mut present = BTreeSet::new();
    let mut n = 0;
    for e in rd.flatten() {
        let name = e.file_name().to_string_lossy().to_string();
        if ignored(&name) || !e.file_type().is_ok_and(|t| t.is_file()) {
            continue;
        }
        present.insert(name.clone());
        if seen.contains(&name) {
            continue;
        }
        let mut target = shared.join(&name);
        if target.exists() {
            if same_content(&e.path(), &target) {
                seen.insert(name);
                continue;
            }
            target = shared.join(unique_name(&name, suffix, &[shared], false));
        }
        let tmp = tmp_sibling(&target);
        match link_or_copy(&e.path(), &tmp).and_then(|_| std::fs::rename(&tmp, &target)) {
            Ok(()) => {
                seen.insert(name);
                n += 1;
            }
            Err(err) => {
                let _ = std::fs::remove_file(&tmp);
                tracing::warn!("Screenshot {name} nicht gesammelt: {err}");
            }
        }
    }
    // Merkliste klein halten: nur, was die Instanz noch hat
    seen.retain(|s| present.contains(s));
    Ok(n)
}

/// Anzahl Einträge und Gesamtgröße eines Ordners (oberste Ebene, ohne Systemdateien).
pub fn summary(dir: &Path) -> (usize, u64) {
    let e = entries(dir);
    (e.len(), e.values().map(|s| s.size).sum())
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Fx {
        base_dir: PathBuf,
        a: PathBuf,
        b: PathBuf,
        shared: PathBuf,
        trash: PathBuf,
    }

    fn fx() -> Fx {
        let base_dir = std::env::temp_dir().join(format!("vl-syncdir-{}", uuid::Uuid::new_v4()));
        let f = Fx { a: base_dir.join("a/resourcepacks"), b: base_dir.join("b/resourcepacks"), shared: base_dir.join("sync/resourcepacks"), trash: base_dir.join("sync/trash"), base_dir };
        std::fs::create_dir_all(&f.a).unwrap();
        std::fs::create_dir_all(&f.b).unwrap();
        f
    }

    fn names(d: &Path) -> Vec<String> {
        entries(d).into_keys().collect()
    }

    fn touch_later(p: &Path, data: &[u8]) {
        // Änderungszeit sicher anders als vorher
        std::thread::sleep(std::time::Duration::from_millis(15));
        std::fs::write(p, data).unwrap();
    }

    #[test]
    fn spreads_between_instances_and_handles_deletes() {
        let f = fx();
        let (mut ba, mut bb) = (Base::new(), Base::new());
        std::fs::write(f.a.join("Faithful.zip"), b"faithful").unwrap();
        std::fs::create_dir_all(f.a.join("Ordnerpack/assets")).unwrap();
        std::fs::write(f.a.join("Ordnerpack/pack.mcmeta"), b"{}").unwrap();
        std::fs::write(f.a.join("Ordnerpack/assets/x.png"), b"png").unwrap();
        std::fs::write(f.b.join("Nur-B.zip"), b"b").unwrap();
        std::fs::write(f.a.join(".tmp-datei"), b"ignoriert").unwrap();

        let r = sync(&f.a, &f.shared, &f.trash, &mut ba, "A").unwrap();
        assert_eq!(r.to_shared, vec!["Faithful.zip", "Ordnerpack"]);
        let r = sync(&f.b, &f.shared, &f.trash, &mut bb, "B").unwrap();
        assert_eq!(r.to_shared, vec!["Nur-B.zip"]);
        assert_eq!(r.to_instance, vec!["Faithful.zip", "Ordnerpack"]);
        assert!(f.b.join("Ordnerpack/assets/x.png").is_file());
        let r = sync(&f.a, &f.shared, &f.trash, &mut ba, "A").unwrap();
        assert_eq!(r.to_instance, vec!["Nur-B.zip"]);
        assert_eq!(names(&f.a), names(&f.b));
        assert!(!f.shared.join(".tmp-datei").exists());

        // Zweiter Abgleich ohne Änderungen: nichts passiert
        assert_eq!(sync(&f.a, &f.shared, &f.trash, &mut ba, "A").unwrap().changes(), 0);

        // In B gelöscht -> gemeinsamer Ordner (Papierkorb) -> aus A entfernt
        std::fs::remove_file(f.b.join("Nur-B.zip")).unwrap();
        let r = sync(&f.b, &f.shared, &f.trash, &mut bb, "B").unwrap();
        assert_eq!(r.removed_shared, vec!["Nur-B.zip"]);
        assert_eq!(names(&f.trash).len(), 1, "landet im Papierkorb");
        let r = sync(&f.a, &f.shared, &f.trash, &mut ba, "A").unwrap();
        assert_eq!(r.removed_instance, vec!["Nur-B.zip"]);

        // Änderung in einem Ordnerpack wird übertragen
        touch_later(&f.a.join("Ordnerpack/assets/x.png"), b"png2");
        let r = sync(&f.a, &f.shared, &f.trash, &mut ba, "A").unwrap();
        assert_eq!(r.to_shared, vec!["Ordnerpack"]);
        sync(&f.b, &f.shared, &f.trash, &mut bb, "B").unwrap();
        assert_eq!(std::fs::read(f.b.join("Ordnerpack/assets/x.png")).unwrap(), b"png2");
        std::fs::remove_dir_all(&f.base_dir).ok();
    }

    #[test]
    fn conflict_keeps_both_versions() {
        let f = fx();
        let (mut ba, mut bb) = (Base::new(), Base::new());
        std::fs::write(f.a.join("Pack.zip"), b"version-a").unwrap();
        std::fs::write(f.b.join("Pack.zip"), b"version-b").unwrap();
        std::fs::write(f.b.join("Gleich.zip"), b"gleich").unwrap();
        std::fs::write(f.a.join("Gleich.zip"), b"gleich").unwrap();
        sync(&f.a, &f.shared, &f.trash, &mut ba, "Instanz A").unwrap();
        let r = sync(&f.b, &f.shared, &f.trash, &mut bb, "Instanz B").unwrap();
        // Gleicher Inhalt ist kein Konflikt
        assert_eq!(r.conflicts, vec![Conflict { name: "Pack.zip".into(), renamed: "Pack (Instanz B).zip".into() }]);
        assert_eq!(std::fs::read(f.shared.join("Pack.zip")).unwrap(), b"version-a");
        assert_eq!(std::fs::read(f.shared.join("Pack (Instanz B).zip")).unwrap(), b"version-b");
        assert_eq!(std::fs::read(f.b.join("Pack.zip")).unwrap(), b"version-a");
        assert_eq!(std::fs::read(f.b.join("Pack (Instanz B).zip")).unwrap(), b"version-b");
        // A bekommt die umbenannte Fassung beim nächsten Abgleich
        sync(&f.a, &f.shared, &f.trash, &mut ba, "Instanz A").unwrap();
        assert_eq!(std::fs::read(f.a.join("Pack (Instanz B).zip")).unwrap(), b"version-b");
        // Danach stabil
        assert_eq!(sync(&f.b, &f.shared, &f.trash, &mut bb, "Instanz B").unwrap().changes(), 0);
        assert_eq!(sync(&f.a, &f.shared, &f.trash, &mut ba, "Instanz A").unwrap().changes(), 0);

        // Gleichzeitig geändert (A schreibt gemeinsam, B hat lokal etwas anderes) -> Konflikt statt Überschreiben
        touch_later(&f.a.join("Gleich.zip"), b"neu-a");
        sync(&f.a, &f.shared, &f.trash, &mut ba, "Instanz A").unwrap();
        touch_later(&f.b.join("Gleich.zip"), b"neu-b");
        let r = sync(&f.b, &f.shared, &f.trash, &mut bb, "Instanz B").unwrap();
        assert_eq!(r.conflicts.len(), 1);
        assert_eq!(std::fs::read(f.b.join("Gleich.zip")).unwrap(), b"neu-a");
        assert_eq!(std::fs::read(f.b.join("Gleich (Instanz B).zip")).unwrap(), b"neu-b");

        // Gelöscht vs. geändert: Änderung gewinnt
        touch_later(&f.a.join("Pack.zip"), b"version-a2");
        sync(&f.a, &f.shared, &f.trash, &mut ba, "Instanz A").unwrap();
        std::fs::remove_file(f.b.join("Pack.zip")).unwrap();
        let r = sync(&f.b, &f.shared, &f.trash, &mut bb, "Instanz B").unwrap();
        assert_eq!(r.to_instance, vec!["Pack.zip"]);
        assert_eq!(std::fs::read(f.b.join("Pack.zip")).unwrap(), b"version-a2");
        std::fs::remove_dir_all(&f.base_dir).ok();
    }

    #[test]
    fn disabling_loses_nothing() {
        // „Abschalten“ = Base verwerfen. Alle Dateien sind in der Instanz geblieben; beim erneuten Einschalten wird
        // vereinigt, nie gelöscht.
        let f = fx();
        let mut ba = Base::new();
        std::fs::create_dir_all(&f.shared).unwrap();
        std::fs::write(f.shared.join("Gemeinsam.zip"), b"g").unwrap();
        std::fs::write(f.a.join("Eigen.zip"), b"e").unwrap();
        sync(&f.a, &f.shared, &f.trash, &mut ba, "A").unwrap();
        assert_eq!(names(&f.a), vec!["Eigen.zip", "Gemeinsam.zip"]);
        // Abschalten, in der Instanz und gemeinsam weiterarbeiten
        drop(ba);
        std::fs::remove_file(f.a.join("Gemeinsam.zip")).unwrap();
        std::fs::write(f.a.join("Später.zip"), b"s").unwrap();
        assert_eq!(names(&f.a), vec!["Eigen.zip", "Später.zip"]);
        // Wieder einschalten: frischer Abgleich vereinigt, löscht nichts
        let mut ba = Base::new();
        let r = sync(&f.a, &f.shared, &f.trash, &mut ba, "A").unwrap();
        assert!(r.removed_shared.is_empty() && r.removed_instance.is_empty());
        assert_eq!(names(&f.a), vec!["Eigen.zip", "Gemeinsam.zip", "Später.zip"]);
        assert_eq!(names(&f.shared), vec!["Eigen.zip", "Gemeinsam.zip", "Später.zip"]);
        std::fs::remove_dir_all(&f.base_dir).ok();
    }

    #[test]
    fn collect_screenshots_once() {
        let f = fx();
        let shots = f.base_dir.join("a/screenshots");
        let shared = f.base_dir.join("sync/screenshots");
        std::fs::create_dir_all(&shots).unwrap();
        std::fs::write(shots.join("2026-11-19_10.00.00.png"), b"1").unwrap();
        std::fs::write(shots.join("2026-11-19_10.00.01.png"), b"2").unwrap();
        std::fs::create_dir_all(&shared).unwrap();
        std::fs::write(shared.join("2026-11-19_10.00.01.png"), b"anders").unwrap();
        let mut seen = BTreeSet::new();
        assert_eq!(collect(&shots, &shared, &mut seen, "A").unwrap(), 2);
        assert_eq!(std::fs::read(shared.join("2026-11-19_10.00.01 (A).png")).unwrap(), b"2");
        // Im gemeinsamen Ordner gelöscht -> kommt nicht wieder
        std::fs::remove_file(shared.join("2026-11-19_10.00.00.png")).unwrap();
        assert_eq!(collect(&shots, &shared, &mut seen, "A").unwrap(), 0);
        assert!(!shared.join("2026-11-19_10.00.00.png").exists());
        // Instanz behält alles
        assert_eq!(names(&shots).len(), 2);
        std::fs::remove_dir_all(&f.base_dir).ok();
    }

    #[test]
    fn linked_instance_folder_is_left_alone() {
        let f = fx();
        let target = f.base_dir.join("fremd");
        std::fs::create_dir_all(&target).unwrap();
        let link = f.base_dir.join("c/resourcepacks");
        std::fs::create_dir_all(link.parent().unwrap()).unwrap();
        #[cfg(windows)]
        let ok = std::process::Command::new("cmd").args(["/C", "mklink", "/J"]).arg(&link).arg(&target).output().is_ok_and(|o| o.status.success());
        #[cfg(unix)]
        let ok = std::os::unix::fs::symlink(&target, &link).is_ok();
        if !ok {
            return;
        }
        std::fs::create_dir_all(&f.shared).unwrap();
        std::fs::write(f.shared.join("X.zip"), b"x").unwrap();
        let r = sync(&link, &f.shared, &f.trash, &mut Base::new(), "C").unwrap();
        assert_eq!(r.errors.len(), 1);
        assert!(names(&target).is_empty());
        std::fs::remove_dir_all(&f.base_dir).ok();
    }

    #[test]
    fn trash_prune_and_names() {
        let f = fx();
        std::fs::create_dir_all(&f.trash).unwrap();
        std::fs::write(f.trash.join("20000101-000000_alt.zip"), b"").unwrap();
        std::fs::write(f.trash.join(format!("{}_neu.zip", chrono::Local::now().format("%Y%m%d-%H%M%S"))), b"").unwrap();
        prune_trash(&f.trash);
        assert_eq!(names(&f.trash).len(), 1);
        assert_eq!(unique_name("Pack.zip", "Meine: Instanz", &[&f.a], false), "Pack (Meine_ Instanz).zip");
        assert_eq!(unique_name("Ordner.v2", "A", &[&f.a], true), "Ordner.v2 (A)");
        std::fs::write(f.a.join("Pack (A).zip"), b"").unwrap();
        assert_eq!(unique_name("Pack.zip", "A", &[&f.a], false), "Pack (A 2).zip");
        std::fs::remove_dir_all(&f.base_dir).ok();
    }
}
