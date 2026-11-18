//! Dateien, die manuell heruntergeladen werden müssen (`instances/<id>/missing.json`).
//!
//! CurseForge erlaubt Autoren, Downloads über Drittanbieter-Launcher zu sperren (`allowModDistribution == false`,
//! `downloadUrl == null`). Solche Dateien landen hier als „erwartet“; das Frontend zeigt einen Hinweis mit Link
//! zur Dateiseite. Lädt der Nutzer die Datei im Browser, findet Vibe sie im Download-Ordner des Systems
//! (auch umbenannt wie `name (1).jar`), prüft sie per SHA-1 bzw. CurseForge-Fingerprint und verschiebt sie
//! in den Instanzordner. **Nur Dateien mit passendem Hash werden verschoben.** Nach „Auf CurseForge
//! herunterladen“ wird der Ordner einige Minuten lang beobachtet (`watch`).
use super::index::{self, ContentIndex, IndexEntry};
use super::{curseforge as cf, ContentKind, ManualArrived, MissingDownload, MissingScan, Source};
use crate::error::AppResult;
use crate::paths::Paths;
use crate::state::AppState;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::Ordering;
use std::time::{Duration, Instant, SystemTime};

/// Wie lange der Download-Ordner nach „Auf CurseForge herunterladen“ beobachtet wird.
pub const WATCH_FOR: Duration = Duration::from_secs(10 * 60);
const TICK: Duration = Duration::from_secs(2);

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MissingEntry {
    #[serde(flatten)]
    pub info: MissingDownload,
    #[serde(default)]
    pub sha1: Option<String>,
    #[serde(default)]
    pub project_id: Option<String>,
    #[serde(default)]
    pub file_id: Option<String>,
    /// Größe in Bytes (Vorfilter, bevor gehasht wird)
    #[serde(default)]
    pub size: Option<u64>,
    /// CurseForge-Fingerprint (MurmurHash2), falls kein SHA-1 bekannt ist
    #[serde(default)]
    pub fingerprint: Option<u32>,
    /// Index-Eintrag, der beim Eintreffen der Datei geschrieben wird (Herkunft, Version, Icon …)
    #[serde(default)]
    pub index: Option<IndexEntry>,
    /// Ältere Dateien desselben Projekts (Index-Schlüssel), die beim Eintreffen ersetzt werden
    #[serde(default)]
    pub replaces: Vec<String>,
}

impl MissingEntry {
    pub fn new(info: MissingDownload) -> Self {
        MissingEntry { info, sha1: None, project_id: None, file_id: None, size: None, fingerprint: None, index: None, replaces: vec![] }
    }
    fn expected(&self) -> Expected<'_> {
        Expected { file_name: &self.info.file_name, size: self.size.filter(|s| *s > 0), sha1: self.sha1.as_deref(), fingerprint: self.fingerprint }
    }
}

fn path(paths: &Paths, instance_id: &str) -> PathBuf {
    paths.instance_dir(instance_id).join("missing.json")
}

pub fn load(paths: &Paths, instance_id: &str) -> Vec<MissingEntry> {
    std::fs::read(path(paths, instance_id)).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default()
}

fn save(paths: &Paths, instance_id: &str, list: &[MissingEntry]) -> AppResult<()> {
    let p = path(paths, instance_id);
    if list.is_empty() {
        if p.exists() {
            std::fs::remove_file(p)?;
        }
        return Ok(());
    }
    crate::util::write_json_atomic(&p, &list)
}

/// Einträge hinzufügen (gleiche Datei im gleichen Ordner bzw. gleiches Projekt wird ersetzt).
pub fn add(paths: &Paths, instance_id: &str, entries: Vec<MissingEntry>) -> AppResult<()> {
    if entries.is_empty() {
        return Ok(());
    }
    let mut list = load(paths, instance_id);
    for e in entries {
        let same_project = |x: &MissingEntry| e.project_id.is_some() && x.project_id == e.project_id && x.info.kind == e.info.kind;
        list.retain(|x| !(x.info.file_name == e.info.file_name && x.info.kind == e.info.kind) && !same_project(x));
        list.push(e);
    }
    save(paths, instance_id, &list)
}

/// Erwartete Dateien (nach Dateiname) wieder austragen, z. B. beim Rückgängigmachen von „Probleme beheben“.
pub fn forget(paths: &Paths, instance_id: &str, file_names: &[String]) -> AppResult<()> {
    let mut list = load(paths, instance_id);
    let n = list.len();
    list.retain(|x| !file_names.contains(&x.info.file_name));
    if list.len() == n {
        return Ok(());
    }
    save(paths, instance_id, &list)
}

pub fn dismiss(paths: &Paths, instance_id: &str) -> AppResult<()> {
    save(paths, instance_id, &[])
}

fn target(game_dir: &Path, kind: ContentKind, file_name: &str) -> PathBuf {
    game_dir.join(kind.folder()).join(file_name)
}

fn with_disabled(p: &Path) -> PathBuf {
    p.with_file_name(format!("{}.disabled", p.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default()))
}

/// Download-Ordner des Systems. In Debug-Builds per `VIBE_DOWNLOAD_DIR` überschreibbar (Tests mit eigenem Datenordner).
pub fn downloads_dir() -> Option<PathBuf> {
    if cfg!(debug_assertions) {
        if let Some(d) = std::env::var_os("VIBE_DOWNLOAD_DIR").filter(|d| !d.is_empty()) {
            return Some(PathBuf::from(d));
        }
    }
    dirs::download_dir()
}

// ------------------------------------------------------------------ Erkennung (rein, getestet)

/// Was über die erwartete Datei bekannt ist.
#[derive(Debug, Clone, Copy)]
pub struct Expected<'a> {
    pub file_name: &'a str,
    pub size: Option<u64>,
    pub sha1: Option<&'a str>,
    pub fingerprint: Option<u32>,
}

fn split_ext(name: &str) -> (&str, &str) {
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
fn is_partial(name: &str) -> bool {
    let l = name.to_ascii_lowercase();
    [".crdownload", ".part", ".partial", ".tmp", ".download", ".opdownload"].iter().any(|s| l.ends_with(s))
}

/// Hash-Werte einer Datei, gecacht nach (Pfad, Größe, Änderungszeit) – große Dateien nicht in jedem Takt neu lesen.
#[derive(Default)]
pub struct HashCache {
    map: HashMap<(PathBuf, u64, SystemTime), (Option<String>, Option<u32>)>,
}

impl HashCache {
    fn get(&mut self, p: &Path, len: u64, mtime: SystemTime, want_sha1: bool, want_fp: bool) -> (Option<String>, Option<u32>) {
        if self.map.len() > 256 {
            self.map.clear();
        }
        let e = self.map.entry((p.to_path_buf(), len, mtime)).or_default();
        if want_sha1 && e.0.is_none() {
            e.0 = crate::net::sha1_file(p).ok();
        }
        if want_fp && e.1.is_none() {
            e.1 = std::fs::read(p).ok().map(|b| super::murmur::cf_fingerprint(&b));
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
fn move_file(src: &Path, dst: &Path) -> std::io::Result<()> {
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

/// Index für eingetroffene Dateien schreiben und ersetzte ältere Versionen entfernen.
pub fn apply_to_index(idx: &mut ContentIndex, game_dir: &Path, done: &[MissingEntry]) {
    for e in done {
        let key = index::key(e.info.kind.folder(), &e.info.file_name);
        for old in &e.replaces {
            if *old == key {
                continue;
            }
            let p = game_dir.join(old);
            for f in [with_disabled(&p), p] {
                if f.is_file() {
                    let _ = std::fs::remove_file(&f);
                }
            }
            idx.files.remove(old);
            idx.local.remove(old);
        }
        if let Some(entry) = &e.index {
            idx.files.insert(key.clone(), entry.clone());
            idx.local.remove(&key);
        }
    }
}

// ------------------------------------------------------------------ Ablauf

/// Fehlende Hashes (ältere Einträge) über die CurseForge-API nachtragen.
async fn enrich(state: &AppState, list: &mut [MissingEntry]) -> bool {
    if !cf::available(state) {
        return false;
    }
    let ids: Vec<u64> = list
        .iter()
        .filter(|e| e.sha1.is_none() && e.fingerprint.is_none())
        .filter_map(|e| e.file_id.as_deref()?.parse().ok())
        .collect();
    if ids.is_empty() {
        return false;
    }
    let Ok(files) = cf::raw_files_by_id(state, &ids).await else { return false };
    let mut changed = false;
    for e in list.iter_mut().filter(|e| e.sha1.is_none() && e.fingerprint.is_none()) {
        let Some(f) = e.file_id.as_deref().and_then(|id| id.parse::<u64>().ok()).and_then(|id| files.iter().find(|f| f.id == id)) else { continue };
        e.sha1 = f.sha1();
        e.fingerprint = cf::fingerprint32(f.file_fingerprint);
        e.size = Some(f.file_length).filter(|s| *s > 0);
        changed = true;
    }
    changed
}

/// Ein Durchlauf für eine Instanz: erkennt abgelegte/heruntergeladene Dateien, übernimmt sie, aktualisiert
/// Index und `missing.json`, meldet Eintreffen per Event. Gibt (übernommen, verbleibend) zurück.
pub async fn scan(state: &AppState, instance_id: &str, with_enrich: bool, cache: &mut HashCache) -> AppResult<(Vec<MissingEntry>, Vec<MissingEntry>)> {
    let mut list = load(&state.paths, instance_id);
    if list.is_empty() {
        return Ok((vec![], vec![]));
    }
    let enriched = with_enrich && enrich(state, &mut list).await;
    let lock = state.content.lock(instance_id);
    let _g = lock.lock().await;
    let paths = state.paths.clone();
    let id = instance_id.to_string();
    let mut c = std::mem::take(cache);
    let (out, c) = tokio::task::spawn_blocking(move || -> AppResult<(Outcome, HashCache)> {
        // Erneut laden: zwischenzeitlich hinzugekommene Einträge nicht verlieren
        let fresh = load(&paths, &id);
        let list: Vec<MissingEntry> = fresh
            .into_iter()
            .map(|f| list.iter().find(|e| e.info.file_name == f.info.file_name && e.info.kind == f.info.kind && f.sha1.is_none() && f.fingerprint.is_none()).cloned().unwrap_or(f))
            .collect();
        let before = list.len();
        let game_dir = paths.game_dir(&id);
        let out = scan_dirs(&game_dir, downloads_dir().as_deref(), list, &mut c);
        let done: Vec<MissingEntry> = out.arrived.iter().chain(out.present.iter()).cloned().collect();
        if !done.is_empty() {
            let mut idx = ContentIndex::load(&paths, &id);
            apply_to_index(&mut idx, &game_dir, &done);
            idx.save(&paths, &id)?;
        }
        if out.remaining.len() != before || enriched {
            save(&paths, &id, &out.remaining)?;
        }
        Ok((out, c))
    })
    .await??;
    *cache = c;
    drop(_g);
    if !out.arrived.is_empty() || !out.present.is_empty() {
        state.content.update_counts.lock().remove(instance_id);
        state.content.emit_changed(instance_id);
    }
    for e in &out.arrived {
        crate::events::emit(
            &state.content.app,
            crate::events::CONTENT_MANUAL_ARRIVED,
            &ManualArrived {
                instance_id: instance_id.to_string(),
                project_id: e.project_id.clone(),
                project_name: e.info.project_name.clone(), file_name: e.info.file_name.clone(), kind: e.info.kind },
        );
    }
    let mut taken = out.arrived;
    taken.extend(out.present);
    Ok((taken, out.remaining))
}

/// Noch fehlende Dateien (erkennt dabei bereits abgelegte bzw. heruntergeladene).
pub async fn list(state: &AppState, instance_id: &str) -> AppResult<Vec<MissingDownload>> {
    state.instances.get(instance_id)?;
    let (_, remaining) = scan(state, instance_id, true, &mut HashCache::default()).await?;
    Ok(remaining.into_iter().map(|e| e.info).collect())
}

/// „Ich habe sie heruntergeladen – suchen“: sofort prüfen und den Ordner danach noch kurz beobachten.
pub async fn scan_now(state: &AppState, instance_id: &str) -> AppResult<MissingScan> {
    state.instances.get(instance_id)?;
    let (found, remaining) = scan(state, instance_id, true, &mut HashCache::default()).await?;
    let watching_until = if remaining.is_empty() { None } else { watch(state, instance_id, Duration::from_secs(3 * 60)) };
    Ok(MissingScan {
        found: found.into_iter().map(|e| e.info).collect(),
        remaining: remaining.into_iter().map(|e| e.info).collect(),
        folder: downloads_dir().map(|d| d.to_string_lossy().to_string()),
        watching_until,
    })
}

/// Bis wann (ms seit Epoch) der Download-Ordner für diese Instanz beobachtet wird.
pub fn watching_until(state: &AppState, instance_id: &str) -> Option<i64> {
    let until = *state.content.manual_watch.lock().get(instance_id)?;
    let left = until.checked_duration_since(Instant::now())?;
    Some(crate::util::now_ms() + left.as_millis() as i64)
}

/// Download-Ordner für `dur` beobachten (verlängert eine laufende Beobachtung). Gibt das Ende zurück.
pub fn watch(state: &AppState, instance_id: &str, dur: Duration) -> Option<i64> {
    downloads_dir()?;
    {
        let mut m = state.content.manual_watch.lock();
        let until = Instant::now() + dur;
        let e = m.entry(instance_id.to_string()).or_insert(until);
        if *e < until {
            *e = until;
        }
    }
    if !state.content.manual_watch_running.swap(true, Ordering::SeqCst) {
        let st = state.clone();
        tauri::async_runtime::spawn(async move { watch_loop(st).await });
    }
    watching_until(state, instance_id)
}

async fn watch_loop(state: AppState) {
    let mut caches: HashMap<String, HashCache> = HashMap::new();
    loop {
        tokio::time::sleep(TICK).await;
        let now = Instant::now();
        let ids: Vec<String> = {
            let mut m = state.content.manual_watch.lock();
            m.retain(|_, until| *until > now);
            m.keys().cloned().collect()
        };
        if ids.is_empty() {
            state.content.manual_watch_running.store(false, Ordering::SeqCst);
            // Zwischenzeitlich neu gestartet? Dann weiterlaufen, sonst beenden.
            if state.content.manual_watch.lock().is_empty() || state.content.manual_watch_running.swap(true, Ordering::SeqCst) {
                return;
            }
            continue;
        }
        for id in ids {
            let cache = caches.entry(id.clone()).or_default();
            match scan(&state, &id, false, cache).await {
                Ok((_, remaining)) if remaining.is_empty() => {
                    state.content.manual_watch.lock().remove(&id);
                    caches.remove(&id);
                }
                Ok(_) => {}
                Err(e) => tracing::debug!("Download-Ordner-Prüfung {id}: {e}"),
            }
        }
    }
}

/// Einträge für CurseForge-Dateien (für Tests und Aufrufer ohne Plan).
pub fn entry_for_cf_file(f: &cf::CfFile, project_name: &str, page_url: String, kind: ContentKind) -> MissingEntry {
    let mut e = MissingEntry::new(MissingDownload {
        file_name: crate::paths::sanitize_file_name(&f.file_name),
        project_name: project_name.to_string(),
        page_url,
        kind,
        version_number: Some(if f.display_name.is_empty() { f.file_name.clone() } else { f.display_name.clone() }),
        is_update: false,
    });
    e.sha1 = f.sha1();
    e.fingerprint = cf::fingerprint32(f.file_fingerprint);
    e.size = Some(f.file_length).filter(|s| *s > 0);
    e.project_id = Some(f.mod_id.to_string());
    e.file_id = Some(f.id.to_string());
    let v = cf::convert_file(f);
    e.index = Some(IndexEntry {
        source: Source::Curseforge,
        project_id: f.mod_id.to_string(),
        version_id: f.id.to_string(),
        sha1: e.sha1.clone(),
        sha512: None,
        title: Some(project_name.to_string()),
        icon_url: None,
        version_number: Some(v.version_number),
        url: None,
        size: e.size,
        date: Some(v.date).filter(|d| !d.is_empty()),
        release_type: Some(v.release_type),
        side: super::sides::from_cf_versions(&f.game_versions),
    });
    e
}

#[cfg(test)]
mod tests {
    use super::*;

    const XRAY_FILES: &str = include_str!("testdata/cf_xray_files.json");

    fn tmp(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("vibe-missing-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    fn sha1_hex(b: &[u8]) -> String {
        use sha1::{Digest, Sha1};
        hex::encode(Sha1::digest(b))
    }

    fn entry(name: &str, data: &[u8], kind: ContentKind) -> MissingEntry {
        let mut e = MissingEntry::new(MissingDownload {
            file_name: name.into(),
            project_name: "Xray Ultimate".into(),
            page_url: "https://www.curseforge.com/minecraft/texture-packs/xray-ultimate-1-11-compatible/files/9139602".into(),
            kind,
            version_number: Some("5.4.4".into()),
            is_update: false,
        });
        e.sha1 = Some(sha1_hex(data));
        e.size = Some(data.len() as u64);
        e.project_id = Some("226375".into());
        e.file_id = Some("9139602".into());
        e
    }

    #[test]
    fn browser_renames() {
        assert!(name_matches("Xray_Ultimate_26.X_v5.4.4.zip", "Xray_Ultimate_26.X_v5.4.4.zip"));
        assert!(name_matches("Xray_Ultimate_26.X_v5.4.4.zip", "xray_ultimate_26.x_v5.4.4.ZIP"));
        assert!(name_matches("Xray_Ultimate_26.X_v5.4.4.zip", "Xray_Ultimate_26.X_v5.4.4 (1).zip"));
        assert!(name_matches("Xray_Ultimate_26.X_v5.4.4.zip", "Xray_Ultimate_26.X_v5.4.4(12).zip"));
        assert!(name_matches("sodium.jar", "sodium (3).jar"));
        assert!(!name_matches("sodium.jar", "sodium-extra.jar"));
        assert!(!name_matches("sodium.jar", "sodium (x).jar"));
        assert!(!name_matches("sodium.jar", "sodium.jar.crdownload"));
        assert!(!name_matches("sodium.jar", "sodium (1).zip"));
        assert!(!name_matches("a.jar", "b (1).jar"));
        assert!(is_partial("sodium.jar.crdownload") && is_partial("x.zip.part") && !is_partial("x.zip"));
    }

    #[test]
    fn xray_fixture_is_manual() {
        // Echte API-Antwort (gekürzt): Xray Ultimate erlaubt keine Fremd-Downloads
        let page: cf::CfPage<cf::CfFile> = serde_json::from_str(XRAY_FILES).unwrap();
        let f = &page.data[0];
        assert!(f.locked());
        assert_eq!(f.sha1().as_deref(), Some("62e4da5ca5da24f12902760373c91fcbe0ff036b"));
        assert_eq!(cf::fingerprint32(f.file_fingerprint), Some(201562264));
        let v = cf::convert_file(f);
        assert_eq!(v.files[0].url, None);
        assert_eq!(v.files[0].fingerprint, Some(201562264));
        let e = entry_for_cf_file(f, "Xray Ultimate", "https://x/files/9139602".into(), ContentKind::Resourcepack);
        assert_eq!(e.info.file_name, "Xray_Ultimate_26.X_v5.4.4.zip");
        assert_eq!(e.size, Some(1710021));
        assert_eq!(e.file_id.as_deref(), Some("9139602"));
    }

    #[test]
    fn moves_only_matching_hash() {
        let root = tmp("hash");
        let game = root.join("game");
        let dl = root.join("Downloads");
        std::fs::create_dir_all(&dl).unwrap();
        let good = b"PK\x03\x04 echte Datei".to_vec();
        let e = entry("Xray_Ultimate_26.X_v5.4.4.zip", &good, ContentKind::Resourcepack);

        // Gleicher Name, falscher Inhalt (gleiche Größe) -> bleibt liegen
        let mut bad = good.clone();
        bad[5] ^= 0xff;
        std::fs::write(dl.join("Xray_Ultimate_26.X_v5.4.4.zip"), &bad).unwrap();
        // Fremde Datei gleicher Größe -> bleibt liegen
        std::fs::write(dl.join("urlaub.zip"), &bad).unwrap();
        // Unfertiger Download mit richtigem Inhalt -> nicht anfassen
        std::fs::write(dl.join("Xray_Ultimate_26.X_v5.4.4 (1).zip.crdownload"), &good).unwrap();
        let mut cache = HashCache::default();
        let out = scan_dirs(&game, Some(&dl), vec![e.clone()], &mut cache);
        assert_eq!((out.arrived.len(), out.present.len(), out.remaining.len()), (0, 0, 1));
        assert!(dl.join("Xray_Ultimate_26.X_v5.4.4.zip").is_file() && dl.join("urlaub.zip").is_file());

        // Browser hat umbenannt („(1)“), Inhalt stimmt -> wird verschoben, unter dem erwarteten Namen
        std::fs::write(dl.join("Xray_Ultimate_26.X_v5.4.4 (1).zip"), &good).unwrap();
        let out = scan_dirs(&game, Some(&dl), vec![e.clone()], &mut cache);
        assert_eq!(out.arrived.len(), 1);
        let dst = game.join("resourcepacks").join("Xray_Ultimate_26.X_v5.4.4.zip");
        assert_eq!(std::fs::read(&dst).unwrap(), good);
        assert!(!dl.join("Xray_Ultimate_26.X_v5.4.4 (1).zip").exists());
        // Die falschen Dateien sind unberührt
        assert_eq!(std::fs::read(dl.join("Xray_Ultimate_26.X_v5.4.4.zip")).unwrap(), bad);
        assert!(dl.join("urlaub.zip").is_file());
        assert!(dl.join("Xray_Ultimate_26.X_v5.4.4 (1).zip.crdownload").is_file());

        // Danach: liegt im Instanzordner -> „present“
        let out = scan_dirs(&game, Some(&dl), vec![e], &mut cache);
        assert_eq!(out.present.len(), 1);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn renamed_by_size_and_fingerprint() {
        let root = tmp("fp");
        let game = root.join("game");
        let dl = root.join("dl");
        std::fs::create_dir_all(&dl).unwrap();
        let data = b"fabric mod \n bytes \t with whitespace".to_vec();
        let mut e = entry("coolmod-1.0.jar", &data, ContentKind::Mod);
        e.sha1 = None;
        e.fingerprint = Some(super::super::murmur::cf_fingerprint(&data));
        // Völlig anderer Name, gleiche Größe + Endung -> per Fingerprint bestätigt
        std::fs::write(dl.join("download.jar"), &data).unwrap();
        let mut cache = HashCache::default();
        let out = scan_dirs(&game, Some(&dl), vec![e.clone()], &mut cache);
        assert_eq!(out.arrived.len(), 1);
        assert!(game.join("mods/coolmod-1.0.jar").is_file());

        // Ohne jeden Hash wird nie verschoben – auch bei gleichem Namen
        let mut blind = entry("other.jar", b"x", ContentKind::Mod);
        blind.sha1 = None;
        blind.fingerprint = None;
        std::fs::write(dl.join("other.jar"), b"x").unwrap();
        let out = scan_dirs(&game, Some(&dl), vec![blind], &mut cache);
        assert_eq!(out.remaining.len(), 1);
        assert!(dl.join("other.jar").is_file());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn same_name_update_waits_for_matching_download() {
        let root = tmp("same");
        let game = root.join("game");
        let dl = root.join("dl");
        std::fs::create_dir_all(game.join("resourcepacks")).unwrap();
        std::fs::create_dir_all(&dl).unwrap();
        // Alte Version mit gleichem Dateinamen liegt schon in der Instanz -> gilt nicht als „vorhanden“
        std::fs::write(game.join("resourcepacks/xray.zip"), b"alte version").unwrap();
        let new = b"neue version".to_vec();
        let e = entry("xray.zip", &new, ContentKind::Resourcepack);
        let mut cache = HashCache::default();
        let out = scan_dirs(&game, Some(&dl), vec![e.clone()], &mut cache);
        assert_eq!((out.present.len(), out.remaining.len()), (0, 1));
        assert_eq!(std::fs::read(game.join("resourcepacks/xray.zip")).unwrap(), b"alte version");
        // Passender Download ersetzt sie
        std::fs::write(dl.join("xray (2).zip"), &new).unwrap();
        let out = scan_dirs(&game, Some(&dl), vec![e], &mut cache);
        assert_eq!(out.arrived.len(), 1);
        assert_eq!(std::fs::read(game.join("resourcepacks/xray.zip")).unwrap(), new);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn manual_update_replaces_old_version() {
        let root = tmp("upd");
        let game = root.join("game");
        let dl = root.join("dl");
        std::fs::create_dir_all(game.join("mods")).unwrap();
        std::fs::create_dir_all(&dl).unwrap();
        // Alte Version deaktiviert
        std::fs::write(game.join("mods/cool-1.0.jar.disabled"), b"old").unwrap();
        let data = b"new version".to_vec();
        let mut e = entry("cool-2.0.jar", &data, ContentKind::Mod);
        e.replaces = vec!["mods/cool-1.0.jar".into()];
        e.info.is_update = true;
        e.index = Some(IndexEntry {
            source: Source::Curseforge,
            project_id: "1".into(),
            version_id: "2".into(),
            sha1: e.sha1.clone(),
            sha512: None,
            title: Some("Cool".into()),
            icon_url: None,
            version_number: Some("2.0".into()),
            url: None,
            size: Some(data.len() as u64),
            date: None,
            release_type: Some("release".into()),
            side: None,
        });
        std::fs::write(dl.join("cool-2.0.jar"), &data).unwrap();
        let mut cache = HashCache::default();
        let out = scan_dirs(&game, Some(&dl), vec![e], &mut cache);
        assert_eq!(out.arrived.len(), 1);
        assert!(game.join("mods/cool-2.0.jar.disabled").is_file(), "bleibt deaktiviert wie die alte Version");
        let mut idx = ContentIndex::default();
        idx.files.insert(
            "mods/cool-1.0.jar".into(),
            IndexEntry { version_id: "1".into(), version_number: Some("1.0".into()), ..out.arrived[0].index.clone().unwrap() },
        );
        apply_to_index(&mut idx, &game, &out.arrived);
        assert!(!game.join("mods/cool-1.0.jar.disabled").exists());
        assert!(!idx.files.contains_key("mods/cool-1.0.jar"));
        assert_eq!(idx.files.get("mods/cool-2.0.jar").map(|e| e.version_id.as_str()), Some("2"));
        let _ = std::fs::remove_dir_all(&root);
    }
}
