//! Welt-Backups (ZIP), Welten zwischen Instanzen kopieren, Welten aus ZIP importieren.
//!
//! ```text
//! <data>/backups/worlds/<instanz>/<weltordner>/<zeitstempel>.zip    ZIP mit "<weltordner>/..." als Wurzel
//! <data>/backups/worlds/<instanz>/<weltordner>/<zeitstempel>.json   {world_name, created, size, auto, fingerprint}
//! ```
//! Backup-ID = `"<weltordner>/<zeitstempel>"`. Große Welten werden in `spawn_blocking` gestreamt,
//! Fortschritt nach Bytes, abbrechbar.
use super::snapshots::{valid_name, Prog, Progress};
use crate::error::{AppError, AppResult};
use crate::paths::Paths;
use crate::state::AppState;
use serde::{Deserialize, Serialize};
use sha1::{Digest, Sha1};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize)]
pub struct WorldBackup {
    /// `"<weltordner>/<zeitstempel>"`
    pub id: String,
    pub folder: String,
    pub world_name: String,
    pub created: i64,
    pub size: u64,
    /// Automatisch angelegt (vor Spielstart / vor Wiederherstellung) – zählt zur Grenze `world_backups_keep`
    pub auto: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Sidecar {
    world_name: String,
    created: i64,
    size: u64,
    #[serde(default)]
    auto: bool,
    #[serde(default)]
    fingerprint: String,
}

/// Dateien, die nie gesichert/kopiert werden (vom laufenden Spiel gesperrt).
const SKIP: &[&str] = &["session.lock"];

fn worlds_root(paths: &Paths, instance_id: &str) -> PathBuf {
    super::snapshots::backups_root(paths).join("worlds").join(instance_id)
}

fn saves(paths: &Paths, instance_id: &str) -> PathBuf {
    paths.game_dir(instance_id).join("saves")
}

fn check_folder(folder: &str) -> AppResult<()> {
    if valid_name(folder) {
        Ok(())
    } else {
        Err(AppError::Invalid(format!("Ungültiger Weltordner: {folder}")))
    }
}

fn parse_id(id: &str) -> AppResult<(&str, &str)> {
    let (folder, stamp) = id.split_once('/').ok_or_else(|| AppError::Invalid(format!("Ungültige Backup-ID: {id}")))?;
    if !valid_name(folder) || !valid_name(stamp) {
        return Err(AppError::Invalid(format!("Ungültige Backup-ID: {id}")));
    }
    Ok((folder, stamp))
}

fn rel_string(base: &Path, p: &Path) -> Option<String> {
    let rel = p.strip_prefix(base).ok()?;
    let parts: Vec<String> = rel.components().map(|c| c.as_os_str().to_string_lossy().to_string()).collect();
    if parts.is_empty() { None } else { Some(parts.join("/")) }
}

/// Dateien und Ordner einer Welt (ohne `session.lock`), sortiert.
type Tree = (Vec<(String, PathBuf, std::fs::Metadata)>, Vec<String>);

fn list_tree(dir: &Path) -> AppResult<Tree> {
    let mut files = Vec::new();
    let mut dirs = Vec::new();
    for e in walkdir::WalkDir::new(dir).min_depth(1).follow_links(false).sort_by_file_name() {
        let e = e.map_err(|e| AppError::msg(format!("Welt nicht lesbar: {e}")))?;
        let Some(rel) = rel_string(dir, e.path()) else { continue };
        if e.file_type().is_dir() {
            dirs.push(rel);
        } else if e.file_type().is_file() && !SKIP.contains(&rel.as_str()) {
            let m = e.metadata().map_err(|e| AppError::msg(format!("Welt nicht lesbar: {e}")))?;
            files.push((rel, e.path().to_path_buf(), m));
        }
    }
    Ok((files, dirs))
}

/// Fingerabdruck aus Pfad + Größe + Änderungszeit aller Dateien (ändert sich, sobald gespielt wurde).
fn fingerprint(dir: &Path) -> AppResult<String> {
    let (files, _) = list_tree(dir)?;
    let mut h = Sha1::new();
    for (rel, _, m) in files {
        let mt = m.modified().ok().and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_millis()).unwrap_or(0);
        h.update(rel.as_bytes());
        h.update([0]);
        h.update(m.len().to_le_bytes());
        h.update(mt.to_le_bytes());
    }
    Ok(hex::encode(h.finalize()))
}

/// Leser, der Bytes zählt, Fortschritt meldet und Abbruch prüft.
struct Counting<'a, R, P> {
    inner: R,
    done: &'a mut u64,
    total: u64,
    prog: &'a P,
    last: u64,
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

fn copy_counting(r: impl Read, w: &mut impl Write, done: &mut u64, total: u64, prog: &impl Prog) -> AppResult<()> {
    let last = *done;
    let mut c = Counting { inner: r, done, total, prog, last };
    match std::io::copy(&mut c, w) {
        Ok(_) => Ok(()),
        Err(_) if prog.check().is_err() => Err(AppError::Cancelled),
        Err(e) => Err(e.into()),
    }
}

/// Weltordner als ZIP schreiben (Einträge unter `<prefix>/`). Gibt die Größe der ZIP zurück.
fn zip_dir(src: &Path, prefix: &str, out: &Path, prog: &impl Prog) -> AppResult<u64> {
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
fn find_root<R: Read + std::io::Seek>(zip: &zip::ZipArchive<R>) -> Option<String> {
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
fn extract(zip_path: &Path, prefix: Option<&str>, dest: &Path, prog: &impl Prog) -> AppResult<()> {
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

fn tmp_dir(saves: &Path, what: &str) -> PathBuf {
    saves.join(format!(".vl-{what}-{}", &uuid::Uuid::new_v4().simple().to_string()[..8]))
}

fn world_name(dir: &Path, folder: &str) -> String {
    super::worlds::read_world(dir).map(|w| w.name).unwrap_or_else(|| folder.to_string())
}

// ------------------------------------------------------------------ Kernabläufe (blockierend)

fn stamp(dir: &Path) -> String {
    let base = chrono::Local::now().format("%Y-%m-%d_%H-%M-%S").to_string();
    if !dir.join(format!("{base}.zip")).exists() {
        return base;
    }
    (2..).map(|n| format!("{base}_{n}")).find(|s| !dir.join(format!("{s}.zip")).exists()).unwrap_or(base)
}

fn backup_sync(paths: &Paths, instance_id: &str, folder: &str, auto: bool, prog: &impl Prog) -> AppResult<WorldBackup> {
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

fn read_backup(folder: &str, zip: &Path) -> Option<(WorldBackup, String)> {
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
fn list_world(paths: &Paths, instance_id: &str, folder: &str) -> Vec<(WorldBackup, String)> {
    let Ok(rd) = std::fs::read_dir(worlds_root(paths, instance_id).join(folder)) else { return vec![] };
    let mut v: Vec<_> = rd.flatten().map(|e| e.path()).filter(|p| p.extension().is_some_and(|e| e == "zip")).filter_map(|p| read_backup(folder, &p)).collect();
    v.sort_by(|a, b| b.0.created.cmp(&a.0.created).then(b.0.id.cmp(&a.0.id)));
    v
}

fn list_sync(paths: &Paths, instance_id: &str) -> Vec<WorldBackup> {
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

fn delete_sync(paths: &Paths, instance_id: &str, id: &str) -> AppResult<()> {
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
fn prune(paths: &Paths, instance_id: &str, folder: &str, keep: u32, protect: &[&str]) -> usize {
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

fn restore_sync<P: Prog>(paths: &Paths, instance_id: &str, id: &str, keep: u32, prog: &P) -> AppResult<()> {
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

fn copy_sync(paths: &Paths, instance_id: &str, folder: &str, target_id: &str, prog: &impl Prog) -> AppResult<String> {
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

fn import_sync(paths: &Paths, instance_id: &str, zip_path: &Path, prog: &impl Prog) -> AppResult<String> {
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
fn changed_worlds(paths: &Paths, instance_id: &str) -> Vec<String> {
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

fn size_text(n: u64) -> String {
    if n >= 1 << 30 {
        format!("{:.1} GB", n as f64 / (1u64 << 30) as f64)
    } else if n >= 1 << 20 {
        format!("{:.1} MB", n as f64 / (1u64 << 20) as f64)
    } else {
        format!("{} KB", n.div_ceil(1024))
    }
}

// ------------------------------------------------------------------ Öffentliche API

/// Eine Welt-Operation je Instanz zur Zeit genügt – global gesperrt (einfach, Welten sind groß).
static LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

fn not_running(state: &AppState, instance_id: &str) -> AppResult<()> {
    if state.game.is_running(instance_id) {
        return Err(AppError::Invalid("Die Instanz läuft gerade – bitte zuerst das Spiel beenden.".into()));
    }
    Ok(())
}

pub async fn create(state: &AppState, instance_id: &str, folder: &str, progress: Option<&crate::tasks::SubProgress>) -> AppResult<WorldBackup> {
    state.instances.get(instance_id)?;
    check_folder(folder)?;
    let _g = LOCK.lock().await;
    let (paths, iid, f, prog) = (state.paths.clone(), instance_id.to_string(), folder.to_string(), Progress::from(progress));
    let b = tokio::task::spawn_blocking(move || backup_sync(&paths, &iid, &f, false, &prog)).await??;
    state.content.emit_changed(instance_id);
    Ok(b)
}

pub async fn list(state: &AppState, instance_id: &str) -> AppResult<Vec<WorldBackup>> {
    state.instances.get(instance_id)?;
    let (paths, iid) = (state.paths.clone(), instance_id.to_string());
    Ok(tokio::task::spawn_blocking(move || list_sync(&paths, &iid)).await?)
}

pub async fn restore(state: &AppState, instance_id: &str, backup_id: &str, progress: Option<&crate::tasks::SubProgress>) -> AppResult<()> {
    state.instances.get(instance_id)?;
    parse_id(backup_id)?;
    not_running(state, instance_id)?;
    let _g = LOCK.lock().await;
    let keep = state.settings().world_backups_keep;
    let (paths, iid, id, prog) = (state.paths.clone(), instance_id.to_string(), backup_id.to_string(), Progress::from(progress));
    let res = tokio::task::spawn_blocking(move || restore_sync(&paths, &iid, &id, keep, &prog)).await?;
    state.content.emit_changed(instance_id);
    res
}

pub async fn delete(state: &AppState, instance_id: &str, backup_id: &str) -> AppResult<()> {
    if !valid_name(instance_id) {
        return Err(AppError::NotFound("Welt-Backup".into()));
    }
    let _g = LOCK.lock().await;
    let (paths, iid, id) = (state.paths.clone(), instance_id.to_string(), backup_id.to_string());
    tokio::task::spawn_blocking(move || delete_sync(&paths, &iid, &id)).await??;
    state.content.emit_changed(instance_id);
    Ok(())
}

/// Welt in eine andere (oder dieselbe) Instanz kopieren. Gibt den neuen Ordnernamen zurück.
pub async fn copy(state: &AppState, instance_id: &str, folder: &str, target_id: &str, progress: Option<&crate::tasks::SubProgress>) -> AppResult<String> {
    state.instances.get(instance_id)?;
    state.instances.get(target_id)?;
    check_folder(folder)?;
    let (paths, iid, f, tid, prog) = (state.paths.clone(), instance_id.to_string(), folder.to_string(), target_id.to_string(), Progress::from(progress));
    let name = tokio::task::spawn_blocking(move || copy_sync(&paths, &iid, &f, &tid, &prog)).await??;
    state.content.emit_changed(target_id);
    Ok(name)
}

/// Welt aus einer ZIP importieren. Gibt den neuen Ordnernamen zurück.
pub async fn import_zip(state: &AppState, instance_id: &str, path: &Path, progress: Option<&crate::tasks::SubProgress>) -> AppResult<String> {
    state.instances.get(instance_id)?;
    let (paths, iid, p, prog) = (state.paths.clone(), instance_id.to_string(), path.to_path_buf(), Progress::from(progress));
    let name = tokio::task::spawn_blocking(move || import_sync(&paths, &iid, &p, &prog)).await??;
    state.content.emit_changed(instance_id);
    Ok(name)
}

/// Vor dem Spielstart: geänderte Welten sichern, wenn `world_backup_on_launch` an ist. Lässt den
/// Start nie scheitern – Probleme landen im Spiel-Log.
pub async fn before_launch(state: &AppState, instance_id: &str, task: &crate::tasks::TaskHandle) {
    let settings = state.settings();
    if !settings.world_backup_on_launch {
        return;
    }
    let log = |msg: String| state.game.launcher_line(instance_id, crate::minecraft::LogLevel::Launcher, msg);
    let _g = LOCK.lock().await;
    let (paths, iid) = (state.paths.clone(), instance_id.to_string());
    let todo = match tokio::task::spawn_blocking(move || changed_worlds(&paths, &iid)).await {
        Ok(v) => v,
        Err(e) => return log(format!("Welt-Backup übersprungen: {e}")),
    };
    if todo.is_empty() {
        log("Welt-Backup: keine geänderten Welten".into());
        return;
    }
    task.stage("Welten werden gesichert …", Some(0.0));
    task.set_step(Some(crate::minecraft::prelaunch::STEP_WORLD_BACKUP));
    let n = todo.len();
    let mut any = false;
    for (i, folder) in todo.into_iter().enumerate() {
        let prog = Progress(Some(task.sub(i as f64 / n as f64, (i + 1) as f64 / n as f64)));
        if let Err(e) = crate::util::spacecheck::for_world_backup(&state.paths, saves(&state.paths, instance_id).join(&folder)).await {
            log(format!("Welt-Backup übersprungen: {e}"));
            break;
        }
        let (paths, iid, f, keep) = (state.paths.clone(), instance_id.to_string(), folder.clone(), settings.world_backups_keep);
        let res = tokio::task::spawn_blocking(move || {
            let b = backup_sync(&paths, &iid, &f, true, &prog)?;
            prune(&paths, &iid, &f, keep, &[]);
            Ok::<_, AppError>(b)
        })
        .await;
        match res {
            Ok(Ok(b)) => {
                any = true;
                log(format!("Welt-Backup: „{}“ gesichert ({})", b.world_name, size_text(b.size)));
            }
            Ok(Err(AppError::Cancelled)) => {
                log("Welt-Backup abgebrochen".into());
                break;
            }
            Ok(Err(e)) => log(format!("Welt-Backup von {folder} fehlgeschlagen: {e}")),
            Err(e) => log(format!("Welt-Backup von {folder} fehlgeschlagen: {e}")),
        }
    }
    task.set_step(None);
    if any {
        state.content.emit_changed(instance_id);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn paths() -> (Paths, PathBuf) {
        let base = std::env::temp_dir().join(format!("vl-wb-{}", uuid::Uuid::new_v4()));
        (Paths { root: base.clone() }, base)
    }

    fn mk_world(paths: &Paths, iid: &str, folder: &str) -> PathBuf {
        let d = saves(paths, iid).join(folder);
        std::fs::create_dir_all(d.join("region")).unwrap();
        std::fs::create_dir_all(d.join("data")).unwrap();
        std::fs::write(d.join("level.dat"), b"nicht-nbt").unwrap();
        std::fs::write(d.join("region/r.0.0.mca"), vec![7u8; 300_000]).unwrap();
        std::fs::write(d.join("session.lock"), b"x").unwrap();
        d
    }

    fn tree(dir: &Path) -> Vec<(String, Vec<u8>)> {
        let (files, dirs) = list_tree(dir).unwrap();
        let mut v: Vec<_> = files.into_iter().map(|(r, p, _)| (r, std::fs::read(p).unwrap())).collect();
        v.extend(dirs.into_iter().map(|d| (format!("{d}/"), vec![])));
        v
    }

    #[test]
    fn backup_restore_roundtrip() {
        let (p, base) = paths();
        let d = mk_world(&p, "i1", "Welt");
        let before = tree(&d);
        let b = backup_sync(&p, "i1", "Welt", false, &()).unwrap();
        assert_eq!(b.id.split_once('/').unwrap().0, "Welt");
        assert!(changed_worlds(&p, "i1").is_empty());
        std::fs::write(d.join("region/r.0.0.mca"), b"kaputt").unwrap();
        std::fs::write(d.join("neu.txt"), b"neu").unwrap();
        assert_eq!(changed_worlds(&p, "i1"), vec!["Welt".to_string()]);
        restore_sync(&p, "i1", &b.id, 5, &()).unwrap();
        assert_eq!(tree(&d), before);
        // Vorher wurde automatisch gesichert
        let all = list_sync(&p, "i1");
        assert_eq!(all.len(), 2);
        assert!(all.iter().any(|x| x.auto));
        // Keine Reste
        let leftovers: Vec<_> = std::fs::read_dir(saves(&p, "i1")).unwrap().flatten().filter(|e| e.file_name().to_string_lossy().starts_with(".vl-")).collect();
        assert!(leftovers.is_empty());
        delete_sync(&p, "i1", &b.id).unwrap();
        assert_eq!(list_sync(&p, "i1").len(), 1);
        std::fs::remove_dir_all(&base).ok();
    }

    #[test]
    fn copy_and_import_unique_names() {
        let (p, base) = paths();
        mk_world(&p, "i1", "Welt");
        assert_eq!(copy_sync(&p, "i1", "Welt", "i2", &()).unwrap(), "Welt");
        assert_eq!(copy_sync(&p, "i1", "Welt", "i2", &()).unwrap(), "Welt (2)");
        assert_eq!(copy_sync(&p, "i1", "Welt", "i1", &()).unwrap(), "Welt (2)");
        assert!(!saves(&p, "i2").join("Welt (2)/session.lock").exists());
        // Import: Backup-ZIP hat "Welt/" als Wurzel
        let b = backup_sync(&p, "i1", "Welt", false, &()).unwrap();
        let zip = worlds_root(&p, "i1").join(&b.id).with_extension("zip");
        assert_eq!(import_sync(&p, "i2", &zip, &()).unwrap(), "Welt (3)");
        assert!(saves(&p, "i2").join("Welt (3)/region/r.0.0.mca").is_file());
        // ZIP mit level.dat direkt in der Wurzel -> Name aus dem Dateinamen
        let flat = base.join("Meine Karte.zip");
        {
            let mut w = zip::ZipWriter::new(std::fs::File::create(&flat).unwrap());
            w.start_file("level.dat", zip::write::SimpleFileOptions::default()).unwrap();
            w.write_all(b"lvl").unwrap();
            w.finish().unwrap();
        }
        assert_eq!(import_sync(&p, "i2", &flat, &()).unwrap(), "Meine Karte");
        assert!(unique_folder(&saves(&p, "i2"), "a/b").starts_with("a_b"));
        assert_eq!(unique_folder(&saves(&p, "i2"), ".."), "unnamed");
        std::fs::remove_dir_all(&base).ok();
    }

    #[test]
    fn zip_slip_is_rejected() {
        let (p, base) = paths();
        std::fs::create_dir_all(&base).unwrap();
        let evil = base.join("evil.zip");
        {
            let mut w = zip::ZipWriter::new(std::fs::File::create(&evil).unwrap());
            let o = zip::write::SimpleFileOptions::default();
            w.start_file("Welt/level.dat", o).unwrap();
            w.write_all(b"lvl").unwrap();
            w.start_file("Welt/../../../boese.txt", o).unwrap();
            w.write_all(b"x").unwrap();
            w.finish().unwrap();
        }
        let err = import_sync(&p, "i1", &evil, &()).unwrap_err();
        assert!(matches!(err, AppError::Invalid(_)), "{err}");
        assert!(!base.join("boese.txt").exists());
        assert!(!p.game_dir("i1").join("boese.txt").exists());
        // Keine halben Ordner
        let n = std::fs::read_dir(saves(&p, "i1")).unwrap().count();
        assert_eq!(n, 0);
        // Keine Welt in der ZIP
        let none = base.join("none.zip");
        {
            let mut w = zip::ZipWriter::new(std::fs::File::create(&none).unwrap());
            w.start_file("a/b/level.dat", zip::write::SimpleFileOptions::default()).unwrap();
            w.finish().unwrap();
        }
        assert!(import_sync(&p, "i1", &none, &()).is_err());
        std::fs::remove_dir_all(&base).ok();
    }

    #[test]
    fn prune_auto_backups() {
        let (p, base) = paths();
        mk_world(&p, "i1", "W");
        let manual = backup_sync(&p, "i1", "W", false, &()).unwrap();
        for _ in 0..4 {
            backup_sync(&p, "i1", "W", true, &()).unwrap();
        }
        assert_eq!(prune(&p, "i1", "W", 2, &[]), 2);
        let left = list_sync(&p, "i1");
        assert_eq!(left.len(), 3);
        assert!(left.iter().any(|b| b.id == manual.id));
        assert!(parse_id("../x").is_err());
        assert!(parse_id("W/..").is_err());
        std::fs::remove_dir_all(&base).ok();
    }
}
