//! Clips des Vibey Clients (`instances/<id>/minecraft/vibeyclient/clips/`): Liste, Bearbeiten (nur `kept`, `title`,
//! `tags`), Löschen auf Wunsch, Ordner öffnen und ein leichtes Ordner-Polling, solange die Clips-Seite offen ist.
//! Vertrag: Vibey Client `docs/CLIPS.md` §10 (schema 1). Der Launcher löscht nie selbst, lädt nichts hoch und füllt
//! ein fehlendes `server` nie aus `session.json` auf (§10.4).
use crate::error::{AppError, AppResult};
use crate::state::AppState;
use regex::Regex;
use serde::Serialize;
use serde_json::{Map, Value};
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicI64, Ordering};
use std::sync::OnceLock;
use std::time::Duration;
use tauri::{AppHandle, Manager, State};

/// Höchste Schema-Version, die wir verstehen (höhere werden übersprungen).
const SCHEMA: i64 = 1;
const TITLE_MAX: usize = 100;
const TAGS_MAX: usize = 16;
const TAG_MAX: usize = 32;

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct ClipEvent {
    pub t_ms: i64,
    #[serde(rename = "type")]
    pub kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub victim: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct ClipPlayer {
    pub name: Option<String>,
    pub uuid: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct Clip {
    pub instance_id: String,
    pub id: String,
    /// Absoluter Pfad der MP4
    pub video_path: String,
    /// Absoluter Pfad des Vorschaubilds (fehlt, wenn das Spiel keins schreiben konnte)
    pub thumbnail_path: Option<String>,
    /// ms seit 1970 (aus `created_at`, sonst aus der id bzw. der Änderungszeit)
    pub created_at: i64,
    pub duration_ms: Option<i64>,
    pub size_bytes: Option<u64>,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub fps: Option<f64>,
    /// `hotkey`, `kill`, `multikill`, `clutch`, `death` – oder Unbekanntes (Frontend zeigt dann „Clip“)
    pub reason: String,
    pub kills: Option<i64>,
    pub highlight_ms: Option<i64>,
    pub events: Vec<ClipEvent>,
    pub player: Option<ClipPlayer>,
    pub mode: Option<String>,
    /// Nur bei `multiplayer` und nur, wenn das Spiel sie gespeichert hat (nie ergänzen)
    pub server: Option<String>,
    /// Nur bei `singleplayer`/`hosting`
    pub world: Option<String>,
    pub minecraft: Option<String>,
    pub loader: Option<String>,
    pub client_version: Option<String>,
    pub encoder: Option<String>,
    pub video_codec: Option<String>,
    pub audio_codec: Option<String>,
    pub kept: bool,
    pub title: Option<String>,
    pub tags: Vec<String>,
}

// ---------------------------------------------------------------- Namen und Pfade

fn id_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}_[a-z]+(_\d+)?$").unwrap())
}

pub fn valid_id(id: &str) -> bool {
    id_re().is_match(id)
}

/// Reiner Dateiname im selben Ordner: keine Pfadteile, keine Dotfiles, kein `..`, kein Laufwerk.
fn plain_name(name: &str) -> bool {
    !name.is_empty()
        && !name.starts_with('.')
        && !name.contains(['/', '\\', ':', '\0'])
        && matches!(Path::new(name).components().collect::<Vec<_>>().as_slice(), [Component::Normal(_)])
}

/// Instanz-ID als einzelner, harmloser Ordnername.
fn plain_instance_id(id: &str) -> bool {
    plain_name(id)
}

/// `<instances>/<instance_id>/minecraft/vibeyclient/clips` – ohne Dateisystemzugriff.
pub fn clips_dir_in(instances_root: &Path, instance_id: &str) -> AppResult<PathBuf> {
    if !plain_instance_id(instance_id) {
        return Err(AppError::Invalid("Instanz".into()));
    }
    Ok(instances_root.join(instance_id).join("minecraft").join("vibeyclient").join("clips"))
}

/// Datei im Clip-Ordner, nachdem Namen geprüft und Symlinks/Junctions aufgelöst sind: muss im Instanzordner bleiben.
fn checked_file(instances_root: &Path, dir: &Path, name: &str) -> AppResult<PathBuf> {
    if !plain_name(name) {
        return Err(AppError::Invalid("Kein Clip-Dateiname".into()));
    }
    let p = dir.join(name);
    let canon = p.canonicalize().map_err(|_| AppError::NotFound("Clip".into()))?;
    let root = instances_root.canonicalize()?;
    if !canon.starts_with(&root) {
        return Err(AppError::Invalid("Pfad außerhalb des Datenordners".into()));
    }
    Ok(canon)
}

// ---------------------------------------------------------------- Lesen

fn str_field(o: &Map<String, Value>, k: &str) -> Option<String> {
    o.get(k).and_then(Value::as_str).map(str::to_string)
}
fn int_field(o: &Map<String, Value>, k: &str) -> Option<i64> {
    o.get(k).and_then(|v| v.as_i64().or_else(|| v.as_f64().map(|f| f as i64)))
}

/// Zeit aus der id (`YYYY-MM-DD_HH-mm-ss`, lokale Zeit).
fn time_from_id(id: &str) -> Option<i64> {
    let dt = chrono::NaiveDateTime::parse_from_str(id.get(..19)?, "%Y-%m-%d_%H-%M-%S").ok()?;
    Some(dt.and_local_timezone(chrono::Local).earliest()?.timestamp_millis())
}

#[derive(Debug)]
enum Parsed {
    Ok(Box<Clip>),
    /// Kein Clip (höheres Schema, fehlendes Video, falsche id …) – nicht erneut versuchen
    Skip,
    /// JSON (noch) nicht lesbar – einmal nach 200 ms erneut versuchen
    Broken,
}

/// `<id>.json` lesen. `dir` ist der Clip-Ordner, `id` bereits gegen das Regex geprüft.
fn parse_clip(instance_id: &str, dir: &Path, id: &str) -> Parsed {
    let json = dir.join(format!("{id}.json"));
    let Ok(bytes) = std::fs::read(&json) else { return Parsed::Broken };
    let Ok(Value::Object(o)) = serde_json::from_slice::<Value>(&bytes) else { return Parsed::Broken };
    match o.get("schema").and_then(Value::as_i64) {
        Some(SCHEMA) => {}
        _ => return Parsed::Skip,
    }
    // Das Video muss existieren – sonst ist es (noch) kein Clip
    let video_name = str_field(&o, "video").unwrap_or_else(|| format!("{id}.mp4"));
    if !plain_name(&video_name) {
        return Parsed::Skip;
    }
    let video = dir.join(&video_name);
    let Ok(vmeta) = std::fs::metadata(&video) else { return Parsed::Skip };
    if !vmeta.is_file() {
        return Parsed::Skip;
    }
    let thumbnail = str_field(&o, "thumbnail")
        .filter(|n| plain_name(n))
        .map(|n| dir.join(n))
        .filter(|p| p.is_file());

    let created_at = str_field(&o, "created_at")
        .and_then(|s| chrono::DateTime::parse_from_rfc3339(&s).ok())
        .map(|d| d.timestamp_millis())
        .or_else(|| time_from_id(id))
        .or_else(|| {
            vmeta.modified().ok().and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_millis() as i64)
        })
        .unwrap_or(0);

    let events = o
        .get("events")
        .and_then(Value::as_array)
        .map(|a| {
            a.iter()
                .filter_map(|e| {
                    let e = e.as_object()?;
                    Some(ClipEvent { t_ms: int_field(e, "t_ms")?, kind: str_field(e, "type")?, victim: str_field(e, "victim") })
                })
                .take(64)
                .collect()
        })
        .unwrap_or_default();
    let player = o.get("player").and_then(Value::as_object).map(|p| ClipPlayer { name: str_field(p, "name"), uuid: str_field(p, "uuid") });
    let tags = o
        .get("tags")
        .and_then(Value::as_array)
        .map(|a| a.iter().filter_map(|t| t.as_str().map(str::to_string)).collect())
        .unwrap_or_default();

    Parsed::Ok(Box::new(Clip {
        instance_id: instance_id.to_string(),
        id: id.to_string(),
        video_path: video.to_string_lossy().to_string(),
        thumbnail_path: thumbnail.map(|p| p.to_string_lossy().to_string()),
        created_at,
        duration_ms: int_field(&o, "duration_ms"),
        size_bytes: int_field(&o, "size_bytes").map(|n| n.max(0) as u64).or(Some(vmeta.len())),
        width: int_field(&o, "width").map(|n| n.max(0) as u32),
        height: int_field(&o, "height").map(|n| n.max(0) as u32),
        fps: o.get("fps").and_then(Value::as_f64),
        reason: str_field(&o, "reason").unwrap_or_default(),
        kills: int_field(&o, "kills"),
        highlight_ms: int_field(&o, "highlight_ms"),
        events,
        player,
        mode: str_field(&o, "mode"),
        server: str_field(&o, "server"),
        world: str_field(&o, "world"),
        minecraft: str_field(&o, "minecraft"),
        loader: str_field(&o, "loader"),
        client_version: str_field(&o, "client_version"),
        encoder: str_field(&o, "encoder"),
        video_codec: str_field(&o, "video_codec"),
        audio_codec: str_field(&o, "audio_codec"),
        kept: o.get("kept").and_then(Value::as_bool).unwrap_or(false),
        title: str_field(&o, "title").filter(|s| !s.trim().is_empty()),
        tags,
    }))
}

/// Ids aller Kandidaten (`<id>.json` mit gültiger id; Dotfiles, `.tmp/`, `.buffer/` und andere Dateien fallen raus).
fn candidate_ids(dir: &Path) -> Vec<String> {
    let Ok(rd) = std::fs::read_dir(dir) else { return Vec::new() };
    rd.flatten()
        .filter_map(|e| {
            let name = e.file_name().to_string_lossy().to_string();
            let id = name.strip_suffix(".json")?;
            (valid_id(id) && e.file_type().ok()?.is_file()).then(|| id.to_string())
        })
        .collect()
}

/// Alle Clips der Ordner. Nicht lesbare JSONs werden einmal nach `retry` erneut versucht, dann übersprungen
/// (nie gelöscht – das Spiel schreibt sie evtl. gerade).
fn scan(dirs: &[(String, PathBuf)], retry: Duration) -> Vec<Clip> {
    let mut out = Vec::new();
    let mut broken = Vec::new();
    for (iid, dir) in dirs {
        for id in candidate_ids(dir) {
            match parse_clip(iid, dir, &id) {
                Parsed::Ok(c) => out.push(*c),
                Parsed::Skip => {}
                Parsed::Broken => broken.push((iid, dir, id)),
            }
        }
    }
    if !broken.is_empty() {
        std::thread::sleep(retry);
        for (iid, dir, id) in broken {
            if let Parsed::Ok(c) = parse_clip(iid, dir, &id) {
                out.push(*c);
            }
        }
    }
    out.sort_by(|a, b| b.created_at.cmp(&a.created_at).then_with(|| b.id.cmp(&a.id)));
    out
}

// ---------------------------------------------------------------- Bearbeiten und Löschen

#[derive(Debug, Default)]
pub struct ClipEdit {
    pub kept: Option<bool>,
    /// `Some("")` entfernt den Titel
    pub title: Option<String>,
    /// `Some(vec![])` entfernt die Tags
    pub tags: Option<Vec<String>>,
}

fn normalize_edit(e: ClipEdit) -> AppResult<ClipEdit> {
    let title = match e.title {
        Some(t) => {
            let t = t.trim().to_string();
            if t.chars().count() > TITLE_MAX {
                return Err(AppError::Invalid(format!("Titel länger als {TITLE_MAX} Zeichen")));
            }
            Some(t)
        }
        None => None,
    };
    let tags = match e.tags {
        Some(list) => {
            let mut out: Vec<String> = Vec::new();
            for t in list {
                let t = t.trim().to_string();
                if t.is_empty() || out.iter().any(|x| x.eq_ignore_ascii_case(&t)) {
                    continue;
                }
                if t.chars().count() > TAG_MAX {
                    return Err(AppError::Invalid(format!("Tag länger als {TAG_MAX} Zeichen")));
                }
                out.push(t);
            }
            if out.len() > TAGS_MAX {
                return Err(AppError::Invalid(format!("Höchstens {TAGS_MAX} Tags")));
            }
            Some(out)
        }
        None => None,
    };
    Ok(ClipEdit { kept: e.kept, title, tags })
}

/// Nur `kept`, `title`, `tags` setzen, alles andere (auch unbekannte Felder) behalten; atomar über
/// `.<id>.json.tmp` + Umbenennen. Leere Werte werden weggelassen statt `null` (wie im Spiel).
fn apply_edit(dir: &Path, id: &str, edit: ClipEdit) -> AppResult<()> {
    if !valid_id(id) {
        return Err(AppError::Invalid("Clip-ID".into()));
    }
    let edit = normalize_edit(edit)?;
    let path = dir.join(format!("{id}.json"));
    let bytes = std::fs::read(&path).map_err(|_| AppError::NotFound("Clip".into()))?;
    let Value::Object(mut o) = serde_json::from_slice::<Value>(&bytes)? else {
        return Err(AppError::Invalid("Clip-Metadaten".into()));
    };
    if o.get("schema").and_then(Value::as_i64) != Some(SCHEMA) {
        return Err(AppError::Invalid("Unbekannte Clip-Version".into()));
    }
    if let Some(k) = edit.kept {
        o.insert("kept".into(), Value::Bool(k));
    }
    if let Some(t) = edit.title {
        if t.is_empty() {
            o.remove("title");
        } else {
            o.insert("title".into(), Value::String(t));
        }
    }
    if let Some(tags) = edit.tags {
        if tags.is_empty() {
            o.remove("tags");
        } else {
            o.insert("tags".into(), Value::Array(tags.into_iter().map(Value::String).collect()));
        }
    }
    let tmp = dir.join(format!(".{id}.json.tmp"));
    let mut data = serde_json::to_vec_pretty(&Value::Object(o))?;
    data.push(b'\n');
    std::fs::write(&tmp, &data)?;
    // std::fs::rename ersetzt unter Windows (MoveFileEx REPLACE_EXISTING) und Unix atomar
    if let Err(e) = std::fs::rename(&tmp, &path) {
        let _ = std::fs::remove_file(&tmp);
        return Err(e.into());
    }
    Ok(())
}

/// Datei löschen, bei Sperre (Player hält sie offen) kurz erneut versuchen. Fehlende Dateien sind ok.
fn remove_retry(p: &Path, tries: u32) -> std::io::Result<()> {
    let mut n = 0;
    loop {
        match std::fs::remove_file(p) {
            Ok(()) => return Ok(()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(()),
            Err(e) if n + 1 >= tries => return Err(e),
            Err(_) => {
                n += 1;
                std::thread::sleep(Duration::from_millis(250));
            }
        }
    }
}

/// Löschen in Vertragsreihenfolge: `<id>.json` zuerst (der Clip verschwindet für alle Leser auf einmal), dann Video
/// und Vorschaubild. Bleibt eine gesperrte MP4/JPG übrig, räumt das Spiel sie beim nächsten Start als Waise auf.
/// Rückgabe: Dateien, die (noch) nicht gelöscht werden konnten.
fn delete_clip(dir: &Path, id: &str) -> AppResult<Vec<PathBuf>> {
    if !valid_id(id) {
        return Err(AppError::Invalid("Clip-ID".into()));
    }
    let json = dir.join(format!("{id}.json"));
    // Namen aus der JSON (falls lesbar), sonst Standardnamen
    let (video, thumb) = std::fs::read(&json)
        .ok()
        .and_then(|b| serde_json::from_slice::<Value>(&b).ok())
        .and_then(|v| v.as_object().cloned())
        .map(|o| (str_field(&o, "video"), str_field(&o, "thumbnail")))
        .unwrap_or((None, None));
    if !json.is_file() {
        return Err(AppError::NotFound("Clip".into()));
    }
    std::fs::remove_file(&json)?;
    let mut files = vec![dir.join(format!("{id}.mp4")), dir.join(format!("{id}.jpg"))];
    for n in [video, thumb].into_iter().flatten().filter(|n| plain_name(n)) {
        let p = dir.join(n);
        if !files.contains(&p) {
            files.push(p);
        }
    }
    let mut left = Vec::new();
    for f in files {
        if remove_retry(&f, 4).is_err() {
            left.push(f);
        }
    }
    Ok(left)
}

// ---------------------------------------------------------------- Commands

fn dirs_for(state: &AppState, instance_id: Option<String>) -> AppResult<Vec<(String, PathBuf)>> {
    let ids: Vec<String> = match instance_id {
        Some(id) => {
            state.instances.get(&id)?;
            vec![id]
        }
        None => state.instances.list().into_iter().map(|i| i.id).collect(),
    };
    let root = state.paths.instances();
    Ok(ids.into_iter().filter_map(|id| clips_dir_in(&root, &id).ok().map(|d| (id, d))).collect())
}

/// Clip-Ordner einer vorhandenen Instanz (geprüft).
fn instance_clips_dir(state: &AppState, instance_id: &str) -> AppResult<PathBuf> {
    state.instances.get(instance_id)?;
    clips_dir_in(&state.paths.instances(), instance_id)
}

/// Prüft, dass `<id>.json` existiert und (nach Auflösen von Links) im Instanzordner liegt.
fn checked_clip(state: &AppState, instance_id: &str, id: &str) -> AppResult<PathBuf> {
    if !valid_id(id) {
        return Err(AppError::Invalid("Clip-ID".into()));
    }
    let dir = instance_clips_dir(state, instance_id)?;
    // Nur prüfen; weiter mit dem nicht kanonischen Pfad (kanonische Windows-Pfade mit Präfix taugen nicht fürs Frontend)
    checked_file(&state.paths.instances(), &dir, &format!("{id}.json"))?;
    Ok(dir)
}

/// Clips aller Instanzen (oder einer), neueste zuerst.
#[tauri::command]
pub async fn clips_list(state: State<'_, AppState>, instance_id: Option<String>) -> AppResult<Vec<Clip>> {
    let dirs = dirs_for(&state, instance_id)?;
    tokio::task::spawn_blocking(move || scan(&dirs, Duration::from_millis(200)))
        .await
        .map_err(|e| AppError::msg(e.to_string()))
}

/// Nur `kept`, `title` (leer = entfernen) und `tags` (leer = entfernen) ändern. Gibt den neu gelesenen Clip zurück.
#[tauri::command]
pub async fn clip_update(
    state: State<'_, AppState>,
    instance_id: String,
    id: String,
    kept: Option<bool>,
    title: Option<String>,
    tags: Option<Vec<String>>,
) -> AppResult<Clip> {
    let dir = checked_clip(&state, &instance_id, &id)?;
    tokio::task::spawn_blocking(move || -> AppResult<Clip> {
        apply_edit(&dir, &id, ClipEdit { kept, title, tags })?;
        match parse_clip(&instance_id, &dir, &id) {
            Parsed::Ok(c) => Ok(*c),
            _ => Err(AppError::NotFound("Clip".into())),
        }
    })
    .await
    .map_err(|e| AppError::msg(e.to_string()))?
}

/// Auf Wunsch des Nutzers löschen (JSON zuerst, dann MP4 und JPG).
#[tauri::command]
pub async fn clip_delete(state: State<'_, AppState>, instance_id: String, id: String) -> AppResult<()> {
    let dir = checked_clip(&state, &instance_id, &id)?;
    let left = tokio::task::spawn_blocking(move || delete_clip(&dir, &id))
        .await
        .map_err(|e| AppError::msg(e.to_string()))??;
    if !left.is_empty() {
        tracing::warn!("Clip-Dateien gesperrt, das Spiel räumt sie später auf: {left:?}");
    }
    Ok(())
}

/// Clip-Ordner öffnen; mit `id` das Video im Explorer markieren.
#[tauri::command]
pub async fn clip_open_folder(state: State<'_, AppState>, instance_id: String, id: Option<String>) -> AppResult<()> {
    let dir = instance_clips_dir(&state, &instance_id)?;
    if let Some(id) = id {
        if !valid_id(&id) {
            return Err(AppError::Invalid("Clip-ID".into()));
        }
        let root = state.paths.instances();
        let file = checked_file(&root, &dir, &format!("{id}.mp4")).or_else(|_| checked_file(&root, &dir, &format!("{id}.json")))?;
        #[cfg(windows)]
        {
            let s = file.to_string_lossy();
            let s = s.strip_prefix(r"\\?\").unwrap_or(&s);
            std::process::Command::new("explorer").arg(format!("/select,{s}")).spawn()?;
            return Ok(());
        }
        #[cfg(not(windows))]
        {
            return crate::util::open_in_explorer(file.parent().unwrap_or(&dir));
        }
    }
    std::fs::create_dir_all(&dir)?;
    crate::util::open_in_explorer(&dir)
}

// ---------------------------------------------------------------- Ordner-Polling

/// Bis wann (ms seit 1970) das Polling laufen darf. Die Seite verlängert alle ~10 s; schließt sie (oder lädt das
/// Fenster neu, ohne abzumelden), endet das Polling spätestens nach `LEASE_MS`.
static LEASE_UNTIL: AtomicI64 = AtomicI64::new(0);
static POLLING: AtomicBool = AtomicBool::new(false);
const LEASE_MS: i64 = 25_000;
const POLL: Duration = Duration::from_millis(1000);
const DEBOUNCE: Duration = Duration::from_millis(500);

fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

/// Fingerabdruck aller `<id>.json` (Name, Größe, Änderungszeit) je Instanz – günstig: nur `read_dir` + Metadaten.
fn signature(dirs: &[(String, PathBuf)]) -> Vec<(String, u64)> {
    use std::hash::{Hash, Hasher};
    dirs.iter()
        .map(|(iid, dir)| {
            let mut entries: Vec<(String, u64, u128)> = Vec::new();
            if let Ok(rd) = std::fs::read_dir(dir) {
                for e in rd.flatten() {
                    let name = e.file_name().to_string_lossy().to_string();
                    if !name.strip_suffix(".json").is_some_and(valid_id) {
                        continue;
                    }
                    let Ok(m) = e.metadata() else { continue };
                    let mt = m.modified().ok().and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_nanos()).unwrap_or(0);
                    entries.push((name, m.len(), mt));
                }
            }
            entries.sort();
            let mut h = std::collections::hash_map::DefaultHasher::new();
            entries.hash(&mut h);
            (iid.clone(), h.finish())
        })
        .collect()
}

fn changed_instances(a: &[(String, u64)], b: &[(String, u64)]) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for (iid, h) in b {
        if a.iter().find(|(x, _)| x == iid).map(|(_, y)| y) != Some(h) {
            out.push(iid.clone());
        }
    }
    for (iid, _) in a {
        if !b.iter().any(|(x, _)| x == iid) && !out.contains(iid) {
            out.push(iid.clone());
        }
    }
    out
}

/// Payload von `clips://changed`
#[derive(Debug, Clone, Serialize)]
pub struct ClipsChanged {
    pub instance_ids: Vec<String>,
}

fn spawn_poller(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        loop {
            let list_dirs = || {
                let st = app.state::<AppState>();
                dirs_for(&st, None).unwrap_or_default()
            };
            let mut last = {
                let d = list_dirs();
                tokio::task::spawn_blocking(move || signature(&d)).await.unwrap_or_default()
            };
            while LEASE_UNTIL.load(Ordering::SeqCst) > now_ms() {
                tokio::time::sleep(POLL).await;
                let d = list_dirs();
                let sig = tokio::task::spawn_blocking(move || signature(&d)).await.unwrap_or_default();
                if sig == last {
                    continue;
                }
                // Entprellen: das Spiel schreibt JSON zuletzt; kurz warten, bis Ruhe ist
                tokio::time::sleep(DEBOUNCE).await;
                let d = list_dirs();
                let settled = tokio::task::spawn_blocking(move || signature(&d)).await.unwrap_or_default();
                let ids = changed_instances(&last, &settled);
                last = settled;
                if !ids.is_empty() {
                    crate::events::emit(&app, crate::events::CLIPS_CHANGED, &ClipsChanged { instance_ids: ids });
                }
            }
            POLLING.store(false, Ordering::SeqCst);
            // Zwischen Prüfung und Abmelden verlängert? Dann weiterlaufen, sonst Ende.
            if LEASE_UNTIL.load(Ordering::SeqCst) > now_ms() && !POLLING.swap(true, Ordering::SeqCst) {
                continue;
            }
            break;
        }
    });
}

/// Polling der Clip-Ordner an (`active`, verlängert die Laufzeit um ~25 s) oder aus. Solange es läuft, sendet das
/// Backend `clips://changed`, wenn `<id>.json` dazukommen, sich ändern oder verschwinden (entprellt ~500 ms).
#[tauri::command]
pub async fn clips_watch(app: AppHandle, active: bool) -> AppResult<()> {
    if active {
        LEASE_UNTIL.store(now_ms() + LEASE_MS, Ordering::SeqCst);
        if !POLLING.swap(true, Ordering::SeqCst) {
            spawn_poller(app);
        }
    } else {
        LEASE_UNTIL.store(0, Ordering::SeqCst);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    struct TmpDir(PathBuf);
    impl TmpDir {
        fn new(tag: &str) -> Self {
            let p = std::env::temp_dir().join(format!("vl-clips-test-{tag}-{}", uuid::Uuid::new_v4()));
            std::fs::create_dir_all(&p).unwrap();
            TmpDir(p)
        }
    }
    impl Drop for TmpDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    const ID: &str = "2026-11-19_21-04-33_multikill";

    fn sample(id: &str) -> Value {
        json!({
            "schema": 1, "id": id, "created_at": "2026-11-19T20:04:33Z",
            "video": format!("{id}.mp4"), "thumbnail": format!("{id}.jpg"),
            "duration_ms": 31967, "size_bytes": 24093112, "width": 1280, "height": 720, "fps": 30,
            "video_codec": "h264", "reason": "multikill", "kills": 2, "highlight_ms": 26100,
            "events": [{ "t_ms": 21400, "type": "kill", "victim": "Steve" }, { "t_ms": 26100, "type": "kill", "victim": "Kai" }],
            "player": { "name": "Alex", "uuid": "1c2d3e4f" }, "mode": "multiplayer", "server": "play.example.net",
            "encoder": "h264_qsv", "kept": false, "title": "Bridge 1v2", "tags": ["bedwars"],
            "future_field": { "nested": [1, 2, 3] }
        })
    }

    fn write_clip(dir: &Path, id: &str, v: &Value, video: bool, thumb: bool) {
        std::fs::write(dir.join(format!("{id}.json")), serde_json::to_vec(v).unwrap()).unwrap();
        if video {
            std::fs::write(dir.join(format!("{id}.mp4")), b"mp4").unwrap();
        }
        if thumb {
            std::fs::write(dir.join(format!("{id}.jpg")), b"jpg").unwrap();
        }
    }

    fn one(dir: &Path) -> Vec<Clip> {
        scan(&[("inst".into(), dir.to_path_buf())], Duration::from_millis(1))
    }

    #[test]
    fn id_regex() {
        assert!(valid_id(ID));
        assert!(valid_id("2026-11-19_21-04-33_hotkey_2"));
        assert!(!valid_id("2026-11-19_21-04-33_Hotkey"));
        assert!(!valid_id("2026-11-19_21-04-33"));
        assert!(!valid_id("../2026-11-19_21-04-33_kill"));
        assert!(!valid_id("2026-11-19_21-04-33_kill.json"));
    }

    #[test]
    fn parses_contract_example() {
        let t = TmpDir::new("parse");
        write_clip(&t.0, ID, &sample(ID), true, true);
        let list = one(&t.0);
        assert_eq!(list.len(), 1);
        let c = &list[0];
        assert_eq!(c.id, ID);
        assert_eq!(c.reason, "multikill");
        assert_eq!(c.kills, Some(2));
        assert_eq!(c.events.len(), 2);
        assert_eq!(c.events[1].victim.as_deref(), Some("Kai"));
        assert_eq!(c.server.as_deref(), Some("play.example.net"));
        assert_eq!(c.created_at, chrono::DateTime::parse_from_rfc3339("2026-11-19T20:04:33Z").unwrap().timestamp_millis());
        assert!(c.thumbnail_path.is_some());
        assert_eq!(c.tags, vec!["bedwars".to_string()]);
    }

    #[test]
    fn skips_what_is_not_a_clip() {
        let t = TmpDir::new("skip");
        // ohne Video
        write_clip(&t.0, "2026-11-19_10-00-00_hotkey", &sample("2026-11-19_10-00-00_hotkey"), false, false);
        // höheres Schema
        let mut v = sample("2026-11-19_10-00-01_kill");
        v["schema"] = json!(2);
        write_clip(&t.0, "2026-11-19_10-00-01_kill", &v, true, false);
        // kaputtes JSON (wird nach dem Wiederholen übersprungen, aber nicht gelöscht)
        std::fs::write(t.0.join("2026-11-19_10-00-02_kill.json"), b"{ \"schema\": 1,").unwrap();
        std::fs::write(t.0.join("2026-11-19_10-00-02_kill.mp4"), b"x").unwrap();
        // Dotfiles, Ordner, fremde Namen
        std::fs::write(t.0.join(format!(".{ID}.json.tmp")), b"{}").unwrap();
        std::fs::create_dir_all(t.0.join(".buffer")).unwrap();
        std::fs::create_dir_all(t.0.join(".tmp")).unwrap();
        std::fs::write(t.0.join("notes.json"), b"{}").unwrap();
        // Video-Name mit Pfad
        let mut v = sample("2026-11-19_10-00-03_kill");
        v["video"] = json!("../evil.mp4");
        write_clip(&t.0, "2026-11-19_10-00-03_kill", &v, true, false);
        // ein gültiger ohne Vorschaubild
        write_clip(&t.0, "2026-11-19_10-00-04_death", &sample("2026-11-19_10-00-04_death"), true, false);

        let list = one(&t.0);
        assert_eq!(list.iter().map(|c| c.id.as_str()).collect::<Vec<_>>(), vec!["2026-11-19_10-00-04_death"]);
        assert!(list[0].thumbnail_path.is_none());
        assert!(t.0.join("2026-11-19_10-00-02_kill.json").exists(), "kaputte JSON nie löschen");
    }

    #[test]
    fn broken_json_is_retried() {
        let t = TmpDir::new("retry");
        let id = "2026-11-19_10-00-02_kill";
        std::fs::write(t.0.join(format!("{id}.json")), b"{").unwrap();
        std::fs::write(t.0.join(format!("{id}.mp4")), b"x").unwrap();
        let dir = t.0.clone();
        let good = serde_json::to_vec(&sample(id)).unwrap();
        let w = std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(60));
            std::fs::write(dir.join(format!("{id}.json")), good).unwrap();
        });
        let list = scan(&[("inst".into(), t.0.clone())], Duration::from_millis(300));
        w.join().unwrap();
        assert_eq!(list.len(), 1);
    }

    #[test]
    fn sorts_newest_first() {
        let t = TmpDir::new("sort");
        for (id, at) in [("2026-11-18_10-00-00_kill", "2026-11-18T09:00:00Z"), ("2026-11-19_10-00-00_kill", "2026-11-19T09:00:00Z")] {
            let mut v = sample(id);
            v["created_at"] = json!(at);
            write_clip(&t.0, id, &v, true, false);
        }
        let list = one(&t.0);
        assert_eq!(list[0].id, "2026-11-19_10-00-00_kill");
    }

    #[test]
    fn edit_keeps_unknown_fields() {
        let t = TmpDir::new("edit");
        write_clip(&t.0, ID, &sample(ID), true, true);
        apply_edit(&t.0, ID, ClipEdit { kept: Some(true), title: Some("  Neu  ".into()), tags: Some(vec!["a".into(), " b ".into(), "A".into(), "".into()]) }).unwrap();
        let v: Value = serde_json::from_slice(&std::fs::read(t.0.join(format!("{ID}.json"))).unwrap()).unwrap();
        assert_eq!(v["kept"], json!(true));
        assert_eq!(v["title"], json!("Neu"));
        assert_eq!(v["tags"], json!(["a", "b"]));
        // alles andere unverändert
        let mut expect = sample(ID);
        expect["kept"] = json!(true);
        expect["title"] = json!("Neu");
        expect["tags"] = json!(["a", "b"]);
        assert_eq!(v, expect);
        assert!(!t.0.join(format!(".{ID}.json.tmp")).exists());

        // leere Werte entfernen die Felder (weglassen statt null)
        apply_edit(&t.0, ID, ClipEdit { kept: None, title: Some("".into()), tags: Some(vec![]) }).unwrap();
        let v: Value = serde_json::from_slice(&std::fs::read(t.0.join(format!("{ID}.json"))).unwrap()).unwrap();
        assert!(v.get("title").is_none() && v.get("tags").is_none());
        assert_eq!(v["kept"], json!(true));
        assert_eq!(v["future_field"], json!({ "nested": [1, 2, 3] }));
    }

    #[test]
    fn edit_limits() {
        let t = TmpDir::new("limits");
        write_clip(&t.0, ID, &sample(ID), true, false);
        assert!(apply_edit(&t.0, ID, ClipEdit { title: Some("x".repeat(101)), ..Default::default() }).is_err());
        assert!(apply_edit(&t.0, ID, ClipEdit { title: Some("ä".repeat(100)), ..Default::default() }).is_ok());
        assert!(apply_edit(&t.0, ID, ClipEdit { tags: Some(vec!["y".repeat(33)]), ..Default::default() }).is_err());
        assert!(apply_edit(&t.0, ID, ClipEdit { tags: Some((0..17).map(|n| n.to_string()).collect()), ..Default::default() }).is_err());
        assert!(apply_edit(&t.0, ID, ClipEdit { tags: Some((0..16).map(|n| n.to_string()).collect()), ..Default::default() }).is_ok());
        assert!(apply_edit(&t.0, "../x", ClipEdit::default()).is_err());
        // höheres Schema wird nicht angefasst
        let mut v = sample(ID);
        v["schema"] = json!(2);
        write_clip(&t.0, ID, &v, true, false);
        assert!(apply_edit(&t.0, ID, ClipEdit { kept: Some(true), ..Default::default() }).is_err());
    }

    #[test]
    fn delete_removes_json_first_and_all_files() {
        let t = TmpDir::new("delete");
        write_clip(&t.0, ID, &sample(ID), true, true);
        let other = "2026-11-19_21-04-33_multikill_2";
        write_clip(&t.0, other, &sample(other), true, true);
        // Halten wir die MP4 offen, bleibt sie übrig – die JSON ist trotzdem weg (Clip verschwindet atomar)
        #[cfg(windows)]
        {
            use std::os::windows::fs::OpenOptionsExt;
            let _lock = std::fs::OpenOptions::new().read(true).share_mode(0).open(t.0.join(format!("{ID}.mp4"))).unwrap();
            let left = delete_clip(&t.0, ID).unwrap();
            assert!(!t.0.join(format!("{ID}.json")).exists());
            assert_eq!(left, vec![t.0.join(format!("{ID}.mp4"))]);
            assert!(!t.0.join(format!("{ID}.jpg")).exists());
            assert!(one(&t.0).iter().all(|c| c.id != ID));
            drop(_lock);
            std::fs::remove_file(t.0.join(format!("{ID}.mp4"))).unwrap();
        }
        #[cfg(not(windows))]
        {
            assert!(delete_clip(&t.0, ID).unwrap().is_empty());
        }
        assert!(!t.0.join(format!("{ID}.mp4")).exists());
        // Der andere Clip bleibt
        assert!(t.0.join(format!("{other}.json")).exists() && t.0.join(format!("{other}.mp4")).exists());
        assert!(matches!(delete_clip(&t.0, ID), Err(AppError::NotFound(_))));
    }

    #[test]
    fn path_checks() {
        let root = Path::new("C:/data/instances");
        assert!(clips_dir_in(root, "survival").unwrap().ends_with("survival/minecraft/vibeyclient/clips"));
        for bad in ["..", ".", "", "a/b", "a\\b", "C:", ".hidden", "../x"] {
            assert!(clips_dir_in(root, bad).is_err(), "{bad}");
        }
        assert!(plain_name("x.mp4"));
        assert!(!plain_name("../x.mp4") && !plain_name("sub/x.mp4") && !plain_name(".x.mp4") && !plain_name("C:x.mp4"));

        // Datei außerhalb des Instanzordners (z. B. über einen anderen Ordner) wird abgelehnt
        let t = TmpDir::new("paths");
        let inst = t.0.join("instances");
        let dir = clips_dir_in(&inst, "i1").unwrap();
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join(format!("{ID}.json")), b"{}").unwrap();
        assert!(checked_file(&inst, &dir, &format!("{ID}.json")).is_ok());
        let outside = t.0.join("outside");
        std::fs::create_dir_all(&outside).unwrap();
        std::fs::write(outside.join("x.json"), b"{}").unwrap();
        assert!(checked_file(&inst, &outside, "x.json").is_err());
        assert!(checked_file(&inst, &dir, "../../x.json").is_err());
        assert!(matches!(checked_file(&inst, &dir, "missing.json"), Err(AppError::NotFound(_))));
    }

    #[test]
    fn signature_changes() {
        let t = TmpDir::new("sig");
        let dirs = vec![("i".to_string(), t.0.clone())];
        let a = signature(&dirs);
        std::fs::write(t.0.join(format!(".{ID}.json.tmp")), b"{}").unwrap();
        std::fs::write(t.0.join(format!("{ID}.mp4")), b"x").unwrap();
        assert_eq!(a, signature(&dirs), "Dotfiles und MP4 lösen nichts aus");
        std::fs::write(t.0.join(format!("{ID}.json")), b"{}").unwrap();
        let b = signature(&dirs);
        assert_ne!(a, b);
        assert_eq!(changed_instances(&a, &b), vec!["i".to_string()]);
        assert!(changed_instances(&b, &b).is_empty());
    }
}
