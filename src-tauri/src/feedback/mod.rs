//! Feedback und Fehlerberichte aus dem Launcher (`POST /api/v1/feedback`, docs/FEEDBACK.md).
//!
//! Ablauf: Die Oberfläche liefert nur die Auswahl ([`Draft`]: Art, Text, Kontakt, Instanz, Häkchen, IDs der
//! Screenshots). Rust liest die Logs selbst (keine Pfade vom Frontend), kürzt und bereinigt sie
//! ([`redact`]) und legt das fertige Paket unter einem Einmal-Token ab ([`prepare`]). Die Vorschau zeigt genau
//! dieses Paket; [`send`] schickt es unverändert ab. Screenshots kommen nur aus dem Fenster-Screenshot oder dem
//! Datei-Dialog, den Rust selbst öffnet, und liegen bis zum Senden/Verwerfen nur im Speicher.
//!
//! **Vibe-Hauptschalter:** Feedback ist eine Kernfunktion des Launchers und läuft deshalb auch bei
//! ausgeschalteten Vibe-Diensten – aber nur, wenn der Nutzer nach der Vorschau ausdrücklich auf „Senden“ drückt.
//! Es wird nichts im Hintergrund übertragen, und bei ausgeschaltetem Vibe wird nie ein Vibe-Konto verknüpft.
pub mod capture;
pub mod redact;

use crate::error::{AppError, AppResult};
use crate::state::AppState;
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use std::time::{Duration, Instant, SystemTime};

/// Nachricht: Länge in Zeichen
pub const MESSAGE_MIN: usize = 10;
pub const MESSAGE_MAX: usize = 5000;
pub const CONTACT_MAX: usize = 200;
/// Je Log höchstens so viel (Launcher-/Spiel-Log: das Ende, Crash-Report: der Anfang)
pub const LOG_MAX_BYTES: u64 = 256 * 1024;
/// Grenzen des Backends
pub const LOG_LIMIT: usize = 1024 * 1024;
pub const SHOT_LIMIT: usize = 5 * 1024 * 1024;
pub const MAX_FILES: usize = 3;
/// Crash-Reports ohne Bezug zur letzten Sitzung nur, wenn sie so frisch sind
const CRASH_MAX_AGE: Duration = Duration::from_secs(3 * 24 * 3600);
/// Vorbereitete Pakete verfallen nach
const PREPARED_TTL: Duration = Duration::from_secs(30 * 60);

// ------------------------------------------------------------------ Eingabe / Vorschau

#[derive(Debug, Clone, Deserialize)]
pub struct Draft {
    /// "bug" | "idea" | "other"
    pub kind: String,
    pub message: String,
    #[serde(default)]
    pub contact: Option<String>,
    /// z. B. "de" / "en"
    pub locale: String,
    /// Aktuelle Route (nur Pfad, z. B. `/instances/abc`)
    #[serde(default)]
    pub page: Option<String>,
    #[serde(default)]
    pub instance_id: Option<String>,
    #[serde(default)]
    pub attach_logs: bool,
    /// IDs aus [`capture_window`] / [`pick_screenshots`]
    #[serde(default)]
    pub screenshots: Vec<String>,
    /// Mit dem angemeldeten Vibe-Konto verknüpfen (nur wenn Vibe an und angemeldet)
    #[serde(default)]
    pub link_account: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct LogPreview {
    pub name: String,
    /// Größe der Datei auf der Platte
    pub original_bytes: u64,
    /// Gesendete Größe (nach Kürzen und Bereinigen)
    pub bytes: u64,
    pub truncated: bool,
    /// Anzahl ersetzter Stellen
    pub redactions: u32,
    /// Genau der gesendete Text
    pub text: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct ImageInfo {
    pub id: String,
    pub name: String,
    pub mime: String,
    pub bytes: u64,
    pub width: u32,
    pub height: u32,
    /// Kleines Vorschaubild als data:-URL (JPEG)
    pub thumb: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct Preview {
    /// Einmal-Token für [`send`]
    pub token: String,
    /// Ziel-Adresse
    pub endpoint: String,
    /// Genau das gesendete `meta`-Feld
    pub meta: Value,
    pub logs: Vec<LogPreview>,
    pub screenshots: Vec<ImageInfo>,
    /// Minecraft-Name des verknüpften Vibe-Kontos (None = anonym)
    pub account: Option<String>,
    pub total_bytes: u64,
}

#[derive(Debug, Clone, Serialize)]
pub struct AvailableLog {
    pub name: String,
    pub bytes: u64,
    /// "launcher" | "game" | "crash"
    pub kind: String,
}

/// Ergebnis des Sendens (statt Fehler, damit die Oberfläche je Fall passend reagieren kann).
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum SendResult {
    Sent { id: String, ticket: String },
    /// 429: zu viele Meldungen
    RateLimited { retry_after_secs: Option<u64>, message: Option<String> },
    /// 400/413/sonstige HTTP-Fehler
    Rejected { http: u16, code: Option<String>, message: Option<String> },
    /// Keine Verbindung / Zeitüberschreitung
    Offline { message: String },
}

// ------------------------------------------------------------------ Speicher (nur RAM)

#[derive(Clone)]
struct Held {
    name: String,
    mime: String,
    bytes: Vec<u8>,
}

fn held() -> &'static Mutex<HashMap<String, Held>> {
    static H: OnceLock<Mutex<HashMap<String, Held>>> = OnceLock::new();
    H.get_or_init(Default::default)
}

/// Fertiges Paket (genau das, was gesendet wird).
#[derive(Clone)]
pub struct Prepared {
    pub meta: Value,
    pub logs: Vec<(String, String)>,
    pub shots: Vec<(String, String, Vec<u8>)>,
    pub bearer: Option<String>,
    shot_ids: Vec<String>,
}

fn prepared() -> &'static Mutex<Option<(String, Prepared, Instant)>> {
    static P: OnceLock<Mutex<Option<(String, Prepared, Instant)>>> = OnceLock::new();
    P.get_or_init(Default::default)
}

/// Screenshots aus dem Speicher entfernen (Dialog geschlossen / Bild abgewählt).
pub fn discard(ids: &[String]) {
    let mut h = held().lock();
    for id in ids {
        h.remove(id);
    }
}

// ------------------------------------------------------------------ Screenshots

fn hold(name: String, mime: &str, bytes: Vec<u8>, img: &image::DynamicImage) -> AppResult<ImageInfo> {
    let thumb = thumbnail(img)?;
    let id = uuid::Uuid::new_v4().simple().to_string();
    let info = ImageInfo { id: id.clone(), name: name.clone(), mime: mime.to_string(), bytes: bytes.len() as u64, width: img.width(), height: img.height(), thumb };
    let mut h = held().lock();
    // Nicht unbegrenzt sammeln: älteste raus
    if h.len() >= 12 {
        if let Some(k) = h.keys().next().cloned() {
            h.remove(&k);
        }
    }
    h.insert(id, Held { name, mime: mime.to_string(), bytes });
    Ok(info)
}

fn thumbnail(img: &image::DynamicImage) -> AppResult<String> {
    use base64::Engine;
    let t = img.thumbnail(480, 480).to_rgb8();
    let mut out = std::io::Cursor::new(Vec::new());
    image::codecs::jpeg::JpegEncoder::new_with_quality(&mut out, 80)
        .encode_image(&t)
        .map_err(|e| AppError::msg(format!("Vorschaubild: {e}")))?;
    Ok(format!("data:image/jpeg;base64,{}", base64::engine::general_purpose::STANDARD.encode(out.into_inner())))
}

/// Bild für den Versand kodieren: PNG, bei Überschreitung der Grenze JPEG und ggf. verkleinern.
fn encode_shot(img: &image::RgbaImage) -> AppResult<(Vec<u8>, &'static str)> {
    let mut img = image::DynamicImage::ImageRgba8(img.clone());
    if img.width() > 2560 {
        img = img.resize(2560, 2560 * img.height() / img.width().max(1), image::imageops::FilterType::Triangle);
    }
    let mut png = std::io::Cursor::new(Vec::new());
    img.write_to(&mut png, image::ImageFormat::Png).map_err(|e| AppError::msg(format!("Screenshot: {e}")))?;
    if png.get_ref().len() <= SHOT_LIMIT {
        return Ok((png.into_inner(), "image/png"));
    }
    for (scale, q) in [(1.0f32, 85u8), (0.75, 80), (0.5, 75)] {
        let w = (img.width() as f32 * scale) as u32;
        let h = (img.height() as f32 * scale) as u32;
        let rgb = img.resize(w.max(1), h.max(1), image::imageops::FilterType::Triangle).to_rgb8();
        let mut out = std::io::Cursor::new(Vec::new());
        image::codecs::jpeg::JpegEncoder::new_with_quality(&mut out, q).encode_image(&rgb).map_err(|e| AppError::msg(format!("Screenshot: {e}")))?;
        if out.get_ref().len() <= SHOT_LIMIT {
            return Ok((out.into_inner(), "image/jpeg"));
        }
    }
    Err(AppError::Invalid("Der Screenshot ist zu groß.".into()))
}

/// Screenshot des Launcher-Fensters aufnehmen und im Speicher halten.
pub fn capture_window(app: &tauri::AppHandle) -> AppResult<ImageInfo> {
    let img = capture::capture_main(app)?;
    let (bytes, mime) = encode_shot(&img)?;
    let name = if mime == "image/png" { "launcher.png" } else { "launcher.jpg" };
    hold(name.to_string(), mime, bytes, &image::DynamicImage::ImageRgba8(img))
}

/// Bilddatei prüfen (Inhalt, nicht Endung) und im Speicher halten.
pub fn hold_file(path: &Path) -> AppResult<ImageInfo> {
    let name = path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_else(|| "screenshot.png".into());
    let f = std::fs::File::open(path).map_err(|_| AppError::NotFound(name.clone()))?;
    let mut bytes = Vec::new();
    f.take(SHOT_LIMIT as u64 + 1).read_to_end(&mut bytes)?;
    if bytes.len() > SHOT_LIMIT {
        return Err(AppError::Invalid(format!("„{name}“ ist größer als 5 MB.")));
    }
    let mime = sniff_image(&bytes).ok_or_else(|| AppError::Invalid(format!("„{name}“ ist kein PNG- oder JPEG-Bild.")))?;
    let img = image::load_from_memory(&bytes).map_err(|_| AppError::Invalid(format!("„{name}“ lässt sich nicht öffnen.")))?;
    hold(sanitize_name(&name, mime), mime, bytes, &img)
}

pub fn sniff_image(b: &[u8]) -> Option<&'static str> {
    if b.starts_with(&[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A]) {
        Some("image/png")
    } else if b.starts_with(&[0xFF, 0xD8, 0xFF]) {
        Some("image/jpeg")
    } else {
        None
    }
}

/// Dateiname ohne Pfad und persönliche Teile: nur einfache Zeichen, Endung passend zum Inhalt.
fn sanitize_name(name: &str, mime: &str) -> String {
    let stem = Path::new(name).file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
    let clean: String = stem.chars().filter(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.')).take(60).collect();
    let ext = if mime == "image/png" { "png" } else { "jpg" };
    if clean.is_empty() {
        format!("screenshot.{ext}")
    } else {
        format!("{clean}.{ext}")
    }
}

// ------------------------------------------------------------------ Logs

#[derive(Debug, Clone, Copy, PartialEq)]
enum Cut {
    /// Ende behalten (Logs)
    Tail,
    /// Anfang behalten (Crash-Reports: Ursache steht oben)
    Head,
}

struct Source {
    name: String,
    path: PathBuf,
    kind: &'static str,
    cut: Cut,
}

fn newest(dir: &Path, accept: impl Fn(&str) -> bool) -> Option<(PathBuf, SystemTime)> {
    let mut best: Option<(PathBuf, SystemTime)> = None;
    for e in std::fs::read_dir(dir).ok()?.flatten() {
        let name = e.file_name().to_string_lossy().to_string();
        let Ok(m) = e.metadata() else { continue };
        if !m.is_file() || !accept(&name) {
            continue;
        }
        let t = m.modified().unwrap_or(SystemTime::UNIX_EPOCH);
        if best.as_ref().map_or(true, |(_, bt)| t > *bt) {
            best = Some((e.path(), t));
        }
    }
    best
}

fn sources(state: &AppState, instance_id: Option<&str>) -> Vec<Source> {
    let mut out = Vec::new();
    // Launcher-Log (täglich rotiert: launcher.log.YYYY-MM-DD)
    if let Some((p, _)) = newest(&state.paths.launcher_logs(), |n| n.starts_with("launcher.log")) {
        out.push(Source { name: "launcher.log".into(), path: p, kind: "launcher", cut: Cut::Tail });
    }
    let Some(id) = instance_id.filter(|id| state.instances.get(id).is_ok()) else { return out };
    let game = state.paths.game_dir(id);
    let latest = game.join("logs").join("latest.log");
    if latest.is_file() {
        out.push(Source { name: "latest.log".into(), path: latest, kind: "game", cut: Cut::Tail });
    }
    let crash_dir = game.join("crash-reports");
    // Crash-Report der letzten Sitzung, sonst der neueste, wenn er frisch ist
    let from_session = state
        .game
        .states()
        .into_iter()
        .find(|s| s.instance_id == id)
        .and_then(|s| s.crash_report)
        .map(PathBuf::from)
        .filter(|p| p.is_file() && p.parent().is_some_and(|d| same_dir(d, &crash_dir)));
    let crash = from_session.or_else(|| {
        newest(&crash_dir, |n| n.to_ascii_lowercase().ends_with(".txt"))
            .filter(|(_, t)| t.elapsed().map(|e| e < CRASH_MAX_AGE).unwrap_or(false))
            .map(|(p, _)| p)
    });
    if let Some(p) = crash {
        let name = p.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_else(|| "crash-report.txt".into());
        out.push(Source { name, path: p, kind: "crash", cut: Cut::Head });
    }
    out.truncate(MAX_FILES);
    out
}

fn same_dir(a: &Path, b: &Path) -> bool {
    match (a.canonicalize(), b.canonicalize()) {
        (Ok(x), Ok(y)) => x == y,
        _ => a == b,
    }
}

/// Welche Logs angehängt würden (Name, Größe) – für die Liste im Dialog.
pub fn available_logs(state: &AppState, instance_id: Option<&str>) -> Vec<AvailableLog> {
    sources(state, instance_id)
        .into_iter()
        .map(|s| AvailableLog { bytes: std::fs::metadata(&s.path).map(|m| m.len()).unwrap_or(0), name: s.name, kind: s.kind.to_string() })
        .collect()
}

/// Datei lesen und auf `max` Bytes kürzen (Ende oder Anfang behalten, an Zeilengrenzen).
/// Liefert (Text, Originalgröße, gekürzt).
fn read_cut(path: &Path, max: u64, cut: Cut) -> std::io::Result<(String, u64, bool)> {
    let mut f = std::fs::File::open(path)?;
    let len = f.metadata()?.len();
    let mut buf = Vec::new();
    let truncated = len > max;
    if truncated && cut == Cut::Tail {
        f.seek(SeekFrom::Start(len - max))?;
    }
    f.take(max).read_to_end(&mut buf)?;
    let mut text = String::from_utf8_lossy(&buf).into_owned();
    if truncated {
        match cut {
            Cut::Tail => {
                // angeschnittene erste Zeile weg
                if let Some(i) = text.find('\n') {
                    text = text[i + 1..].to_string();
                }
                text = format!("[Vibe Launcher: Anfang gekürzt – nur die letzten {} KB]\n{text}", max / 1024);
            }
            Cut::Head => {
                if let Some(i) = text.rfind('\n') {
                    text.truncate(i + 1);
                }
                text.push_str(&format!("[Vibe Launcher: Ende gekürzt – nur die ersten {} KB]\n", max / 1024));
            }
        }
    }
    Ok((text, len, truncated))
}

/// Bereinigtes Log für den Versand.
pub fn clean_log(name: &str, raw: &str, original_bytes: u64, truncated: bool, known: &redact::Known) -> LogPreview {
    let r = redact::redact(raw, known);
    let mut text = r.text;
    if text.len() > LOG_LIMIT {
        let mut cut = text.len() - LOG_LIMIT;
        while !text.is_char_boundary(cut) {
            cut += 1;
        }
        text = text[cut..].to_string();
    }
    LogPreview { name: name.to_string(), original_bytes, bytes: text.len() as u64, truncated, redactions: r.count, text }
}

// ------------------------------------------------------------------ Metadaten

fn instance_meta(state: &AppState, id: &str) -> Option<Value> {
    let inst = state.instances.get(id).ok()?;
    let mods = std::fs::read_dir(state.paths.game_dir(id).join("mods"))
        .map(|rd| rd.flatten().filter(|e| e.file_name().to_string_lossy().to_ascii_lowercase().ends_with(".jar")).count())
        .unwrap_or(0);
    let loader = if inst.is_bedrock() { "bedrock".to_string() } else { inst.loader.kind.as_str().to_string() };
    let java = if inst.is_bedrock() { None } else { java_from_session(&state.game.session_log(id)) };
    Some(json!({
        "mc_version": inst.mc_version,
        "loader": loader,
        "loader_version": inst.loader.version,
        "mod_count": mods,
        "java": java,
    }))
}

/// „Java 21.0.5 (Microsoft, x64)“ aus der Startzeile der letzten Sitzung – ohne den Pfad.
pub fn java_from_session(lines: &[crate::minecraft::LogLine]) -> Option<String> {
    lines.iter().rev().find_map(|l| {
        let t = l.text.strip_prefix("Java ")?;
        if l.logger.as_deref() != Some("Vibe Launcher") {
            return None;
        }
        let end = t.find("): ").map(|i| i + 1).unwrap_or(t.len());
        Some(format!("Java {}", &t[..end]))
    })
}

fn os_name() -> String {
    sysinfo::System::long_os_version().unwrap_or_else(|| std::env::consts::OS.to_string())
}

fn clean_page(p: Option<&str>) -> Option<String> {
    let p = p?.trim();
    // Nur der Pfad (keine Suchbegriffe aus der Query)
    let p = p.split(['?', '#']).next().unwrap_or_default();
    (p.starts_with('/') && p.len() <= 200).then(|| p.to_string())
}

/// Eingaben prüfen und `meta` bauen (ohne Zustand, testbar).
pub fn build_meta(d: &Draft, version: &str, channel: &str, os: &str, arch: &str, instance: Option<Value>) -> AppResult<Value> {
    if !matches!(d.kind.as_str(), "bug" | "idea" | "other") {
        return Err(AppError::Invalid("Unbekannte Art der Meldung".into()));
    }
    let message = d.message.trim();
    let n = message.chars().count();
    if n < MESSAGE_MIN {
        return Err(AppError::Invalid(format!("Bitte beschreibe es etwas genauer (mindestens {MESSAGE_MIN} Zeichen).")));
    }
    if n > MESSAGE_MAX {
        return Err(AppError::Invalid(format!("Der Text ist zu lang (höchstens {MESSAGE_MAX} Zeichen).")));
    }
    let contact = d.contact.as_deref().map(str::trim).filter(|c| !c.is_empty());
    if contact.is_some_and(|c| c.chars().count() > CONTACT_MAX) {
        return Err(AppError::Invalid(format!("Die Kontaktangabe ist zu lang (höchstens {CONTACT_MAX} Zeichen).")));
    }
    let locale: String = d.locale.chars().filter(|c| c.is_ascii_alphanumeric() || *c == '-').take(16).collect();
    Ok(json!({
        "kind": d.kind,
        "message": message,
        "contact": contact,
        "app": "launcher",
        "version": version,
        "channel": if channel == "dev" { "dev" } else { "release" },
        "os": os,
        "arch": arch,
        "locale": if locale.is_empty() { "de".to_string() } else { locale },
        "page": clean_page(d.page.as_deref()),
        "instance": instance,
    }))
}

// ------------------------------------------------------------------ Vorbereiten / Senden

pub fn endpoint(state: &AppState) -> String {
    format!("{}/api/v1/feedback", crate::vibe::api_base(state))
}

/// Vibe-Token, wenn gewünscht, Vibe an und eine noch gültige Anmeldung vorhanden ist.
fn bearer(state: &AppState, want: bool) -> Option<(String, String)> {
    if !want || !state.settings().vibe.enabled {
        return None;
    }
    let t = crate::vibe::tokens_get(state)?;
    let now = chrono::Utc::now().timestamp_millis();
    if t.access_token.is_empty() || t.expires_at <= now + 30_000 {
        return None;
    }
    let name = crate::vibe::identity(state).map(|i| i.name).unwrap_or_default();
    Some((t.access_token, name))
}

pub fn prepare(state: &AppState, d: &Draft) -> AppResult<Preview> {
    let s = state.settings();
    let instance = d.instance_id.as_deref().and_then(|id| instance_meta(state, id));
    let meta = build_meta(d, env!("CARGO_PKG_VERSION"), &s.update_channel, &os_name(), std::env::consts::ARCH, instance)?;

    let mut logs = Vec::new();
    if d.attach_logs {
        let known = redact::Known::from_env();
        for src in sources(state, d.instance_id.as_deref()) {
            match read_cut(&src.path, LOG_MAX_BYTES, src.cut) {
                Ok((raw, len, cut)) if !raw.trim().is_empty() => logs.push(clean_log(&src.name, &raw, len, cut, &known)),
                Ok(_) => {}
                Err(e) => tracing::warn!("Feedback: {} nicht lesbar: {e}", src.name),
            }
        }
    }

    if d.screenshots.len() > MAX_FILES {
        return Err(AppError::Invalid(format!("Höchstens {MAX_FILES} Screenshots.")));
    }
    let h = held().lock();
    let mut shots = Vec::new();
    let mut infos = Vec::new();
    for id in &d.screenshots {
        let img = h.get(id).ok_or_else(|| AppError::NotFound("Screenshot (bitte erneut hinzufügen)".into()))?;
        let thumb = image::load_from_memory(&img.bytes).ok().and_then(|i| thumbnail(&i).ok().map(|t| (t, i.width(), i.height())));
        let (thumb, width, height) = thumb.unwrap_or_default();
        infos.push(ImageInfo { id: id.clone(), name: img.name.clone(), mime: img.mime.clone(), bytes: img.bytes.len() as u64, width, height, thumb });
        shots.push((img.name.clone(), img.mime.clone(), img.bytes.clone()));
    }
    drop(h);

    let auth = bearer(state, d.link_account);
    let total = serde_json::to_vec(&meta)?.len() as u64 + logs.iter().map(|l| l.bytes).sum::<u64>() + shots.iter().map(|s| s.2.len() as u64).sum::<u64>();
    let token = uuid::Uuid::new_v4().simple().to_string();
    let p = Prepared {
        meta: meta.clone(),
        logs: logs.iter().map(|l| (l.name.clone(), l.text.clone())).collect(),
        shots,
        bearer: auth.as_ref().map(|a| a.0.clone()),
        shot_ids: d.screenshots.clone(),
    };
    *prepared().lock() = Some((token.clone(), p, Instant::now()));
    Ok(Preview { token, endpoint: endpoint(state), meta, logs, screenshots: infos, account: auth.map(|a| a.1), total_bytes: total })
}

/// Vorbereitetes Paket senden. Bei Erfolg wird es (samt Screenshots) verworfen; sonst bleibt es für einen
/// neuen Versuch liegen.
pub async fn send(state: &AppState, token: &str) -> AppResult<SendResult> {
    let p = {
        let g = prepared().lock();
        match g.as_ref() {
            Some((t, p, at)) if t == token && at.elapsed() < PREPARED_TTL => p.clone(),
            _ => return Err(AppError::Invalid("Die Vorschau ist abgelaufen – bitte erneut „Weiter“ wählen.".into())),
        }
    };
    let r = send_prepared(&state.net.client, &endpoint(state), &p).await;
    if matches!(r, SendResult::Sent { .. }) {
        let mut g = prepared().lock();
        if g.as_ref().is_some_and(|(t, _, _)| t == token) {
            *g = None;
        }
        drop(g);
        discard(&p.shot_ids);
    }
    Ok(r)
}

/// Multipart bauen und senden (ohne Zustand, testbar gegen einen lokalen Server).
pub async fn send_prepared(client: &reqwest::Client, url: &str, p: &Prepared) -> SendResult {
    use reqwest::multipart::{Form, Part};
    let build = || -> Result<Form, reqwest::Error> {
        let mut form = Form::new().part("meta", Part::text(p.meta.to_string()).mime_str("application/json")?);
        for (name, text) in &p.logs {
            form = form.part("log", Part::bytes(text.clone().into_bytes()).file_name(name.clone()).mime_str("text/plain")?);
        }
        for (name, mime, bytes) in &p.shots {
            form = form.part("screenshot", Part::bytes(bytes.clone()).file_name(name.clone()).mime_str(mime)?);
        }
        Ok(form)
    };
    let form = match build() {
        Ok(f) => f,
        Err(e) => return SendResult::Rejected { http: 0, code: Some("client".into()), message: Some(e.to_string()) },
    };
    let mut rb = client.post(url).multipart(form).timeout(Duration::from_secs(60));
    if let Some(b) = &p.bearer {
        rb = rb.bearer_auth(b);
    }
    let resp = match rb.send().await {
        Ok(r) => r,
        Err(e) => return SendResult::Offline { message: e.without_url().to_string() },
    };
    let status = resp.status().as_u16();
    let retry = resp.headers().get("retry-after").and_then(|v| v.to_str().ok()).and_then(|v| v.trim().parse::<u64>().ok());
    let body = resp.text().await.unwrap_or_default();
    let v: Value = serde_json::from_str(&body).unwrap_or(Value::Null);
    let err_msg = v["error"]["message"].as_str().map(str::to_string);
    let err_code = v["error"]["code"].as_str().map(str::to_string);
    match status {
        200..=299 => match (v["id"].as_str(), v["ticket"].as_str()) {
            (Some(id), Some(ticket)) => SendResult::Sent { id: id.to_string(), ticket: ticket.to_string() },
            (Some(id), None) => SendResult::Sent { id: id.to_string(), ticket: id.to_string() },
            _ => SendResult::Rejected { http: status, code: Some("bad_response".into()), message: None },
        },
        429 => SendResult::RateLimited { retry_after_secs: retry, message: err_msg },
        _ => SendResult::Rejected { http: status, code: err_code, message: err_msg },
    }
}

#[cfg(test)]
mod tests;
