//! Instanz-Snapshots: Mods, Configs, Packs und Optionen einer Instanz (keine Welten).
//!
//! ```text
//! <data>/backups/objects/<ab>/<sha1>               Inhalte, nach SHA-1 adressiert (dedupliziert)
//! <data>/backups/snapshots/<instanz>/<id>.json     Manifest: Dateien {rel_path, sha1, size} + Metadaten
//! <data>/backups/snapshots/<instanz>/hashes.cache  SHA-1-Cache für .jar/.zip (Größe + Änderungszeit)
//! ```
//!
//! `.jar`/`.zip` werden nie an Ort und Stelle verändert (Updates schreiben neue Dateien) – sie werden
//! deshalb per Hardlink abgelegt bzw. wiederhergestellt. Alles andere (Configs!) wird kopiert. Klappt
//! ein Hardlink nicht (anderes Laufwerk), wird ebenfalls kopiert. Beim Löschen eines Snapshots werden
//! Objekte entfernt, auf die kein Manifest mehr verweist.
//!
//! Teil-Snapshots: Ein Snapshot kann nur einige [`SCOPES`] enthalten (z. B. nur Mods vor „Probleme beheben“).
//! Das Manifest merkt sich die Bereiche (`scopes`); beim Wiederherstellen werden ausschließlich diese Bereiche
//! angefasst – ein Snapshot ohne Resourcepacks lässt den Resourcepacks-Ordner also in Ruhe. `content.json` wird
//! dabei nur für die enthaltenen Ordner zurückgesetzt (Einträge anderer Ordner bleiben, wie sie sind).
use crate::error::{AppError, AppResult};
use crate::paths::Paths;
use crate::state::AppState;
use crate::tasks::SubProgress;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};

/// Ordner im Spielordner, die zum Snapshot gehören.
pub const DIRS: &[&str] = &["mods", "resourcepacks", "shaderpacks", "datapacks", "config", "defaultconfigs", "kubejs"];
/// Einzeldateien im Spielordner.
pub const FILES: &[&str] = &["options.txt", "optionsof.txt", "optionsshaders.txt"];
/// Metadaten im Instanzordner.
pub const META: &[&str] = &["content.json", "pack.json", "modsets.json"];

/// Bereiche für Teil-Snapshots (Reihenfolge = Anzeige).
pub const SCOPES: &[&str] = &["mods", "configs", "resourcepacks", "shaderpacks", "datapacks", "options"];

pub const RESTORE_NAME: &str = "Vor Wiederherstellung";

/// Ordner eines Bereichs.
fn scope_dirs(scope: &str) -> &'static [&'static str] {
    match scope {
        "mods" => &["mods"],
        "configs" => &["config", "defaultconfigs", "kubejs"],
        "resourcepacks" => &["resourcepacks"],
        "shaderpacks" => &["shaderpacks"],
        "datapacks" => &["datapacks"],
        _ => &[],
    }
}

/// Auswahl der Bereiche eines Snapshots. `None` = alles (auch alte Manifeste ohne Angabe).
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Sel(Option<Vec<String>>);

impl Sel {
    pub fn all() -> Sel {
        Sel(None)
    }
    /// Unbekannte Bereiche werden ignoriert; alle Bereiche zusammen = vollständiger Snapshot.
    pub fn of(scopes: &[String]) -> Sel {
        let v: Vec<String> = SCOPES.iter().filter(|s| scopes.iter().any(|x| x == *s)).map(|s| s.to_string()).collect();
        if v.len() == SCOPES.len() {
            Sel(None)
        } else {
            Sel(Some(v))
        }
    }
    pub fn from_manifest(m: &Option<Vec<String>>) -> Sel {
        match m {
            None => Sel(None),
            Some(v) => Sel::of(v),
        }
    }
    pub fn has(&self, scope: &str) -> bool {
        self.0.as_ref().map_or(true, |v| v.iter().any(|s| s == scope))
    }
    pub fn is_all(&self) -> bool {
        self.0.is_none()
    }
    pub fn scopes(&self) -> Option<Vec<String>> {
        self.0.clone()
    }
    fn dirs(&self) -> Vec<&'static str> {
        DIRS.iter().copied().filter(|d| SCOPES.iter().any(|s| self.has(s) && scope_dirs(s).contains(d))).collect()
    }
    fn files(&self) -> &'static [&'static str] {
        if self.has("options") {
            FILES
        } else {
            &[]
        }
    }
    /// Metadaten: content.json, sobald ein Inhalte-Ordner dabei ist; pack.json/modsets.json gehören zu den Mods.
    fn meta(&self) -> Vec<&'static str> {
        let mut v = vec![];
        if !self.content_prefixes().is_empty() {
            v.push("content.json");
        }
        if self.has("mods") {
            v.extend(["pack.json", "modsets.json"]);
        }
        v
    }
    /// Ordner, deren content.json-Einträge zum Snapshot gehören.
    fn content_prefixes(&self) -> Vec<&'static str> {
        ["mods", "resourcepacks", "shaderpacks", "datapacks"].into_iter().filter(|d| self.dirs().contains(d)).collect()
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct SnapshotInfo {
    pub id: String,
    pub name: String,
    pub created: i64,
    pub auto: bool,
    pub file_count: u32,
    pub size: u64,
    /// Enthaltene Bereiche bei Teil-Snapshots (`None` = vollständig)
    pub scopes: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct FileEntry {
    pub rel_path: String,
    pub sha1: String,
    pub size: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct Manifest {
    #[serde(default = "one")]
    pub version: u32,
    pub id: String,
    pub name: String,
    pub created: i64,
    #[serde(default)]
    pub auto: bool,
    /// Relativ zum Spielordner
    #[serde(default)]
    pub files: Vec<FileEntry>,
    /// Ordner (auch leere), relativ zum Spielordner
    #[serde(default)]
    pub dirs: Vec<String>,
    /// Relativ zum Instanzordner
    #[serde(default)]
    pub meta: Vec<FileEntry>,
    /// Enthaltene Bereiche (Teil-Snapshot); fehlt = vollständig
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub scopes: Option<Vec<String>>,
}

fn one() -> u32 {
    1
}

impl Manifest {
    pub fn info(&self) -> SnapshotInfo {
        SnapshotInfo {
            id: self.id.clone(),
            name: self.name.clone(),
            created: self.created,
            auto: self.auto,
            file_count: (self.files.len() + self.meta.len()) as u32,
            size: self.files.iter().chain(&self.meta).map(|f| f.size).sum(),
            scopes: self.scopes.clone(),
        }
    }
    pub fn sel(&self) -> Sel {
        Sel::from_manifest(&self.scopes)
    }
}

/// Fortschritt + Abbruch für die blockierenden Kernabläufe. Generisch, damit die Unit-Tests ohne
/// Tauri-Laufzeit auskommen (`()` = kein Fortschritt).
pub(crate) trait Prog: Clone + Send + 'static {
    fn set(&self, p: f64);
    fn message(&self, m: &str);
    fn check(&self) -> AppResult<()>;
    fn sub(&self, from: f64, to: f64) -> Self;
}

/// Fortschritt einer Aufgabe (optional).
#[derive(Clone, Default)]
pub(crate) struct Progress(pub Option<SubProgress>);

impl Progress {
    pub fn from(p: Option<&SubProgress>) -> Self {
        Progress(p.cloned())
    }
}

impl Prog for Progress {
    fn set(&self, p: f64) {
        if let Some(s) = &self.0 {
            s.progress(p);
        }
    }
    fn message(&self, m: &str) {
        if let Some(s) = &self.0 {
            s.message(m);
        }
    }
    fn check(&self) -> AppResult<()> {
        match &self.0 {
            Some(s) => s.check(),
            None => Ok(()),
        }
    }
    fn sub(&self, from: f64, to: f64) -> Progress {
        Progress(self.0.as_ref().map(|s| s.sub(from, to)))
    }
}

#[cfg(test)]
impl Prog for () {
    fn set(&self, _: f64) {}
    fn message(&self, _: &str) {}
    fn check(&self) -> AppResult<()> {
        Ok(())
    }
    fn sub(&self, _: f64, _: f64) {}
}

// ------------------------------------------------------------------ Pfade

pub(crate) fn backups_root(paths: &Paths) -> PathBuf {
    paths.root.join("backups")
}

fn object_path(root: &Path, sha1: &str) -> PathBuf {
    root.join("objects").join(&sha1[..2.min(sha1.len())]).join(sha1)
}

fn snapshot_dir(root: &Path, instance_id: &str) -> PathBuf {
    root.join("snapshots").join(instance_id)
}

/// IDs/Ordnernamen aus dem Frontend prüfen (kein Ausbruch aus dem Ordner).
pub(crate) fn valid_name(s: &str) -> bool {
    !s.is_empty() && s != "." && s != ".." && !s.contains(['/', '\\', ':']) && !s.chars().any(|c| c.is_control())
}

fn check_id(id: &str, what: &str) -> AppResult<()> {
    if valid_name(id) {
        Ok(())
    } else {
        Err(AppError::Invalid(format!("Ungültige {what}: {id}")))
    }
}

/// Wird per Hardlink abgelegt (wird nie an Ort und Stelle verändert)?
fn linkable(rel: &str) -> bool {
    let l = rel.to_ascii_lowercase();
    let l = l.strip_suffix(".disabled").unwrap_or(&l);
    l.ends_with(".jar") || l.ends_with(".zip")
}

fn rel_string(base: &Path, p: &Path) -> Option<String> {
    let rel = p.strip_prefix(base).ok()?;
    let parts: Vec<String> = rel.components().map(|c| c.as_os_str().to_string_lossy().to_string()).collect();
    if parts.is_empty() { None } else { Some(parts.join("/")) }
}

fn mtime_ms(m: &std::fs::Metadata) -> i64 {
    m.modified().ok().and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_millis() as i64).unwrap_or(0)
}

// ------------------------------------------------------------------ Bestand einlesen

struct Found {
    /// (rel_path, absoluter Pfad, Größe, mtime)
    files: Vec<(String, PathBuf, u64, i64)>,
    dirs: Vec<String>,
    meta: Vec<(String, PathBuf, u64)>,
}

fn scan(game: &Path, inst: &Path, sel: &Sel) -> AppResult<Found> {
    let mut files = Vec::new();
    let mut dirs = Vec::new();
    for d in sel.dirs() {
        let root = game.join(d);
        if !root.is_dir() {
            continue;
        }
        for e in walkdir::WalkDir::new(&root).follow_links(false) {
            let e = e.map_err(|e| AppError::msg(format!("Ordner nicht lesbar: {e}")))?;
            let Some(rel) = rel_string(game, e.path()) else { continue };
            if e.file_type().is_dir() {
                dirs.push(rel);
            } else if e.file_type().is_file() {
                let m = e.metadata().map_err(|e| AppError::msg(format!("Datei nicht lesbar: {e}")))?;
                files.push((rel, e.path().to_path_buf(), m.len(), mtime_ms(&m)));
            }
        }
    }
    for f in sel.files() {
        let p = game.join(f);
        if let Ok(m) = std::fs::metadata(&p) {
            if m.is_file() {
                files.push((f.to_string(), p, m.len(), mtime_ms(&m)));
            }
        }
    }
    let mut meta = Vec::new();
    for f in sel.meta() {
        let p = inst.join(f);
        if let Ok(m) = std::fs::metadata(&p) {
            if m.is_file() {
                meta.push((f.to_string(), p, m.len()));
            }
        }
    }
    files.sort_by(|a, b| a.0.cmp(&b.0));
    dirs.sort();
    Ok(Found { files, dirs, meta })
}

// ------------------------------------------------------------------ Hash-Cache (nur .jar/.zip)

type HashCache = HashMap<String, (u64, i64, String)>;

fn load_cache(root: &Path, instance_id: &str) -> HashCache {
    std::fs::read(snapshot_dir(root, instance_id).join("hashes.cache")).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default()
}

fn save_cache(root: &Path, instance_id: &str, cache: &HashCache) {
    let p = snapshot_dir(root, instance_id).join("hashes.cache");
    if let Err(e) = crate::util::write_json_atomic(&p, cache) {
        tracing::debug!("Hash-Cache nicht gespeichert: {e}");
    }
}

fn hash_cached(cache: &mut HashCache, rel: &str, path: &Path, size: u64, mtime: i64) -> AppResult<String> {
    if linkable(rel) {
        if let Some((s, m, h)) = cache.get(rel) {
            if *s == size && *m == mtime && mtime != 0 {
                return Ok(h.clone());
            }
        }
    }
    let h = crate::net::sha1_file(path).map_err(|e| AppError::msg(format!("{rel} nicht lesbar: {e}")))?;
    if linkable(rel) {
        cache.insert(rel.to_string(), (size, mtime, h.clone()));
    }
    Ok(h)
}

// ------------------------------------------------------------------ Objekte

fn tmp_name(p: &Path) -> PathBuf {
    let name = p.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
    p.with_file_name(format!(".{name}.vl-{}", &uuid::Uuid::new_v4().simple().to_string()[..8]))
}

/// Datei in den Objektspeicher legen (Hardlink für `.jar`/`.zip`, sonst Kopie).
fn store_object(root: &Path, src: &Path, sha1: &str, size: u64, link: bool) -> std::io::Result<()> {
    let obj = object_path(root, sha1);
    if let Ok(m) = std::fs::metadata(&obj) {
        if m.len() == size {
            return Ok(());
        }
        std::fs::remove_file(&obj)?;
    }
    if let Some(p) = obj.parent() {
        std::fs::create_dir_all(p)?;
    }
    if link && std::fs::hard_link(src, &obj).is_ok() {
        return Ok(());
    }
    let tmp = tmp_name(&obj);
    if let Err(e) = std::fs::copy(src, &tmp).and_then(|_| std::fs::rename(&tmp, &obj)) {
        let _ = std::fs::remove_file(&tmp);
        return Err(e);
    }
    Ok(())
}

/// Objekt an `target` ablegen (Hardlink oder Kopie, atomar über eine temporäre Datei).
fn place_object(obj: &Path, target: &Path, link: bool) -> std::io::Result<()> {
    if let Some(p) = target.parent() {
        std::fs::create_dir_all(p)?;
    }
    let tmp = tmp_name(target);
    let linked = link && std::fs::hard_link(obj, &tmp).is_ok();
    if !linked {
        if let Err(e) = std::fs::copy(obj, &tmp) {
            let _ = std::fs::remove_file(&tmp);
            return Err(e);
        }
    }
    if let Err(e) = std::fs::rename(&tmp, target) {
        let _ = std::fs::remove_file(&tmp);
        return Err(e);
    }
    Ok(())
}

// ------------------------------------------------------------------ Manifeste

fn read_manifest(path: &Path) -> AppResult<Manifest> {
    let b = std::fs::read(path)?;
    Ok(serde_json::from_slice(&b)?)
}

fn manifests(root: &Path, instance_id: &str) -> Vec<Manifest> {
    let Ok(rd) = std::fs::read_dir(snapshot_dir(root, instance_id)) else { return vec![] };
    let mut v: Vec<Manifest> = rd
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.extension().is_some_and(|e| e == "json"))
        .filter_map(|p| match read_manifest(&p) {
            Ok(m) => Some(m),
            Err(e) => {
                tracing::warn!("Snapshot-Manifest {p:?} unlesbar: {e}");
                None
            }
        })
        .collect();
    v.sort_by(|a, b| b.created.cmp(&a.created).then(b.id.cmp(&a.id)));
    v
}

fn load(root: &Path, instance_id: &str, snapshot_id: &str) -> AppResult<Manifest> {
    let p = snapshot_dir(root, instance_id).join(format!("{snapshot_id}.json"));
    if !p.exists() {
        return Err(AppError::NotFound("Snapshot".into()));
    }
    read_manifest(&p).map_err(|e| AppError::msg(format!("Snapshot ist beschädigt: {e}")))
}

/// Alle Objekte müssen vorhanden sein und die richtige Größe haben.
fn verify(root: &Path, m: &Manifest) -> AppResult<()> {
    for f in m.files.iter().chain(&m.meta) {
        let ok = std::fs::metadata(object_path(root, &f.sha1)).is_ok_and(|md| md.len() == f.size);
        if !ok {
            return Err(AppError::msg(format!("Snapshot ist beschädigt: Inhalt von {} fehlt im Speicher", f.rel_path)));
        }
    }
    Ok(())
}

fn write_atomic(target: &Path, data: &[u8]) -> std::io::Result<()> {
    if let Some(p) = target.parent() {
        std::fs::create_dir_all(p)?;
    }
    let tmp = tmp_name(target);
    if let Err(e) = std::fs::write(&tmp, data).and_then(|_| std::fs::rename(&tmp, target)) {
        let _ = std::fs::remove_file(&tmp);
        return Err(e);
    }
    Ok(())
}

/// content.json für einen Teil-Snapshot zusammenführen: Einträge (`files`, `local`, `pinned`) der Ordner `prefixes`
/// kommen aus dem Snapshot, alle anderen bleiben wie aktuell. `unknown` (Hash-Cache) wird vereinigt. Generisch über
/// JSON, damit unbekannte Felder erhalten bleiben.
fn merge_index(current: Option<&[u8]>, snap: Option<&[u8]>, prefixes: &[&str]) -> Vec<u8> {
    use serde_json::{Map, Value};
    let parse = |b: Option<&[u8]>| -> Map<String, Value> {
        b.and_then(|b| serde_json::from_slice::<Value>(b).ok()).and_then(|v| v.as_object().cloned()).unwrap_or_default()
    };
    let ours = |k: &str| prefixes.iter().any(|p| k.split('/').next() == Some(p));
    let mut cur = parse(current);
    let snap = parse(snap);
    for field in ["files", "local"] {
        let mut map: Map<String, Value> = cur.get(field).and_then(|v| v.as_object().cloned()).unwrap_or_default();
        map.retain(|k, _| !ours(k));
        if let Some(Value::Object(s)) = snap.get(field) {
            for (k, v) in s {
                if ours(k) {
                    map.insert(k.clone(), v.clone());
                }
            }
        }
        cur.insert(field.into(), Value::Object(map));
    }
    let mut pinned: Vec<Value> = cur.get("pinned").and_then(|v| v.as_array().cloned()).unwrap_or_default();
    pinned.retain(|v| !v.as_str().is_some_and(ours));
    if let Some(Value::Array(s)) = snap.get("pinned") {
        pinned.extend(s.iter().filter(|v| v.as_str().is_some_and(ours)).cloned());
    }
    cur.insert("pinned".into(), Value::Array(pinned));
    if let Some(Value::Object(s)) = snap.get("unknown") {
        let mut map: Map<String, Value> = cur.get("unknown").and_then(|v| v.as_object().cloned()).unwrap_or_default();
        for (k, v) in s {
            map.entry(k.clone()).or_insert_with(|| v.clone());
        }
        cur.insert("unknown".into(), Value::Object(map));
    }
    if !cur.contains_key("format") {
        if let Some(f) = snap.get("format") {
            cur.insert("format".into(), f.clone());
        }
    }
    serde_json::to_vec_pretty(&Value::Object(cur)).unwrap_or_default()
}

// ------------------------------------------------------------------ Kernabläufe (blockierend)

#[allow(clippy::too_many_arguments)]
pub(crate) fn create_sync(root: &Path, instance_id: &str, game: &Path, inst: &Path, name: &str, auto: bool, sel: &Sel, prog: &impl Prog) -> AppResult<Manifest> {
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
    let m = Manifest { version: 1, id: id.clone(), name, created, auto, files, dirs: found.dirs, meta, scopes: sel.scopes() };
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

// ------------------------------------------------------------------ Öffentliche API

/// Eine Snapshot-Operation zur Zeit (Objektspeicher + Aufräumen).
static LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

#[allow(clippy::too_many_arguments)]
async fn create_locked(state: &AppState, instance_id: &str, name: &str, auto: bool, sel: Sel, prog: Progress, protect: Vec<String>) -> AppResult<SnapshotInfo> {
    let paths = state.paths.clone();
    let keep = state.settings().snapshot_keep;
    let (id, name) = (instance_id.to_string(), name.to_string());
    tokio::task::spawn_blocking(move || {
        let root = backups_root(&paths);
        let res = create_sync(&root, &id, &paths.game_dir(&id), &paths.instance_dir(&id), &name, auto, &sel, &prog);
        let m = match res {
            Ok(m) => m,
            Err(e) => {
                // Halb abgelegte Objekte wieder entfernen
                let _ = gc(&root);
                return Err(e);
            }
        };
        if auto {
            let mut protect: Vec<&str> = protect.iter().map(String::as_str).collect();
            protect.push(&m.id);
            if let Err(e) = prune_auto(&root, &id, keep, &protect) {
                tracing::warn!("Alte Snapshots von {id} nicht aufgeräumt: {e}");
            }
        }
        Ok(m.info())
    })
    .await?
}

/// Snapshot anlegen. `auto` = automatisch (zählt zur Aufbewahrungsgrenze `Settings.snapshot_keep`).
pub async fn create(state: &AppState, instance_id: &str, name: &str, auto: bool, progress: Option<&crate::tasks::SubProgress>) -> AppResult<SnapshotInfo> {
    state.instances.get(instance_id)?;
    let _g = LOCK.lock().await;
    create_locked(state, instance_id, name, auto, Sel::all(), Progress::from(progress), vec![]).await
}

/// Teil-Snapshot mit den gewählten Bereichen ([`SCOPES`]; alle = vollständig).
pub async fn create_scoped(state: &AppState, instance_id: &str, name: &str, auto: bool, scopes: &[String], progress: Option<&crate::tasks::SubProgress>) -> AppResult<SnapshotInfo> {
    state.instances.get(instance_id)?;
    let sel = Sel::of(scopes);
    if sel.scopes().is_some_and(|v| v.is_empty()) {
        return Err(AppError::Invalid("Kein Bereich für die Sicherung gewählt".into()));
    }
    let _g = LOCK.lock().await;
    create_locked(state, instance_id, name, auto, sel, Progress::from(progress), vec![]).await
}

/// Sicherung vor automatischen Mod-Änderungen („Probleme beheben“, Performance-Mods) nach der Einstellung
/// `Settings.fix_backup`. `None` = keine Sicherung gewünscht.
pub fn fix_backup_scopes(b: &crate::settings::FixBackup) -> Option<Vec<String>> {
    let v: Vec<String> = match b.mode.as_str() {
        "none" => return None,
        "mods" => vec!["mods".into()],
        "all" => SCOPES.iter().map(|s| s.to_string()).collect(),
        "custom" => SCOPES.iter().filter(|s| b.areas.iter().any(|a| a == *s)).map(|s| s.to_string()).collect(),
        _ => crate::settings::FixBackup::RECOMMENDED.iter().map(|s| s.to_string()).collect(),
    };
    if v.is_empty() {
        None
    } else {
        Some(v)
    }
}

/// Snapshot wiederherstellen: legt vorher automatisch „Vor Wiederherstellung“ an, bringt die
/// enthaltenen Ordner/Dateien exakt auf den Stand des Snapshots und sendet `content://changed`.
pub async fn restore(state: &AppState, instance_id: &str, snapshot_id: &str, progress: Option<&crate::tasks::SubProgress>) -> AppResult<()> {
    state.instances.get(instance_id)?;
    check_id(snapshot_id, "Snapshot-ID")?;
    if state.game.is_running(instance_id) {
        return Err(AppError::Invalid("Die Instanz läuft gerade – bitte zuerst das Spiel beenden.".into()));
    }
    // Reihenfolge: erst content.json-Sperre, dann Snapshot-Sperre
    let content_lock = state.content.lock(instance_id);
    let _c = content_lock.lock().await;
    let _g = LOCK.lock().await;
    let root = backups_root(&state.paths);
    let (r2, iid, sid) = (root.clone(), instance_id.to_string(), snapshot_id.to_string());
    let manifest = tokio::task::spawn_blocking(move || -> AppResult<Manifest> {
        let m = load(&r2, &iid, &sid)?;
        verify(&r2, &m)?;
        Ok(m)
    })
    .await??;
    let prog = Progress::from(progress);
    prog.message("Aktueller Stand wird gesichert …");
    // Gleiche Bereiche wie der wiederhergestellte Snapshot: genau das, was gleich überschrieben wird
    create_locked(state, instance_id, RESTORE_NAME, true, manifest.sel(), prog.sub(0.0, 0.5), vec![snapshot_id.to_string()]).await?;
    prog.check()?;
    // Ab hier nicht mehr abbrechen – sonst bliebe ein halber Stand zurück
    let paths = state.paths.clone();
    let iid = instance_id.to_string();
    let p2 = prog.sub(0.5, 1.0);
    let res = tokio::task::spawn_blocking(move || restore_sync(&root, &iid, &paths.game_dir(&iid), &paths.instance_dir(&iid), &manifest, &p2)).await?;
    if res.is_ok() {
        // Ordner-Sync: der alte Stand darf nicht als „in der Instanz gelöscht“ in den gemeinsamen Ordner wandern
        crate::platform::optsync::forget_state(&state.paths.root, instance_id);
        // Modpack-Instanzen: Minecraft/Loader wieder auf den wiederhergestellten Pack-Stand setzen
        if let Err(e) = super::modpack::sync_instance_with_record(state, instance_id) {
            tracing::warn!("Instanz {instance_id} nicht an pack.json angeglichen: {e}");
        }
    }
    state.content.emit_changed(instance_id);
    res
}

pub async fn list(state: &AppState, instance_id: &str) -> AppResult<Vec<SnapshotInfo>> {
    let inst = state.instances.get(instance_id)?;
    let root = backups_root(&state.paths);
    let id = instance_id.to_string();
    // Snapshots einer früher gelöschten Instanz mit gleicher ID (älter als die Instanz) verwerfen
    let stale: Vec<String> = manifests(&root, &id).iter().filter(|m| m.created < inst.created_at).map(|m| m.id.clone()).collect();
    if !stale.is_empty() {
        let _g = LOCK.lock().await;
        let r2 = root.clone();
        let dir = snapshot_dir(&root, &id);
        tokio::task::spawn_blocking(move || {
            for s in stale {
                let _ = std::fs::remove_file(dir.join(format!("{s}.json")));
            }
            if let Err(e) = gc(&r2) {
                tracing::warn!("Snapshot-Speicher nicht aufgeräumt: {e}");
            }
        })
        .await?;
    }
    Ok(tokio::task::spawn_blocking(move || manifests(&root, &id).iter().map(Manifest::info).collect()).await?)
}

pub async fn delete(state: &AppState, instance_id: &str, snapshot_id: &str) -> AppResult<()> {
    check_id(snapshot_id, "Snapshot-ID")?;
    let _g = LOCK.lock().await;
    let root = backups_root(&state.paths);
    let p = snapshot_dir(&root, instance_id).join(format!("{snapshot_id}.json"));
    if !valid_name(instance_id) || !p.exists() {
        return Err(AppError::NotFound("Snapshot".into()));
    }
    tokio::task::spawn_blocking(move || -> AppResult<()> {
        std::fs::remove_file(&p)?;
        if let Err(e) = gc(&root) {
            tracing::warn!("Snapshot-Speicher nicht aufgeräumt: {e}");
        }
        Ok(())
    })
    .await??;
    state.content.emit_changed(instance_id);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Fx {
        base: PathBuf,
        root: PathBuf,
        game: PathBuf,
        inst: PathBuf,
    }

    fn fx() -> Fx {
        let base = std::env::temp_dir().join(format!("vl-snap-{}", uuid::Uuid::new_v4()));
        let inst = base.join("instances").join("i1");
        let game = inst.join("minecraft");
        std::fs::create_dir_all(game.join("mods")).unwrap();
        std::fs::create_dir_all(game.join("config/sub")).unwrap();
        std::fs::create_dir_all(game.join("saves/Welt")).unwrap();
        std::fs::write(game.join("mods/a.jar"), b"jar-a").unwrap();
        std::fs::write(game.join("mods/b.jar"), b"jar-b").unwrap();
        std::fs::write(game.join("mods/c.jar.disabled"), b"jar-a").unwrap(); // gleicher Inhalt wie a.jar
        std::fs::write(game.join("config/x.toml"), b"x = 1").unwrap();
        std::fs::write(game.join("config/sub/y.json"), b"{}").unwrap();
        std::fs::write(game.join("options.txt"), b"fov:70").unwrap();
        std::fs::write(game.join("saves/Welt/level.dat"), b"lvl").unwrap();
        std::fs::write(inst.join("content.json"), b"{\"a\":1}").unwrap();
        Fx { root: base.join("backups"), base, game, inst }
    }

    fn tree(game: &Path, inst: &Path) -> Vec<(String, String)> {
        let f = scan(game, inst, &Sel::all()).unwrap();
        let mut v: Vec<(String, String)> = f.files.iter().map(|(r, p, _, _)| (r.clone(), crate::net::sha1_file(p).unwrap())).collect();
        v.extend(f.meta.iter().map(|(r, p, _)| (format!("@{r}"), crate::net::sha1_file(p).unwrap())));
        v.extend(f.dirs.iter().map(|d| (format!("{d}/"), String::new())));
        v.sort();
        v
    }

    fn objects(root: &Path) -> usize {
        walkdir::WalkDir::new(root.join("objects")).into_iter().flatten().filter(|e| e.file_type().is_file()).count()
    }

    #[test]
    fn dedupe_and_gc() {
        let f = fx();
        let p = ();
        let s1 = create_sync(&f.root, "i1", &f.game, &f.inst, "eins", false, &Sel::all(), &p).unwrap();
        assert_eq!(s1.files.len(), 6);
        assert_eq!(s1.meta.len(), 1);
        assert!(!s1.files.iter().any(|e| e.rel_path.starts_with("saves")));
        // a.jar und c.jar.disabled teilen sich ein Objekt
        assert_eq!(objects(&f.root), 6);
        // Zweiter Snapshot ohne Änderung: keine neuen Objekte
        let s2 = create_sync(&f.root, "i1", &f.game, &f.inst, "", true, &Sel::all(), &p).unwrap();
        assert!(s2.name.starts_with("Snapshot vom"));
        assert_eq!(objects(&f.root), 6);
        // Neue Config -> ein neues Objekt
        std::fs::write(f.game.join("config/x.toml"), b"x = 2").unwrap();
        let s3 = create_sync(&f.root, "i1", &f.game, &f.inst, "drei", false, &Sel::all(), &p).unwrap();
        assert_eq!(objects(&f.root), 7);
        // Löschen von s3 + GC entfernt nur das neue Objekt
        std::fs::remove_file(snapshot_dir(&f.root, "i1").join(format!("{}.json", s3.id))).unwrap();
        assert_eq!(gc(&f.root).unwrap(), 1);
        assert_eq!(objects(&f.root), 6);
        // Alle löschen -> Speicher leer
        for s in [&s1, &s2] {
            std::fs::remove_file(snapshot_dir(&f.root, "i1").join(format!("{}.json", s.id))).unwrap();
        }
        gc(&f.root).unwrap();
        assert_eq!(objects(&f.root), 0);
        std::fs::remove_dir_all(&f.base).ok();
    }

    #[test]
    fn restore_matches_exactly() {
        let f = fx();
        let p = ();
        let before = tree(&f.game, &f.inst);
        let s = create_sync(&f.root, "i1", &f.game, &f.inst, "eins", false, &Sel::all(), &p).unwrap();
        // Ändern: Mod löschen, Mod hinzufügen, Config ändern, Ordner hinzufügen/entfernen, Metadaten ändern
        std::fs::remove_file(f.game.join("mods/b.jar")).unwrap();
        std::fs::write(f.game.join("mods/neu.jar"), b"neu").unwrap();
        std::fs::write(f.game.join("config/x.toml"), b"x = 99").unwrap();
        std::fs::remove_dir_all(f.game.join("config/sub")).unwrap();
        std::fs::create_dir_all(f.game.join("kubejs/scripts")).unwrap();
        std::fs::write(f.game.join("kubejs/scripts/a.js"), b"//").unwrap();
        std::fs::write(f.inst.join("content.json"), b"{}").unwrap();
        std::fs::write(f.inst.join("pack.json"), b"{}").unwrap();
        std::fs::write(f.game.join("saves/Welt/neu.dat"), b"bleibt").unwrap();
        assert_ne!(tree(&f.game, &f.inst), before);
        restore_sync(&f.root, "i1", &f.game, &f.inst, &s, &p).unwrap();
        assert_eq!(tree(&f.game, &f.inst), before);
        // Welten werden nicht angefasst
        assert!(f.game.join("saves/Welt/neu.dat").exists());
        assert!(!f.inst.join("pack.json").exists());
        // Config ist eine eigene Kopie: Ändern verändert das Objekt nicht
        std::fs::write(f.game.join("config/x.toml"), b"x = 5").unwrap();
        let e = s.files.iter().find(|e| e.rel_path == "config/x.toml").unwrap();
        assert_eq!(std::fs::read(object_path(&f.root, &e.sha1)).unwrap(), b"x = 1");
        std::fs::remove_dir_all(&f.base).ok();
    }

    #[cfg(unix)]
    #[test]
    fn jars_are_hard_links() {
        use std::os::unix::fs::MetadataExt;
        let f = fx();
        let s = create_sync(&f.root, "i1", &f.game, &f.inst, "eins", false, &Sel::all(), &()).unwrap();
        let e = s.files.iter().find(|e| e.rel_path == "mods/b.jar").unwrap();
        let a = std::fs::metadata(f.game.join("mods/b.jar")).unwrap();
        let b = std::fs::metadata(object_path(&f.root, &e.sha1)).unwrap();
        assert_eq!(a.ino(), b.ino());
        std::fs::remove_dir_all(&f.base).ok();
    }

    #[test]
    fn prune_keeps_manual_and_protected() {
        let f = fx();
        let p = ();
        let manual = create_sync(&f.root, "i1", &f.game, &f.inst, "manuell", false, &Sel::all(), &p).unwrap();
        let mut autos = vec![];
        for n in 0..4 {
            std::fs::write(f.game.join("config/x.toml"), format!("x = {n}")).unwrap();
            autos.push(create_sync(&f.root, "i1", &f.game, &f.inst, "auto", true, &Sel::all(), &p).unwrap());
            std::thread::sleep(std::time::Duration::from_millis(3));
        }
        // Ältester automatischer ist geschützt
        prune_auto(&f.root, "i1", 2, &[autos[0].id.as_str()]).unwrap();
        let ids: Vec<String> = manifests(&f.root, "i1").into_iter().map(|m| m.id).collect();
        assert!(ids.contains(&manual.id));
        assert!(ids.contains(&autos[0].id));
        assert!(!ids.contains(&autos[1].id));
        assert!(ids.contains(&autos[2].id) && ids.contains(&autos[3].id));
        verify(&f.root, &load(&f.root, "i1", &autos[0].id).unwrap()).unwrap();
        std::fs::remove_dir_all(&f.base).ok();
    }

    #[test]
    fn partial_snapshot_only_touches_its_scopes() {
        let f = fx();
        let p = ();
        std::fs::create_dir_all(f.game.join("resourcepacks")).unwrap();
        std::fs::write(f.game.join("resourcepacks/alt.zip"), b"rp").unwrap();
        std::fs::write(
            f.inst.join("content.json"),
            br#"{"format":1,"files":{"mods/a.jar":{"v":1},"resourcepacks/alt.zip":{"v":1}},"local":{},"pinned":["mods/a.jar"],"unknown":{"h1":{}}}"#,
        )
        .unwrap();
        let sel = Sel::of(&["mods".into()]);
        let s = create_sync(&f.root, "i1", &f.game, &f.inst, "nur mods", true, &sel, &p).unwrap();
        assert_eq!(s.scopes, Some(vec!["mods".to_string()]));
        assert!(s.files.iter().all(|e| e.rel_path.starts_with("mods/")), "{:?}", s.files);
        assert_eq!(s.meta.iter().map(|m| m.rel_path.as_str()).collect::<Vec<_>>(), vec!["content.json"]);

        // Danach ändert sich alles Mögliche
        std::fs::remove_file(f.game.join("mods/b.jar")).unwrap();
        std::fs::write(f.game.join("mods/neu.jar"), b"neu").unwrap();
        std::fs::write(f.game.join("resourcepacks/neu.zip"), b"rp2").unwrap();
        std::fs::remove_file(f.game.join("resourcepacks/alt.zip")).unwrap();
        std::fs::write(f.game.join("config/x.toml"), b"x = 42").unwrap();
        std::fs::write(f.game.join("options.txt"), b"fov:90").unwrap();
        std::fs::write(
            f.inst.join("content.json"),
            br#"{"format":1,"files":{"mods/a.jar":{"v":2},"mods/neu.jar":{"v":1},"resourcepacks/neu.zip":{"v":1}},"local":{"resourcepacks/neu.zip":{"size":3}},"pinned":["resourcepacks/neu.zip"],"unknown":{"h2":{}}}"#,
        )
        .unwrap();

        restore_sync(&f.root, "i1", &f.game, &f.inst, &s, &p).unwrap();
        // Mods exakt wie im Snapshot
        assert!(f.game.join("mods/b.jar").exists());
        assert!(!f.game.join("mods/neu.jar").exists());
        // Alles andere unangetastet – Resourcepacks werden NICHT gelöscht/zurückgeholt
        assert!(f.game.join("resourcepacks/neu.zip").exists());
        assert!(!f.game.join("resourcepacks/alt.zip").exists());
        assert_eq!(std::fs::read(f.game.join("config/x.toml")).unwrap(), b"x = 42");
        assert_eq!(std::fs::read(f.game.join("options.txt")).unwrap(), b"fov:90");
        // content.json: Mods-Einträge aus dem Snapshot, Resourcepacks-Einträge vom aktuellen Stand
        let idx: serde_json::Value = serde_json::from_slice(&std::fs::read(f.inst.join("content.json")).unwrap()).unwrap();
        assert_eq!(idx["files"]["mods/a.jar"]["v"], 1);
        assert!(idx["files"].get("mods/neu.jar").is_none());
        assert_eq!(idx["files"]["resourcepacks/neu.zip"]["v"], 1);
        assert!(idx["files"].get("resourcepacks/alt.zip").is_none());
        assert_eq!(idx["local"]["resourcepacks/neu.zip"]["size"], 3);
        let pinned: Vec<&str> = idx["pinned"].as_array().unwrap().iter().filter_map(|v| v.as_str()).collect();
        assert!(pinned.contains(&"mods/a.jar") && pinned.contains(&"resourcepacks/neu.zip"));
        assert!(idx["unknown"].get("h1").is_some() && idx["unknown"].get("h2").is_some());
        std::fs::remove_dir_all(&f.base).ok();
    }

    #[test]
    fn scope_selection() {
        let all: Vec<String> = SCOPES.iter().map(|s| s.to_string()).collect();
        assert!(Sel::of(&all).is_all());
        assert!(Sel::from_manifest(&None).is_all());
        let s = Sel::of(&["options".into(), "configs".into(), "quatsch".into()]);
        assert_eq!(s.scopes(), Some(vec!["configs".to_string(), "options".to_string()]));
        assert_eq!(s.dirs(), vec!["config", "defaultconfigs", "kubejs"]);
        assert!(s.meta().is_empty());
        assert_eq!(Sel::of(&["mods".into()]).meta(), vec!["content.json", "pack.json", "modsets.json"]);
        use crate::settings::FixBackup;
        let fb = |mode: &str, areas: &[&str]| FixBackup { mode: mode.into(), areas: areas.iter().map(|s| s.to_string()).collect() };
        assert_eq!(fix_backup_scopes(&fb("none", &["mods"])), None);
        assert_eq!(fix_backup_scopes(&fb("mods", &[])), Some(vec!["mods".to_string()]));
        assert_eq!(fix_backup_scopes(&fb("custom", &[])), None);
        assert_eq!(fix_backup_scopes(&fb("custom", &["resourcepacks", "mods"])), Some(vec!["mods".to_string(), "resourcepacks".to_string()]));
        assert_eq!(fix_backup_scopes(&FixBackup::default()), Some(vec!["mods".to_string(), "configs".to_string(), "options".to_string()]));
    }

    #[test]
    fn old_manifest_is_full() {
        let m: Manifest = serde_json::from_str(r#"{"id":"x","name":"n","created":1,"files":[],"dirs":[],"meta":[]}"#).unwrap();
        assert!(m.sel().is_all());
        assert_eq!(m.info().scopes, None);
    }

    #[test]
    fn names_and_links() {
        assert!(linkable("mods/a.JAR"));
        assert!(linkable("mods/a.jar.disabled"));
        assert!(linkable("resourcepacks/p.zip"));
        assert!(!linkable("config/a.json"));
        assert!(valid_name("Neue Welt (2)"));
        for bad in ["", ".", "..", "a/b", "a\\b", "C:x"] {
            assert!(!valid_name(bad), "{bad}");
        }
    }
}
