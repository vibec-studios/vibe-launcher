//! Konfigurations-Editor: Dateien unter `config/`, `defaultconfigs/` und einzelne Dateien im Spielordner
//! (`options.txt`, `optionsof.txt`, `optionsshaders.txt`) auflisten, lesen, prüfen, durchsuchen und
//! schreiben. Vor jedem Schreiben wird die alte Fassung nach `instances/<id>/config-backups/<pfad>/<zeit>`
//! gesichert (höchstens 10 je Datei); Schreiben ist atomar (tmp + rename).
//!
//! Alle Pfade kommen relativ zum Spielordner mit `/` und werden streng geprüft: kein `..`, keine absoluten
//! Pfade/Laufwerksbuchstaben, nur erlaubte Wurzeln, keine Symlinks, kanonischer Pfad bleibt im Spielordner.
use crate::error::{AppError, AppResult};
use serde::Serialize;
use std::path::{Path, PathBuf};

/// Ordner, deren Inhalt (rekursiv) bearbeitet werden darf.
pub const ROOT_DIRS: &[&str] = &["config", "defaultconfigs"];
/// Einzelne Dateien direkt im Spielordner.
pub const ROOT_FILES: &[&str] = &["options.txt", "optionsof.txt", "optionsshaders.txt"];
/// Endungen, die als Text gelten und bearbeitet werden dürfen.
pub const TEXT_EXTS: &[&str] = &[
    "json", "json5", "toml", "properties", "cfg", "conf", "txt", "yaml", "yml", "ini", "snbt", "js", "zs", "mcmeta",
];
/// Größere Dateien werden nur angezeigt, nicht geladen.
pub const MAX_SIZE: u64 = 2 * 1024 * 1024;
/// Sicherungen je Datei
pub const KEEP_BACKUPS: usize = 10;
/// Höchstzahl an Suchtreffern
pub const MAX_HITS: usize = 200;
const TMP_SUFFIX: &str = ".vltmp";
const BOM: char = '\u{feff}';

#[derive(Debug, Clone, Serialize)]
pub struct ConfigEntry {
    /// Relativ zum Spielordner, mit `/` getrennt
    pub path: String,
    pub is_dir: bool,
    pub size: u64,
    /// ms seit 1970
    pub modified: i64,
    pub has_backup: bool,
    /// Keine Text-Endung -> nicht bearbeitbar
    pub binary: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct ConfigFile {
    pub path: String,
    /// Leer, wenn `readonly` wegen Größe/Binärdatei
    pub content: String,
    pub size: u64,
    pub modified: i64,
    pub has_backup: bool,
    /// json | json5 | toml | properties | yaml | ini | javascript | text
    pub language: String,
    pub readonly: bool,
    /// `too_large` | `binary` | `encoding`
    pub readonly_reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct ValidationError {
    /// 1-basiert
    pub line: u32,
    /// 1-basiert (Zeichen, nicht Bytes)
    pub column: u32,
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct SearchHit {
    pub path: String,
    /// 1-basiert
    pub line: u32,
    pub text: String,
}

/// Spielordner und Sicherungsordner einer Instanz.
#[derive(Debug, Clone)]
pub struct ConfigDirs {
    pub game: PathBuf,
    pub backups: PathBuf,
}

impl ConfigDirs {
    pub fn new(paths: &crate::paths::Paths, instance_id: &str) -> Self {
        ConfigDirs { game: paths.game_dir(instance_id), backups: paths.instance_dir(instance_id).join("config-backups") }
    }
}

// ------------------------------------------------------------------ Pfade

fn ext_of(path: &str) -> String {
    let name = path.rsplit('/').next().unwrap_or(path);
    match name.rfind('.') {
        Some(i) if i > 0 => name[i + 1..].to_ascii_lowercase(),
        _ => String::new(),
    }
}

pub fn is_text(path: &str) -> bool {
    TEXT_EXTS.contains(&ext_of(path).as_str())
}

pub fn language_of(path: &str) -> &'static str {
    match ext_of(path).as_str() {
        "json" | "mcmeta" => "json",
        "json5" => "json5",
        "toml" => "toml",
        "properties" | "cfg" | "conf" => "properties",
        "yaml" | "yml" => "yaml",
        "ini" => "ini",
        "js" | "zs" => "javascript",
        _ => "text",
    }
}

fn invalid(msg: &str) -> AppError {
    AppError::Invalid(msg.to_string())
}

/// Relativen Pfad prüfen und in Bestandteile zerlegen (ohne Dateisystemzugriff).
pub fn normalize(rel: &str) -> AppResult<Vec<String>> {
    if rel.trim().is_empty() || rel.contains('\0') {
        return Err(invalid("Leerer Pfad"));
    }
    let r = rel.replace('\\', "/");
    if r.starts_with('/') || r.contains(':') {
        return Err(invalid("Absolute Pfade sind nicht erlaubt"));
    }
    let mut parts = Vec::new();
    for c in r.split('/') {
        match c {
            "" | "." => {}
            ".." => return Err(invalid("„..“ ist in Pfaden nicht erlaubt")),
            // Windows entfernt Punkte/Leerzeichen am Ende („...“, „datei. “) – nicht zulassen
            c if c.ends_with('.') || c.ends_with(' ') => return Err(invalid("Ungültiger Dateiname")),
            c => parts.push(c.to_string()),
        }
    }
    let allowed = match parts.as_slice() {
        [f] => ROOT_FILES.contains(&f.as_str()),
        [d, _, ..] => ROOT_DIRS.contains(&d.as_str()),
        _ => false,
    };
    if !allowed {
        return Err(invalid("Nur Dateien in config/, defaultconfigs/ und die options-Dateien sind erlaubt"));
    }
    Ok(parts)
}

/// Prüft den Pfad vollständig (inkl. Symlinks) und liefert den absoluten Dateipfad + normierten relativen Pfad.
pub fn resolve(game: &Path, rel: &str) -> AppResult<(PathBuf, String)> {
    let parts = normalize(rel)?;
    let joined = parts.join("/");
    let target = crate::util::safe_join(game, &joined).ok_or_else(|| invalid("Ungültiger Pfad"))?;
    let canon_game = game.canonicalize().map_err(|_| AppError::NotFound("Spielordner der Instanz".into()))?;
    let root = if parts.len() == 1 {
        canon_game.clone()
    } else {
        game.join(&parts[0]).canonicalize().map_err(|_| AppError::NotFound(format!("Ordner {}", parts[0])))?
    };
    if !root.starts_with(&canon_game) {
        return Err(invalid("Pfad außerhalb des Spielordners"));
    }
    // Existierende Ziele: selbst kein Symlink und kanonisch innerhalb der Wurzel.
    // Neue Dateien: der Elternordner muss existieren und innerhalb liegen.
    let check = match std::fs::symlink_metadata(&target) {
        Ok(m) => {
            if m.file_type().is_symlink() {
                return Err(invalid("Verknüpfungen (Symlinks) werden nicht bearbeitet"));
            }
            target.canonicalize()?
        }
        Err(_) => {
            let parent = target.parent().ok_or_else(|| invalid("Ungültiger Pfad"))?;
            parent.canonicalize().map_err(|_| AppError::NotFound(format!("Ordner von {joined}")))?.join("x")
        }
    };
    if !check.starts_with(&root) || check == root {
        return Err(invalid("Pfad außerhalb des erlaubten Bereichs"));
    }
    Ok((target, joined))
}

fn mtime_ms(m: &std::fs::Metadata) -> i64 {
    m.modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

// ------------------------------------------------------------------ Sicherungen

fn backup_dir(d: &ConfigDirs, rel: &str) -> PathBuf {
    let mut p = d.backups.clone();
    for c in rel.split('/') {
        p.push(c);
    }
    p
}

/// Sicherungen einer Datei, älteste zuerst (Namen sind sortierbare Zeitstempel).
pub fn list_backups(d: &ConfigDirs, rel: &str) -> Vec<PathBuf> {
    let Ok(rd) = std::fs::read_dir(backup_dir(d, rel)) else { return Vec::new() };
    let mut v: Vec<PathBuf> = rd
        .flatten()
        .filter(|e| e.file_type().map(|t| t.is_file()).unwrap_or(false))
        .map(|e| e.path())
        .filter(|p| !p.to_string_lossy().ends_with(TMP_SUFFIX))
        .collect();
    v.sort();
    v
}

fn has_backup(d: &ConfigDirs, rel: &str) -> bool {
    std::fs::read_dir(backup_dir(d, rel))
        .map(|mut rd| rd.any(|e| e.map(|e| e.file_type().map(|t| t.is_file()).unwrap_or(false)).unwrap_or(false)))
        .unwrap_or(false)
}

/// Inhalt als neue Sicherung ablegen und alte über `KEEP_BACKUPS` hinaus löschen.
fn add_backup(d: &ConfigDirs, rel: &str, data: &[u8]) -> AppResult<PathBuf> {
    let dir = backup_dir(d, rel);
    std::fs::create_dir_all(&dir)?;
    // Name `<ms, 13 Stellen>-<lfd. Nr.>`: muss lexikografisch nach allen vorhandenen liegen
    let mut ts = crate::util::now_ms();
    let mut seq = 0u32;
    if let Some(last) = list_backups(d, rel).last().and_then(|p| p.file_name().map(|n| n.to_string_lossy().to_string())) {
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
    let all = list_backups(d, rel);
    if all.len() > KEEP_BACKUPS {
        for old in &all[..all.len() - KEEP_BACKUPS] {
            let _ = std::fs::remove_file(old);
        }
    }
    Ok(path)
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

// ------------------------------------------------------------------ Liste, Lesen, Schreiben

/// Flache Liste aller Einträge (Ordner + Dateien), nach Pfad sortiert. Symlinks werden übersprungen.
pub fn tree(d: &ConfigDirs) -> Vec<ConfigEntry> {
    let mut out = Vec::new();
    for root in ROOT_DIRS {
        let base = d.game.join(root);
        let Ok(m) = std::fs::symlink_metadata(&base) else { continue };
        if !m.is_dir() {
            continue;
        }
        for e in walkdir::WalkDir::new(&base).follow_links(false).into_iter().flatten() {
            let ft = e.file_type();
            if ft.is_symlink() {
                continue;
            }
            let name = e.file_name().to_string_lossy();
            if name.ends_with(TMP_SUFFIX) {
                continue;
            }
            let Ok(rel) = e.path().strip_prefix(&d.game) else { continue };
            let rel = rel.to_string_lossy().replace('\\', "/");
            let Ok(meta) = e.metadata() else { continue };
            let is_dir = ft.is_dir();
            out.push(ConfigEntry {
                has_backup: !is_dir && has_backup(d, &rel),
                binary: !is_dir && !is_text(&rel),
                size: if is_dir { 0 } else { meta.len() },
                modified: mtime_ms(&meta),
                is_dir,
                path: rel,
            });
        }
    }
    for f in ROOT_FILES {
        let p = d.game.join(f);
        let Ok(meta) = std::fs::symlink_metadata(&p) else { continue };
        if !meta.is_file() {
            continue;
        }
        out.push(ConfigEntry {
            path: f.to_string(),
            is_dir: false,
            size: meta.len(),
            modified: mtime_ms(&meta),
            has_backup: has_backup(d, f),
            binary: false,
        });
    }
    out.sort_by(|a, b| a.path.to_lowercase().cmp(&b.path.to_lowercase()));
    out
}

pub fn read(d: &ConfigDirs, rel: &str) -> AppResult<ConfigFile> {
    let (abs, rel) = resolve(&d.game, rel)?;
    let meta = std::fs::metadata(&abs).map_err(|_| AppError::NotFound(rel.clone()))?;
    if !meta.is_file() {
        return Err(invalid("Das ist keine Datei"));
    }
    let mut f = ConfigFile {
        language: language_of(&rel).to_string(),
        has_backup: has_backup(d, &rel),
        size: meta.len(),
        modified: mtime_ms(&meta),
        content: String::new(),
        readonly: false,
        readonly_reason: None,
        path: rel,
    };
    if !is_text(&f.path) {
        f.readonly = true;
        f.readonly_reason = Some("binary".into());
        return Ok(f);
    }
    if meta.len() > MAX_SIZE {
        f.readonly = true;
        f.readonly_reason = Some("too_large".into());
        return Ok(f);
    }
    let bytes = std::fs::read(&abs)?;
    match String::from_utf8(bytes) {
        Ok(s) => f.content = s.strip_prefix(BOM).map(str::to_string).unwrap_or(s),
        Err(e) => {
            // Nur ansehen – verlustbehaftet zurückschreiben wäre gefährlich
            f.content = String::from_utf8_lossy(e.as_bytes()).into_owned();
            f.readonly = true;
            f.readonly_reason = Some("encoding".into());
        }
    }
    Ok(f)
}

static WRITE_LOCK: parking_lot::Mutex<()> = parking_lot::Mutex::new(());

pub fn write(d: &ConfigDirs, rel: &str, content: &str) -> AppResult<ConfigFile> {
    let (abs, rel) = resolve(&d.game, rel)?;
    if !is_text(&rel) {
        return Err(invalid("Dieser Dateityp kann nicht bearbeitet werden"));
    }
    if content.len() as u64 > MAX_SIZE {
        return Err(invalid("Der Inhalt ist größer als 2 MB"));
    }
    let _g = WRITE_LOCK.lock();
    let old = match std::fs::read(&abs) {
        Ok(b) => Some(b),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => None,
        Err(e) => return Err(e.into()),
    };
    let mut data = content.strip_prefix(BOM).unwrap_or(content).to_string();
    if let Some(old) = &old {
        let old_s = std::str::from_utf8(old)
            .map_err(|_| invalid("Die Datei ist nicht UTF-8-kodiert und kann hier nicht bearbeitet werden"))?;
        // Zeilenenden und BOM der Originaldatei beibehalten
        if old_s.contains("\r\n") && !data.contains('\r') {
            data = data.replace('\n', "\r\n");
        }
        if old_s.starts_with(BOM) {
            data.insert(0, BOM);
        }
        if old.as_slice() != data.as_bytes() {
            add_backup(d, &rel, old)?;
        }
    }
    if old.as_deref() != Some(data.as_bytes()) {
        write_atomic(&abs, data.as_bytes())?;
    }
    drop(_g);
    read(d, &rel)
}

/// Neueste Sicherung zurückspielen; der aktuelle Inhalt wird vorher selbst gesichert (rückgängig machbar).
pub fn restore(d: &ConfigDirs, rel: &str) -> AppResult<ConfigFile> {
    let (abs, rel) = resolve(&d.game, rel)?;
    let _g = WRITE_LOCK.lock();
    let latest = list_backups(d, &rel).pop().ok_or_else(|| AppError::NotFound("Sicherung für diese Datei".into()))?;
    let data = std::fs::read(&latest)?;
    let cur = match std::fs::read(&abs) {
        Ok(cur) => Some(cur),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => None,
        Err(e) => return Err(e.into()),
    };
    // Erst die zurückgespielte Sicherung entfernen, dann die aktuelle Fassung sichern –
    // so verdrängt die neue Sicherung keine ältere (Anzahl bleibt gleich).
    std::fs::remove_file(&latest)?;
    let res = (|| -> AppResult<()> {
        if let Some(cur) = cur.as_ref().filter(|c| **c != data) {
            add_backup(d, &rel, cur)?;
        }
        write_atomic(&abs, &data)
    })();
    if let Err(e) = res {
        // Inhalt der Sicherung nicht verlieren
        let _ = add_backup(d, &rel, &data);
        return Err(e);
    }
    drop(_g);
    read(d, &rel)
}

// ------------------------------------------------------------------ Suche

pub fn search(d: &ConfigDirs, query: &str) -> Vec<SearchHit> {
    let q = query.trim().to_lowercase();
    let mut hits = Vec::new();
    if q.is_empty() {
        return hits;
    }
    for e in tree(d) {
        if e.is_dir || e.binary || e.size > MAX_SIZE {
            continue;
        }
        let Ok(bytes) = std::fs::read(d.game.join(&e.path)) else { continue };
        let text = String::from_utf8_lossy(&bytes);
        for (i, line) in text.lines().enumerate() {
            if line.to_lowercase().contains(&q) {
                let t = line.trim().trim_start_matches(BOM);
                let t: String = if t.chars().count() > 200 { t.chars().take(200).chain("…".chars()).collect() } else { t.to_string() };
                hits.push(SearchHit { path: e.path.clone(), line: i as u32 + 1, text: t });
                if hits.len() >= MAX_HITS {
                    return hits;
                }
            }
        }
    }
    hits
}

// ------------------------------------------------------------------ Prüfung

/// Syntax prüfen: JSON (Kommentare erlaubt), JSON5 (Kommentare + abschließende Kommas), TOML. Sonst keine Fehler.
pub fn validate(rel: &str, content: &str) -> Vec<ValidationError> {
    let content = content.strip_prefix(BOM).unwrap_or(content);
    if content.trim().is_empty() {
        return Vec::new();
    }
    match language_of(&rel.replace('\\', "/")) {
        "json" => validate_json(&strip_json(content, false), false),
        "json5" => validate_json(&strip_json(content, true), true),
        "toml" => validate_toml(content),
        _ => Vec::new(),
    }
}

/// Kommentare (`//`, `/* */`) und ggf. abschließende Kommas durch Leerzeichen ersetzen –
/// Zeilen und Spalten (in Zeichen) bleiben gleich.
pub fn strip_json(s: &str, trailing_commas: bool) -> String {
    let c: Vec<char> = s.chars().collect();
    let mut out = c.clone();
    let mut i = 0;
    let mut in_str: Option<char> = None;
    while i < c.len() {
        let ch = c[i];
        if let Some(q) = in_str {
            if ch == '\\' {
                i += 2;
                continue;
            }
            if ch == q || ch == '\n' {
                in_str = None;
            }
            i += 1;
            continue;
        }
        match ch {
            '"' => in_str = Some('"'),
            '\'' if trailing_commas => in_str = Some('\''),
            '/' if c.get(i + 1) == Some(&'/') => {
                while i < c.len() && c[i] != '\n' {
                    out[i] = ' ';
                    i += 1;
                }
                continue;
            }
            '/' if c.get(i + 1) == Some(&'*') => {
                out[i] = ' ';
                out[i + 1] = ' ';
                i += 2;
                while i < c.len() && !(c[i] == '*' && c.get(i + 1) == Some(&'/')) {
                    if c[i] != '\n' && c[i] != '\r' {
                        out[i] = ' ';
                    }
                    i += 1;
                }
                if i < c.len() {
                    out[i] = ' ';
                    if i + 1 < c.len() {
                        out[i + 1] = ' ';
                    }
                    i += 2;
                }
                continue;
            }
            _ => {}
        }
        i += 1;
    }
    if trailing_commas {
        // Zweiter Durchgang auf dem kommentarfreien Text
        let mut in_str: Option<char> = None;
        let mut i = 0;
        while i < out.len() {
            let ch = out[i];
            if let Some(q) = in_str {
                if ch == '\\' {
                    i += 2;
                    continue;
                }
                if ch == q || ch == '\n' {
                    in_str = None;
                }
            } else if ch == '"' || ch == '\'' {
                in_str = Some(ch);
            } else if ch == ',' {
                let next = out[i + 1..].iter().find(|c| !c.is_whitespace());
                if matches!(next, Some('}') | Some(']')) {
                    out[i] = ' ';
                }
            }
            i += 1;
        }
    }
    out.into_iter().collect()
}

/// serde_json-Spalte (Bytes) in Zeichen-Spalte umrechnen.
fn char_column(text: &str, line: usize, byte_col: usize) -> usize {
    let Some(l) = text.split('\n').nth(line.saturating_sub(1)) else { return byte_col };
    let mut end = byte_col.min(l.len());
    while end > 0 && !l.is_char_boundary(end) {
        end -= 1;
    }
    l[..end].chars().count().max(1)
}

fn json_message(raw: &str) -> String {
    let m = match raw.rfind(" at line ") {
        Some(i) => &raw[..i],
        None => raw,
    };
    if m.starts_with("EOF while parsing") {
        "Unerwartetes Dateiende – fehlt eine schließende Klammer oder ein Anführungszeichen?".to_string()
    } else if m == "trailing comma" {
        "Überflüssiges Komma vor der schließenden Klammer".to_string()
    } else if m == "expected `,` or `}`" {
        "„,“ oder „}“ erwartet – fehlt ein Komma?".to_string()
    } else if m == "expected `,` or `]`" {
        "„,“ oder „]“ erwartet – fehlt ein Komma?".to_string()
    } else if m == "expected `:`" {
        "„:“ erwartet".to_string()
    } else if m == "key must be a string" {
        "Schlüssel muss in doppelten Anführungszeichen stehen".to_string()
    } else if m == "expected value" {
        "Wert erwartet".to_string()
    } else if m == "expected ident" {
        "Ungültiger Wert (erlaubt: true, false, null, Zahl, \"Text\")".to_string()
    } else if m == "trailing characters" {
        "Zusätzliche Zeichen nach dem Ende des Dokuments".to_string()
    } else if m.starts_with("control character") {
        "Steuerzeichen in Zeichenkette (Zeilenumbruch in \"…\"?)".to_string()
    } else if m == "invalid escape" {
        "Ungültige Escape-Sequenz".to_string()
    } else if m == "invalid number" {
        "Ungültige Zahl".to_string()
    } else {
        format!("JSON-Fehler: {m}")
    }
}

fn validate_json(text: &str, json5: bool) -> Vec<ValidationError> {
    match serde_json::from_str::<serde_json::Value>(text) {
        Ok(_) => Vec::new(),
        Err(e) => {
            let raw = e.to_string();
            let line = e.line().max(1);
            let col = char_column(text, line, e.column());
            if json5 {
                // JSON5-Erweiterungen (Schlüssel ohne Anführungszeichen, '…', Hex, Infinity …) nicht als Fehler melden
                let at = text.split('\n').nth(line - 1).and_then(|l| l.chars().nth(col.saturating_sub(1)));
                let ext = raw.starts_with("key must be a string")
                    || matches!(at, Some('\'') | Some('+') | Some('.'))
                    || at.is_some_and(|c| c.is_alphabetic() || c == '_' || c == '$')
                    || raw.starts_with("invalid number");
                if ext {
                    return Vec::new();
                }
            }
            vec![ValidationError { line: line as u32, column: col as u32, message: json_message(&raw) }]
        }
    }
}

fn validate_toml(text: &str) -> Vec<ValidationError> {
    match text.parse::<toml::Table>() {
        Ok(_) => Vec::new(),
        Err(e) => {
            let (line, column) = match e.span() {
                Some(sp) => {
                    let start = sp.start.min(text.len());
                    let mut s = start;
                    while s > 0 && !text.is_char_boundary(s) {
                        s -= 1;
                    }
                    let before = &text[..s];
                    let line = before.matches('\n').count() + 1;
                    let col = before.rsplit('\n').next().map(|l| l.chars().count()).unwrap_or(0) + 1;
                    (line, col)
                }
                None => (1, 1),
            };
            let m = e.message().trim().replace('\n', " – ").replace(" in table ", " in Tabelle ");
            let msg = if let Some(k) = m.strip_prefix("duplicate key ") {
                format!("Doppelter Schlüssel {k}")
            } else {
                format!("TOML-Fehler: {m}")
            };
            vec![ValidationError { line: line as u32, column: column as u32, message: msg }]
        }
    }
}

// ------------------------------------------------------------------ Tests

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp_dirs(tag: &str) -> ConfigDirs {
        let root = std::env::temp_dir().join(format!("vl-cfg-{tag}-{}", uuid::Uuid::new_v4()));
        let game = root.join("minecraft");
        std::fs::create_dir_all(game.join("config/sub")).unwrap();
        std::fs::create_dir_all(game.join("defaultconfigs")).unwrap();
        std::fs::create_dir_all(game.join("saves")).unwrap();
        ConfigDirs { game, backups: root.join("config-backups") }
    }

    #[test]
    fn normalize_rejects_bad_paths() {
        for bad in [
            "",
            "../x.json",
            "config/../../x.json",
            "/config/a.json",
            "\\config\\a.json",
            "C:/Windows/win.ini",
            "C:config/a.json",
            "config",
            "saves/level.dat",
            "mods/a.toml",
            "servers.dat",
            "config/...",
            "config/a.json.",
            "config/a\0.json",
            "options.txt/x",
        ] {
            assert!(normalize(bad).is_err(), "sollte abgelehnt werden: {bad:?}");
        }
        assert_eq!(normalize("config/sub/a.json").unwrap(), vec!["config", "sub", "a.json"]);
        assert_eq!(normalize("config\\a.toml").unwrap(), vec!["config", "a.toml"]);
        assert_eq!(normalize("./config//a.toml").unwrap(), vec!["config", "a.toml"]);
        assert!(normalize("options.txt").is_ok());
        assert!(normalize("defaultconfigs/x.toml").is_ok());
    }

    #[test]
    fn resolve_stays_inside() {
        let d = tmp_dirs("resolve");
        std::fs::write(d.game.join("config/a.json"), "{}").unwrap();
        let (p, rel) = resolve(&d.game, "config\\a.json").unwrap();
        assert_eq!(rel, "config/a.json");
        assert!(p.ends_with("a.json"));
        // Neue Datei in existierendem Ordner ok, in fehlendem Ordner nicht
        assert!(resolve(&d.game, "config/neu.json").is_ok());
        assert!(resolve(&d.game, "config/fehlt/neu.json").is_err());
        #[cfg(windows)]
        {
            // Symlink-Ausbruch (nur wenn Symlinks erlaubt sind)
            let outside = d.game.parent().unwrap().join("outside");
            std::fs::create_dir_all(&outside).unwrap();
            std::fs::write(outside.join("x.json"), "{}").unwrap();
            if std::os::windows::fs::symlink_dir(&outside, d.game.join("config/link")).is_ok() {
                assert!(resolve(&d.game, "config/link/x.json").is_err());
                assert!(tree(&d).iter().all(|e| !e.path.contains("link")));
            }
        }
        let _ = std::fs::remove_dir_all(d.game.parent().unwrap());
    }

    #[test]
    fn tree_lists_allowed() {
        let d = tmp_dirs("tree");
        std::fs::write(d.game.join("config/a.json"), "{}").unwrap();
        std::fs::write(d.game.join("config/sub/b.toml"), "x = 1").unwrap();
        std::fs::write(d.game.join("config/sub/c.bin"), [0u8, 1, 2]).unwrap();
        std::fs::write(d.game.join("defaultconfigs/d.toml"), "").unwrap();
        std::fs::write(d.game.join("options.txt"), "fov:0").unwrap();
        std::fs::write(d.game.join("servers.dat"), [0u8]).unwrap();
        std::fs::write(d.game.join("saves/x.json"), "{}").unwrap();
        let t = tree(&d);
        let paths: Vec<_> = t.iter().map(|e| e.path.as_str()).collect();
        assert!(paths.contains(&"config/a.json"));
        assert!(paths.contains(&"config/sub"));
        assert!(paths.contains(&"config/sub/b.toml"));
        assert!(paths.contains(&"defaultconfigs/d.toml"));
        assert!(paths.contains(&"options.txt"));
        assert!(!paths.iter().any(|p| p.contains("servers.dat") || p.contains("saves")));
        assert!(t.iter().find(|e| e.path == "config/sub/c.bin").unwrap().binary);
        let r = read(&d, "config/sub/c.bin").unwrap();
        assert!(r.readonly && r.content.is_empty());
        let _ = std::fs::remove_dir_all(d.game.parent().unwrap());
    }

    #[test]
    fn write_backup_rotation_and_restore() {
        let d = tmp_dirs("backup");
        let rel = "config/sub/b.toml";
        std::fs::write(d.game.join(rel), "v = 0\r\n").unwrap();
        for i in 1..=13 {
            let f = write(&d, rel, &format!("v = {i}\n")).unwrap();
            assert!(f.has_backup);
        }
        let b = list_backups(&d, rel);
        assert_eq!(b.len(), KEEP_BACKUPS);
        // Neueste Sicherung = Fassung vor dem letzten Schreiben; CRLF bleibt erhalten
        assert_eq!(std::fs::read_to_string(b.last().unwrap()).unwrap(), "v = 12\r\n");
        assert_eq!(std::fs::read_to_string(d.game.join(rel)).unwrap(), "v = 13\r\n");
        // Gleicher Inhalt -> keine neue Sicherung
        write(&d, rel, "v = 13\n").unwrap();
        assert_eq!(list_backups(&d, rel).len(), KEEP_BACKUPS);
        // Wiederherstellen und rückgängig machen
        let r = restore(&d, rel).unwrap();
        assert_eq!(r.content, "v = 12\r\n");
        let r = restore(&d, rel).unwrap();
        assert_eq!(r.content, "v = 13\r\n");
        assert_eq!(list_backups(&d, rel).len(), KEEP_BACKUPS);
        // Keine Sicherung -> Fehler
        std::fs::write(d.game.join("config/a.json"), "{}").unwrap();
        assert!(restore(&d, "config/a.json").is_err());
        // Nicht-UTF-8 wird nicht überschrieben, nur angezeigt
        std::fs::write(d.game.join("config/latin.properties"), b"name=M\xfcller\n").unwrap();
        let f = read(&d, "config/latin.properties").unwrap();
        assert!(f.readonly && f.readonly_reason.as_deref() == Some("encoding"));
        assert!(write(&d, "config/latin.properties", "name=x").is_err());
        // Keine tmp-Reste
        assert!(tree(&d).iter().all(|e| !e.path.ends_with(TMP_SUFFIX)));
        let _ = std::fs::remove_dir_all(d.game.parent().unwrap());
    }

    #[test]
    fn bom_is_kept() {
        let d = tmp_dirs("bom");
        std::fs::write(d.game.join("config/a.json"), "\u{feff}{\"a\": 1}").unwrap();
        let f = read(&d, "config/a.json").unwrap();
        assert_eq!(f.content, "{\"a\": 1}");
        write(&d, "config/a.json", "{\"a\": 2}").unwrap();
        assert_eq!(std::fs::read_to_string(d.game.join("config/a.json")).unwrap(), "\u{feff}{\"a\": 2}");
        let _ = std::fs::remove_dir_all(d.game.parent().unwrap());
    }

    #[test]
    fn validation() {
        assert!(validate("config/a.json", "{\"a\": 1}").is_empty());
        assert!(validate("config/a.json", "  ").is_empty());
        assert!(validate("config/a.json", "// Kommentar\n{\"a\": /* x */ 1}").is_empty());
        let e = validate("config/a.json", "{\n  \"a\": 1\n  \"b\": 2\n}");
        assert_eq!(e.len(), 1);
        assert_eq!(e[0].line, 3);
        assert_eq!(e[0].column, 3);
        let e = validate("config/a.json", "{\"a\": 1,}");
        assert_eq!(e.len(), 1);
        // JSON5: Kommentare und abschließende Kommas erlaubt, echte Fehler bleiben
        assert!(validate("config/a.json5", "{\n // c\n \"a\": [1, 2,],\n}").is_empty());
        assert!(validate("config/a.json5", "{ a: 1 }").is_empty());
        assert_eq!(validate("config/a.json5", "{\"a\": 1 \"b\": 2}").len(), 1);
        // "//" in Strings ist kein Kommentar
        assert!(validate("config/a.json", "{\"url\": \"https://x.y\"}").is_empty());
        // TOML
        assert!(validate("config/a.toml", "[general]\nx = 1\ny = \"z\"\n").is_empty());
        let e = validate("config/a.toml", "[general]\nx = 1\nx = 2\n");
        assert_eq!(e.len(), 1);
        assert_eq!(e[0].line, 3);
        let e = validate("config/a.toml", "a = \n");
        assert_eq!(e.len(), 1);
        assert_eq!(e[0].line, 1);
        // Andere Formate: nie Fehler
        assert!(validate("config/a.properties", "{{{").is_empty());
        // Spalten in Zeichen (Umlaute)
        let e = validate("config/a.json", "{\"ä\": 1 \"b\": 2}");
        // `{"ä": 1 "b": 2}` – das zweite `"` ist das 9. Zeichen (Byte-Spalte wäre 10)
        assert_eq!(e[0].column, 9);
    }

    #[test]
    fn search_finds_lines() {
        let d = tmp_dirs("search");
        std::fs::write(d.game.join("config/a.json"), "{\n  \"RenderDistance\": 12\n}").unwrap();
        std::fs::write(d.game.join("config/sub/b.toml"), "renderdistance = 4\nfoo = 1\n").unwrap();
        std::fs::write(d.game.join("config/sub/c.bin"), "renderdistance").unwrap();
        let h = search(&d, "RENDERdistance");
        assert_eq!(h.len(), 2);
        assert_eq!(h[0].path, "config/a.json");
        assert_eq!(h[0].line, 2);
        assert_eq!(h[1].line, 1);
        assert!(search(&d, "  ").is_empty());
        let _ = std::fs::remove_dir_all(d.game.parent().unwrap());
    }
}
