//! Datei-Bereich für Instanzen (Spielordner `instances/<id>/minecraft`) und lokale Server (`servers/<id>`):
//! Ordner auflisten, Dateien suchen, Textdateien lesen/prüfen/speichern (mit Sicherungen), Bilder als Vorschau,
//! Dateiaktionen (neu, umbenennen, duplizieren, löschen, importieren).
//!
//! Jeder Zugriff läuft über [`sandbox::Sandbox`]: nichts außerhalb der Wurzel, keine Symlinks/Junctions,
//! launcher-eigene Dateien verborgen. Sicherungen liegen außerhalb des sichtbaren Baums
//! (Instanz: `instances/<id>/config-backups`, wie beim früheren Config-Editor; Server: `servers/<id>/.vibe-backups/files`).
pub mod ops;
pub mod sandbox;
pub mod validate;
#[cfg(test)]
mod tests;

use crate::paths::Paths;
use sandbox::Sandbox;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

/// Editierbar bis 2 MB.
pub const MAX_EDIT: u64 = 2 * 1024 * 1024;
/// Logs (nur lesend) werden bis 8 MB angezeigt.
pub const MAX_LOG_VIEW: u64 = 8 * 1024 * 1024;
/// Bildvorschau bis 16 MB.
pub const MAX_IMAGE: u64 = 16 * 1024 * 1024;
/// Volltextsuche: größere Dateien werden übersprungen …
pub const SEARCH_MAX_FILE: u64 = 1024 * 1024;
/// … und insgesamt höchstens so viel gelesen.
pub const SEARCH_MAX_TOTAL: u64 = 96 * 1024 * 1024;
pub const MAX_HITS: usize = 200;
/// Namenssuche: höchstens so viele Treffer
pub const MAX_FIND: usize = 500;
/// Namenssuche/Volltextsuche: höchstens so viele Einträge durchlaufen
pub const MAX_WALK: usize = 200_000;
/// Sicherungen je Datei
pub const KEEP_BACKUPS: usize = 10;
pub const TMP_SUFFIX: &str = ".vltmp";
pub const BOM: char = '\u{feff}';

/// Endungen, die als Text gelten.
pub const TEXT_EXTS: &[&str] = &[
    "json", "json5", "jsonc", "toml", "properties", "cfg", "conf", "txt", "yaml", "yml", "ini", "snbt", "js", "zs", "mcmeta", "md",
    "csv", "lang", "xml", "html", "htm", "css", "mcfunction", "sh", "bat", "cmd", "ps1", "log", "gitignore", "kts", "groovy", "list",
    "nbtx", "mf", "env",
];
/// Endungen, die sicher binär sind (keine Inhaltsprüfung nötig).
pub const BINARY_EXTS: &[&str] = &[
    "jar", "zip", "gz", "tgz", "7z", "rar", "mrpack", "dat", "dat_old", "mca", "mcr", "mcc", "nbt", "litematic", "schem", "schematic",
    "exe", "dll", "so", "dylib", "class", "db", "sqlite", "ogg", "mp3", "wav", "ttf", "otf", "bin", "lock", "pak", "ico", "bmp", "jpg",
    "jpeg", "gif", "webp", "png", "vibey",
];
pub const IMAGE_EXTS: &[&str] = &["png", "jpg", "jpeg", "gif", "webp", "bmp"];

/// Welcher Bereich? Frontend: `{ kind: "instance", id }` bzw. `{ kind: "server", id }`.
#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "kind", content = "id", rename_all = "lowercase")]
pub enum FileScope {
    Instance(String),
    Server(String),
}

/// Wurzel + Sicherungsordner eines Bereichs.
#[derive(Debug, Clone)]
pub struct FileRoot {
    pub sandbox: Sandbox,
    pub backups: PathBuf,
}

impl FileRoot {
    pub fn instance(paths: &Paths, id: &str) -> Self {
        FileRoot { sandbox: Sandbox::new(paths.game_dir(id), &[]), backups: paths.instance_dir(id).join("config-backups") }
    }

    pub fn server(paths: &Paths, id: &str) -> Self {
        let dir = crate::server::server_dir(paths, id);
        // vibe-server.json + .vibe-* (PID-Datei, Sicherungen) gehören dem Launcher
        FileRoot {
            backups: dir.join(".vibe-backups").join("files"),
            sandbox: Sandbox::new(dir, &["vibe-server.json", ".vibe-pid", ".vibe-backups"]),
        }
    }

    /// Für Tests/Hilfsfunktionen: beliebige Wurzel.
    pub fn custom(root: PathBuf, backups: PathBuf, hidden: &[&str]) -> Self {
        FileRoot { sandbox: Sandbox::new(root, hidden), backups }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct FileEntry {
    pub name: String,
    /// Relativ zur Wurzel, mit `/`
    pub path: String,
    pub is_dir: bool,
    pub size: u64,
    /// ms seit 1970
    pub modified: i64,
    /// dir | text | image | binary
    pub kind: &'static str,
    /// Anzahl direkter Einträge (nur Ordner)
    pub children: Option<u32>,
    pub has_backup: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct FileContent {
    pub path: String,
    /// Leer, wenn nicht als Text geladen (Bild, binär, zu groß)
    pub content: String,
    pub size: u64,
    pub modified: i64,
    pub has_backup: bool,
    /// text | image | binary
    pub kind: &'static str,
    /// json | json5 | toml | properties | yaml | ini | javascript | snbt | log | text
    pub language: &'static str,
    pub readonly: bool,
    /// `too_large` | `binary` | `encoding` | `log` | `image`
    pub readonly_reason: Option<&'static str>,
}

#[derive(Debug, Clone, Serialize)]
pub struct SearchHit {
    pub path: String,
    /// 1-basiert
    pub line: u32,
    pub text: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct SearchResult {
    pub hits: Vec<SearchHit>,
    /// Abgebrochen (Trefferlimit, Lese- oder Durchlauf-Limit)
    pub truncated: bool,
    pub files_scanned: u32,
    /// Übersprungen, weil größer als `SEARCH_MAX_FILE`
    pub files_skipped: u32,
}

#[derive(Debug, Clone, Serialize)]
pub struct FindResult {
    pub entries: Vec<FileEntry>,
    pub truncated: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct DeleteOutcome {
    pub deleted: u32,
    /// In den Papierkorb verschoben (sonst endgültig gelöscht)
    pub trashed: bool,
    /// Papierkorb nicht möglich – nichts gelöscht, Frontend fragt nach endgültigem Löschen
    pub trash_error: Option<String>,
}

// ------------------------------------------------------------------ Dateitypen

pub fn ext_of(path: &str) -> String {
    let name = path.rsplit('/').next().unwrap_or(path);
    match name.rfind('.') {
        Some(i) if i > 0 => name[i + 1..].to_ascii_lowercase(),
        // `.gitignore`, `.env` …
        Some(0) => name[1..].to_ascii_lowercase(),
        _ => String::new(),
    }
}

pub fn is_log(path: &str) -> bool {
    let p = path.to_ascii_lowercase();
    ext_of(&p) == "log" || p.starts_with("logs/") || p.starts_with("crash-reports/")
}

pub fn is_image(path: &str) -> bool {
    IMAGE_EXTS.contains(&ext_of(path).as_str())
}

pub fn language_of(path: &str) -> &'static str {
    if is_log(path) {
        return "log";
    }
    match ext_of(path).as_str() {
        "json" | "mcmeta" => "json",
        "json5" | "jsonc" => "json5",
        "toml" => "toml",
        "properties" | "cfg" | "conf" | "lang" | "env" => "properties",
        "yaml" | "yml" => "yaml",
        "ini" => "ini",
        "js" | "zs" | "kts" | "groovy" => "javascript",
        "snbt" => "snbt",
        _ => "text",
    }
}

/// Text/Bild/binär – bekannte Endungen direkt, sonst die ersten 8 KB ansehen.
pub fn kind_of(rel: &str, abs: &std::path::Path, size: u64) -> &'static str {
    let ext = ext_of(rel);
    if IMAGE_EXTS.contains(&ext.as_str()) {
        return "image";
    }
    if TEXT_EXTS.contains(&ext.as_str()) {
        return "text";
    }
    if BINARY_EXTS.contains(&ext.as_str()) {
        return "binary";
    }
    if size == 0 {
        return "text";
    }
    sniff_text(abs)
}

fn sniff_text(abs: &std::path::Path) -> &'static str {
    use std::io::Read;
    let Ok(mut f) = std::fs::File::open(abs) else { return "binary" };
    let mut buf = [0u8; 8192];
    let Ok(n) = f.read(&mut buf) else { return "binary" };
    let b = &buf[..n];
    if b.contains(&0) {
        return "binary";
    }
    match std::str::from_utf8(b) {
        Ok(_) => "text",
        // Abgeschnittenes Mehrbyte-Zeichen am Pufferende ist kein Grund für „binär“
        Err(e) if e.error_len().is_none() && n == buf.len() => "text",
        Err(_) => "binary",
    }
}

pub(crate) fn mtime_ms(m: &std::fs::Metadata) -> i64 {
    m.modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}
