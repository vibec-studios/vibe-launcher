//! Operationen des Datei-Bereichs (alle blockierend – Aufrufer nutzen `spawn_blocking`).
use super::sandbox::{check_name, is_link, plain, Resolved};
use super::*;
use crate::error::{AppError, AppResult};
use std::path::{Path, PathBuf};

fn invalid(msg: &str) -> AppError {
    AppError::Invalid(msg.to_string())
}

fn join_rel(dir: &str, name: &str) -> String {
    if dir.is_empty() {
        name.to_string()
    } else {
        format!("{dir}/{name}")
    }
}

fn base_name(rel: &str) -> &str {
    rel.rsplit('/').next().unwrap_or(rel)
}

// ------------------------------------------------------------------ Sicherungen

fn backup_dir(r: &FileRoot, rel: &str) -> PathBuf {
    let mut p = r.backups.clone();
    for c in rel.split('/') {
        p.push(c);
    }
    p
}

/// Sicherungen einer Datei, älteste zuerst (Namen sind sortierbare Zeitstempel).
pub fn list_backups(r: &FileRoot, rel: &str) -> Vec<PathBuf> {
    let Ok(rd) = std::fs::read_dir(backup_dir(r, rel)) else { return Vec::new() };
    let mut v: Vec<PathBuf> = rd
        .flatten()
        .filter(|e| e.file_type().map(|t| t.is_file()).unwrap_or(false))
        .map(|e| e.path())
        .filter(|p| !p.to_string_lossy().ends_with(TMP_SUFFIX))
        .collect();
    v.sort();
    v
}

fn has_backup(r: &FileRoot, rel: &str) -> bool {
    std::fs::read_dir(backup_dir(r, rel))
        .map(|mut rd| rd.any(|e| e.map(|e| e.file_type().map(|t| t.is_file()).unwrap_or(false)).unwrap_or(false)))
        .unwrap_or(false)
}

/// Inhalt als neue Sicherung ablegen und alte über `KEEP_BACKUPS` hinaus löschen.
fn add_backup(r: &FileRoot, rel: &str, data: &[u8]) -> AppResult<PathBuf> {
    let dir = backup_dir(r, rel);
    std::fs::create_dir_all(&dir)?;
    // Name `<ms, 13 Stellen>-<lfd. Nr.>`: muss lexikografisch nach allen vorhandenen liegen
    let mut ts = crate::util::now_ms();
    let mut seq = 0u32;
    if let Some(last) = list_backups(r, rel).last().and_then(|p| p.file_name().map(|n| n.to_string_lossy().to_string())) {
        let (lts, lseq) = last.split_once('-').unwrap_or((last.as_str(), "0"));
        if let Ok(lts) = lts.parse::<i64>() {
            if lts >= ts {
                ts = lts;
                seq = lseq.parse::<u32>().unwrap_or(0) + 1;
            }
        }
    }
    let path = dir.join(format!("{ts:013}-{seq:03}"));
    write_atomic(&path, data)?;
    let all = list_backups(r, rel);
    if all.len() > KEEP_BACKUPS {
        for old in &all[..all.len() - KEEP_BACKUPS] {
            let _ = std::fs::remove_file(old);
        }
    }
    Ok(path)
}

/// Sicherungen beim Umbenennen mitnehmen (best effort).
fn move_backups(r: &FileRoot, from: &str, to: &str) {
    let src = backup_dir(r, from);
    if !src.is_dir() {
        return;
    }
    let dst = backup_dir(r, to);
    if dst.exists() {
        return;
    }
    if let Some(p) = dst.parent() {
        let _ = std::fs::create_dir_all(p);
    }
    let _ = std::fs::rename(src, dst);
}

fn write_atomic(path: &Path, data: &[u8]) -> AppResult<()> {
    let name = path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
    let tmp = path.with_file_name(format!(".{name}{TMP_SUFFIX}"));
    std::fs::write(&tmp, data)?;
    if let Err(e) = std::fs::rename(&tmp, path) {
        let _ = std::fs::remove_file(&tmp);
        return Err(e.into());
    }
    Ok(())
}

// ------------------------------------------------------------------ Auflisten & Suchen

fn entry_for(r: &FileRoot, rel: String, abs: &Path, meta: &std::fs::Metadata) -> FileEntry {
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
fn walk(r: &FileRoot, mut f: impl FnMut(&str, &walkdir::DirEntry) -> bool) -> AppResult<bool> {
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

// ------------------------------------------------------------------ Lesen & Schreiben

pub fn read(r: &FileRoot, rel: &str) -> AppResult<FileContent> {
    let p = r.sandbox.existing(rel, false)?;
    let meta = std::fs::metadata(&p.abs)?;
    if !meta.is_file() {
        return Err(invalid("Das ist keine Datei"));
    }
    let kind = kind_of(&p.rel, &p.abs, meta.len());
    let log = is_log(&p.rel);
    let mut f = FileContent {
        language: language_of(&p.rel),
        has_backup: has_backup(r, &p.rel),
        size: meta.len(),
        modified: mtime_ms(&meta),
        content: String::new(),
        kind,
        readonly: false,
        readonly_reason: None,
        path: p.rel,
    };
    if kind != "text" {
        f.readonly = true;
        f.readonly_reason = Some(if kind == "image" { "image" } else { "binary" });
        return Ok(f);
    }
    let limit = if log { MAX_LOG_VIEW } else { MAX_EDIT };
    if meta.len() > limit {
        f.readonly = true;
        f.readonly_reason = Some("too_large");
        return Ok(f);
    }
    let bytes = std::fs::read(&p.abs)?;
    match String::from_utf8(bytes) {
        Ok(s) => f.content = s.strip_prefix(BOM).map(str::to_string).unwrap_or(s),
        Err(e) => {
            // Nur ansehen – verlustbehaftet zurückschreiben wäre gefährlich
            f.content = String::from_utf8_lossy(e.as_bytes()).into_owned();
            f.readonly = true;
            f.readonly_reason = Some("encoding");
        }
    }
    if log && !f.readonly {
        f.readonly = true;
        f.readonly_reason = Some("log");
    }
    Ok(f)
}

static WRITE_LOCK: parking_lot::Mutex<()> = parking_lot::Mutex::new(());

fn check_writable_text(p: &Resolved, size_hint: u64) -> AppResult<()> {
    if is_log(&p.rel) {
        return Err(invalid("Logs können nur angesehen werden"));
    }
    if p.exists && kind_of(&p.rel, &p.abs, size_hint) != "text" {
        return Err(invalid("Dieser Dateityp kann nicht bearbeitet werden"));
    }
    Ok(())
}

pub fn write(r: &FileRoot, rel: &str, content: &str) -> AppResult<FileContent> {
    let p = r.sandbox.resolve(rel, false)?;
    if !p.exists {
        return Err(AppError::NotFound(p.rel));
    }
    let meta = std::fs::metadata(&p.abs)?;
    if !meta.is_file() {
        return Err(invalid("Das ist keine Datei"));
    }
    check_writable_text(&p, meta.len())?;
    if content.len() as u64 > MAX_EDIT {
        return Err(invalid("Der Inhalt ist größer als 2 MB"));
    }
    let _g = WRITE_LOCK.lock();
    let old = std::fs::read(&p.abs)?;
    let mut data = content.strip_prefix(BOM).unwrap_or(content).to_string();
    let old_s = std::str::from_utf8(&old).map_err(|_| invalid("Die Datei ist nicht UTF-8-kodiert und kann hier nicht bearbeitet werden"))?;
    // Zeilenenden und BOM der Originaldatei beibehalten
    if old_s.contains("\r\n") && !data.contains('\r') {
        data = data.replace('\n', "\r\n");
    }
    if old_s.starts_with(BOM) {
        data.insert(0, BOM);
    }
    if old.as_slice() != data.as_bytes() {
        // Leere Ausgangsdatei (z. B. gerade angelegt) braucht keine Sicherung
        if !old.is_empty() {
            add_backup(r, &p.rel, &old)?;
        }
        write_atomic(&p.abs, data.as_bytes())?;
    }
    drop(_g);
    read(r, &p.rel)
}

/// Neueste Sicherung zurückspielen; der aktuelle Inhalt wird vorher selbst gesichert (rückgängig machbar).
pub fn restore(r: &FileRoot, rel: &str) -> AppResult<FileContent> {
    let p = r.sandbox.resolve(rel, false)?;
    check_writable_text(&p, 0)?;
    let _g = WRITE_LOCK.lock();
    let latest = list_backups(r, &p.rel).pop().ok_or_else(|| AppError::NotFound("Sicherung für diese Datei".into()))?;
    let data = std::fs::read(&latest)?;
    let cur = match std::fs::read(&p.abs) {
        Ok(cur) => Some(cur),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => None,
        Err(e) => return Err(e.into()),
    };
    // Erst die zurückgespielte Sicherung entfernen, dann die aktuelle Fassung sichern –
    // so verdrängt die neue Sicherung keine ältere (Anzahl bleibt gleich).
    std::fs::remove_file(&latest)?;
    let res = (|| -> AppResult<()> {
        if let Some(cur) = cur.as_ref().filter(|c| **c != data) {
            add_backup(r, &p.rel, cur)?;
        }
        write_atomic(&p.abs, &data)
    })();
    if let Err(e) = res {
        // Inhalt der Sicherung nicht verlieren
        let _ = add_backup(r, &p.rel, &data);
        return Err(e);
    }
    drop(_g);
    read(r, &p.rel)
}

/// Bild als data-URL (Vorschau).
pub fn image_data_url(r: &FileRoot, rel: &str) -> AppResult<String> {
    use base64::Engine;
    let p = r.sandbox.existing(rel, false)?;
    if !is_image(&p.rel) {
        return Err(invalid("Keine Bilddatei"));
    }
    let meta = std::fs::metadata(&p.abs)?;
    if !meta.is_file() || meta.len() > MAX_IMAGE {
        return Err(invalid("Das Bild ist zu groß für die Vorschau"));
    }
    let bytes = std::fs::read(&p.abs)?;
    let mime = match ext_of(&p.rel).as_str() {
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "bmp" => "image/bmp",
        _ => "image/png",
    };
    Ok(format!("data:{mime};base64,{}", base64::engine::general_purpose::STANDARD.encode(bytes)))
}

// ------------------------------------------------------------------ Dateiaktionen

/// Neue leere Datei bzw. neuen Ordner in `dir` anlegen. Liefert den relativen Pfad.
pub fn create(r: &FileRoot, dir: &str, name: &str, is_dir: bool) -> AppResult<String> {
    check_name(name)?;
    let d = r.sandbox.existing(dir, true)?;
    if !d.abs.is_dir() {
        return Err(invalid("Das Ziel ist kein Ordner"));
    }
    let p = r.sandbox.resolve(&join_rel(&d.rel, name), false)?;
    if p.exists {
        return Err(AppError::Invalid(format!("„{name}“ gibt es hier schon")));
    }
    if is_dir {
        std::fs::create_dir(&p.abs)?;
    } else {
        std::fs::OpenOptions::new().write(true).create_new(true).open(&p.abs)?;
    }
    Ok(p.rel)
}

/// Umbenennen (bleibt im selben Ordner). Liefert den neuen relativen Pfad.
pub fn rename(r: &FileRoot, rel: &str, new_name: &str) -> AppResult<String> {
    check_name(new_name)?;
    let from = r.sandbox.existing(rel, false)?;
    let to = r.sandbox.resolve(&join_rel(&from.parent_rel(), new_name), false)?;
    if to.rel == from.rel {
        return Ok(to.rel);
    }
    // Nur Groß-/Kleinschreibung geändert: auf Windows/macOS ist das dieselbe Datei
    let case_only = to.rel.to_lowercase() == from.rel.to_lowercase();
    if to.exists && !case_only {
        return Err(AppError::Invalid(format!("„{new_name}“ gibt es hier schon")));
    }
    std::fs::rename(&from.abs, &to.abs)?;
    move_backups(r, &from.rel, &to.rel);
    Ok(to.rel)
}

/// Freien Namen „name (Kopie).ext“ / „name (Kopie 2).ext“ bzw. für Importe „name (2).ext“ finden.
fn free_name(dir_abs: &Path, name: &str, is_dir: bool, copy_label: bool) -> String {
    if !copy_label && std::fs::symlink_metadata(dir_abs.join(name)).is_err() {
        return name.to_string();
    }
    let (stem, ext) = match name.rfind('.') {
        Some(i) if i > 0 && !is_dir => (&name[..i], &name[i..]),
        _ => (name, ""),
    };
    for n in 1..10_000 {
        let tag = match (copy_label, n) {
            (true, 1) => " (Kopie)".to_string(),
            (true, n) => format!(" (Kopie {n})"),
            (false, n) => format!(" ({})", n + 1),
        };
        let cand = format!("{stem}{tag}{ext}");
        if std::fs::symlink_metadata(dir_abs.join(&cand)).is_err() {
            return cand;
        }
    }
    format!("{stem} ({}){ext}", uuid::Uuid::new_v4())
}

/// Kopie neben dem Original. Liefert den relativen Pfad der Kopie.
pub fn duplicate(r: &FileRoot, rel: &str) -> AppResult<String> {
    let src = r.sandbox.existing(rel, false)?;
    let parent = r.sandbox.existing(&src.parent_rel(), true)?;
    let meta = std::fs::metadata(&src.abs)?;
    let name = free_name(&parent.abs, base_name(&src.rel), meta.is_dir(), true);
    let dst = r.sandbox.resolve(&join_rel(&parent.rel, &name), false)?;
    if meta.is_dir() {
        crate::util::copy_dir_all(&src.abs, &dst.abs)?;
    } else {
        std::fs::copy(&src.abs, &dst.abs)?;
    }
    Ok(dst.rel)
}

/// Löschen: in den Papierkorb, oder mit `permanent` endgültig. Klappt der Papierkorb nicht, wird nichts
/// gelöscht und `trash_error` gesetzt (das Frontend fragt dann nach).
pub fn delete(r: &FileRoot, rels: &[String], permanent: bool) -> AppResult<DeleteOutcome> {
    let mut targets = Vec::new();
    for rel in rels {
        targets.push(r.sandbox.existing(rel, false)?);
    }
    // Ordner und darin enthaltene Einträge nicht doppelt löschen
    targets.sort_by_key(|a| a.rel.len());
    let mut uniq: Vec<Resolved> = Vec::new();
    for t in targets {
        if !uniq.iter().any(|u| t.rel == u.rel || t.rel.starts_with(&format!("{}/", u.rel))) {
            uniq.push(t);
        }
    }
    if uniq.is_empty() {
        return Ok(DeleteOutcome { deleted: 0, trashed: false, trash_error: None });
    }
    if !permanent {
        let paths: Vec<PathBuf> = uniq.iter().map(|t| plain(&t.abs)).collect();
        return Ok(match trash::delete_all(&paths) {
            Ok(()) => {
                for t in &uniq {
                    let _ = std::fs::remove_dir_all(backup_dir(r, &t.rel));
                }
                DeleteOutcome { deleted: uniq.len() as u32, trashed: true, trash_error: None }
            }
            Err(e) => {
                tracing::warn!("Papierkorb nicht möglich: {e}");
                // Teilweise verschoben? Dann zählt das, was weg ist
                let gone = uniq.iter().filter(|t| std::fs::symlink_metadata(&t.abs).is_err()).count() as u32;
                DeleteOutcome { deleted: gone, trashed: gone > 0, trash_error: Some(e.to_string()) }
            }
        });
    }
    let mut n = 0;
    for t in &uniq {
        let m = std::fs::symlink_metadata(&t.abs)?;
        if m.is_dir() {
            std::fs::remove_dir_all(&t.abs)?;
        } else {
            std::fs::remove_file(&t.abs)?;
        }
        let _ = std::fs::remove_dir_all(backup_dir(r, &t.rel));
        n += 1;
    }
    Ok(DeleteOutcome { deleted: n, trashed: false, trash_error: None })
}

/// Externe Dateien/Ordner (absolute Pfade, z. B. per Drag & Drop) nach `dir` kopieren. Vorhandene Namen
/// werden nicht überschrieben („name (2).ext“). Liefert die neuen relativen Pfade.
pub fn import(r: &FileRoot, dir: &str, sources: &[String]) -> AppResult<Vec<String>> {
    let d = r.sandbox.existing(dir, true)?;
    if !d.abs.is_dir() {
        return Err(invalid("Das Ziel ist kein Ordner"));
    }
    let target_canon = d.abs.canonicalize()?;
    let mut out = Vec::new();
    for s in sources {
        let src = PathBuf::from(s);
        if !src.is_absolute() {
            return Err(invalid("Quelle muss ein absoluter Pfad sein"));
        }
        let meta = std::fs::metadata(&src).map_err(|_| AppError::NotFound(s.clone()))?;
        let name = src.file_name().map(|n| n.to_string_lossy().to_string()).ok_or_else(|| invalid("Ungültige Quelle"))?;
        check_name(&name)?;
        if meta.is_dir() {
            // Ordner nicht in sich selbst kopieren
            let sc = src.canonicalize()?;
            if target_canon.starts_with(&sc) {
                return Err(invalid("Ein Ordner kann nicht in sich selbst kopiert werden"));
            }
        }
        let fname = free_name(&d.abs, &name, meta.is_dir(), false);
        let dst = r.sandbox.resolve(&join_rel(&d.rel, &fname), false)?;
        if meta.is_dir() {
            crate::util::copy_dir_all(&src, &dst.abs)?;
        } else {
            std::fs::copy(&src, &dst.abs)?;
        }
        out.push(dst.rel);
    }
    Ok(out)
}

/// Absoluter Pfad in normaler Schreibweise (zum Kopieren/Anzeigen).
pub fn abs_path(r: &FileRoot, rel: &str) -> AppResult<PathBuf> {
    let p = r.sandbox.existing(rel, true)?;
    Ok(plain(&p.abs))
}
