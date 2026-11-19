//! Creator-Tools: Blockbench finden und das Vibey-Plugin bereitstellen.
//!
//! So lädt Blockbench (Desktop, 4.x/5.x) Plugins – geprüft am Quelltext von Blockbench 5.2:
//! - „Datei → Plugins… → Plugin aus Datei laden“ oder eine `.js`-Datei ins Fenster ziehen: Blockbench merkt sich
//!   den **Pfad** (`localStorage["StateMemory.installed_plugins"]`, `source: "file"`) und lädt die Datei bei jedem
//!   Start neu von dort. Die Plugin-ID ist der Dateiname (`vibey`).
//! - „Plugin von URL laden“ (nur https) merkt sich die URL.
//! - Eine `.js`-Datei als Startargument installiert **nicht** (Blockbench meldet „Format nicht unterstützt“), es gibt
//!   kein URL-Schema – eine vollautomatische Installation ginge nur über Blockbenchs interne Datenbank.
//!
//! Darum legt der Launcher `vibey.js` an einen **festen Ort** (`<data>/vibey/blockbench/vibey.js`) und hält ihn
//! aktuell. Der Nutzer lädt die Datei einmal in Blockbench (ziehen oder „aus Datei laden“), danach bekommt er
//! Updates automatisch beim nächsten Blockbench-Start. Ob das Plugin eingerichtet ist, liest der Launcher (nur
//! lesend, best effort) aus Blockbenchs localStorage.
//!
//! **Quelle:** Das Plugin hat eigene GitHub-Releases in `vibec-studios/vibey-client` (Tag `blockbench-v<version>`,
//! nicht „latest“), unabhängig von Launcher- und Client-Releases. Assets: `vibey.js` und `vibey-blockbench.json`
//! (`version`, `file`, `size`, `sha256`, `min_client`, `notes`). Der Launcher nimmt das höchste solche Release und
//! prüft SHA-256 + Größe. Nur wenn GitHub nicht erreichbar ist, nutzt er den alten `blockbench`-Eintrag des Backends.
use crate::error::{AppError, AppResult};
use crate::state::AppState;
use serde::{Deserialize, Serialize};
use parking_lot::Mutex;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use std::time::{Duration, Instant};

const GH_REPO: &str = "vibec-studios/vibey-client";
const TAG_PREFIX: &str = "blockbench-v";
const MANIFEST_FILE: &str = "vibey-blockbench.json";
const CACHE_TTL: Duration = Duration::from_secs(10 * 60);

pub fn plugin_dir(state: &AppState) -> PathBuf {
    super::data_dir(state).join("blockbench")
}
pub fn plugin_path(state: &AppState) -> PathBuf {
    plugin_dir(state).join("vibey.js")
}
fn plugin_meta_path(state: &AppState) -> PathBuf {
    plugin_dir(state).join("vibey.json")
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct PluginMeta {
    version: String,
    sha256: String,
}

#[derive(Debug, Deserialize)]
struct GhRelease {
    tag_name: String,
    #[serde(default)]
    draft: bool,
    #[serde(default)]
    prerelease: bool,
}

/// `vibey-blockbench.json` eines Plugin-Releases.
#[derive(Debug, Clone, Deserialize)]
struct PluginManifest {
    version: String,
    file: String,
    #[serde(default)]
    size: u64,
    sha256: String,
    #[serde(default)]
    min_client: Option<String>,
    #[serde(default)]
    notes: Option<String>,
}

/// Neueste Plugin-Version mit Download-Adresse.
#[derive(Debug, Clone)]
struct PluginRelease {
    version: String,
    size: u64,
    sha256: String,
    url: String,
    min_client: Option<String>,
    notes: Option<String>,
}

/// Höchstes veröffentlichtes Plugin-Release (`blockbench-v*`, kein Draft/Prerelease) -> Tag.
fn pick_tag(rels: &[GhRelease]) -> Option<&str> {
    rels.iter()
        .filter(|r| !r.draft && !r.prerelease)
        .filter_map(|r| r.tag_name.strip_prefix(TAG_PREFIX).filter(|v| !v.is_empty()).map(|v| (v, r.tag_name.as_str())))
        .max_by(|a, b| super::install::cmp_versions(a.0, b.0))
        .map(|(_, t)| t)
}

fn gh_download(tag: &str, file: &str) -> String {
    format!("https://github.com/{GH_REPO}/releases/download/{tag}/{file}")
}

async fn from_github(state: &AppState) -> AppResult<PluginRelease> {
    let rels: Vec<GhRelease> = state.net.get_json(&format!("https://api.github.com/repos/{GH_REPO}/releases?per_page=50")).await?;
    let tag = pick_tag(&rels).ok_or_else(|| AppError::NotFound("Es gibt noch kein veröffentlichtes Blockbench-Plugin.".into()))?;
    let m: PluginManifest = state.net.get_json(&gh_download(tag, MANIFEST_FILE)).await?;
    if tag.strip_prefix(TAG_PREFIX) != Some(m.version.as_str()) {
        return Err(AppError::Invalid(format!("Plugin-Release {tag} meldet Version {}", m.version)));
    }
    let file = super::safe_file_name(&m.file, ".js")?;
    if !super::valid_sha256(&m.sha256) {
        return Err(AppError::Invalid("Ungültige Prüfsumme im Plugin-Manifest".into()));
    }
    Ok(PluginRelease { url: gh_download(tag, &file), version: m.version, size: m.size, sha256: m.sha256, min_client: m.min_client, notes: m.notes })
}

/// Alter Weg (Backend-Manifest des Clients), nur als Rückfall.
async fn from_backend(state: &AppState, force: bool) -> AppResult<PluginRelease> {
    let base = crate::vibe::ensure(state, crate::vibe::Feature::Any)?;
    let rel = super::latest(state, force).await?;
    let bb = rel.blockbench.ok_or_else(|| AppError::NotFound("Es gibt noch kein veröffentlichtes Blockbench-Plugin.".into()))?;
    super::safe_file_name(&bb.file, ".js")?;
    Ok(PluginRelease { url: super::resolve_url(&base, &bb.url)?, version: bb.version, size: bb.size, sha256: bb.sha256, min_client: None, notes: None })
}

fn cache() -> &'static Mutex<Option<(Instant, PluginRelease)>> {
    static C: OnceLock<Mutex<Option<(Instant, PluginRelease)>>> = OnceLock::new();
    C.get_or_init(Default::default)
}

async fn latest_plugin(state: &AppState, force: bool) -> AppResult<PluginRelease> {
    if !force {
        if let Some((at, r)) = cache().lock().as_ref() {
            if at.elapsed() < CACHE_TTL {
                return Ok(r.clone());
            }
        }
    }
    let rel = match from_github(state).await {
        Ok(r) => r,
        Err(gh) => {
            tracing::warn!("Blockbench-Plugin von GitHub nicht abrufbar: {gh}");
            from_backend(state, force).await.map_err(|_| gh)?
        }
    };
    *cache().lock() = Some((Instant::now(), rel.clone()));
    Ok(rel)
}

/// Blockbench-Programm suchen.
pub fn find_exe() -> Option<PathBuf> {
    let mut c: Vec<PathBuf> = Vec::new();
    #[cfg(target_os = "windows")]
    {
        if let Some(l) = std::env::var_os("LOCALAPPDATA") {
            c.push(PathBuf::from(&l).join("Programs").join("Blockbench").join("Blockbench.exe"));
        }
        for v in ["ProgramFiles", "ProgramFiles(x86)"] {
            if let Some(p) = std::env::var_os(v) {
                c.push(PathBuf::from(p).join("Blockbench").join("Blockbench.exe"));
            }
        }
    }
    #[cfg(target_os = "macos")]
    {
        c.push(PathBuf::from("/Applications/Blockbench.app"));
        if let Some(h) = dirs::home_dir() {
            c.push(h.join("Applications").join("Blockbench.app"));
        }
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        c.push(PathBuf::from("/usr/bin/blockbench"));
        c.push(PathBuf::from("/opt/Blockbench/blockbench"));
        c.push(PathBuf::from("/snap/bin/blockbench"));
        if let Some(h) = dirs::home_dir() {
            c.push(h.join(".local").join("bin").join("blockbench"));
            c.push(h.join("Applications").join("Blockbench.AppImage"));
        }
    }
    c.into_iter().find(|p| p.exists())
}

/// Blockbenchs Datenordner (Electron `userData`).
fn user_data() -> Option<PathBuf> {
    #[cfg(target_os = "macos")]
    return dirs::home_dir().map(|h| h.join("Library").join("Application Support").join("Blockbench"));
    #[cfg(not(target_os = "macos"))]
    return dirs::config_dir().map(|d| d.join("Blockbench"));
}

/// Liest aus Blockbenchs localStorage (LevelDB), ob ein Plugin `vibey` installiert ist.
/// `None` = unbekannt (Blockbench nie gestartet / nicht lesbar). Nur lesend.
pub fn plugin_registered() -> Option<bool> {
    let dir = user_data()?.join("Local Storage").join("leveldb");
    registered_in(&dir)
}

fn registered_in(dir: &Path) -> Option<bool> {
    let rd = std::fs::read_dir(dir).ok()?;
    // Neueste Daten zuerst: Log-Dateien, dann Tabellen absteigend nach Nummer
    let mut files: Vec<(u8, u64, PathBuf)> = rd
        .flatten()
        .filter_map(|e| {
            let p = e.path();
            let ext = p.extension()?.to_str()?.to_string();
            let num = p.file_stem()?.to_str()?.parse::<u64>().ok()?;
            match ext.as_str() {
                "log" => Some((0, u64::MAX - num, p)),
                "ldb" => Some((1, u64::MAX - num, p)),
                _ => None,
            }
        })
        .collect();
    files.sort();
    let mut seen = false;
    for (_, _, p) in files {
        let Ok(b) = std::fs::read(&p) else { continue };
        if let Some(found) = last_record(&b) {
            return Some(found);
        }
        seen = true;
    }
    seen.then_some(false)
}

/// Letzter Eintrag `StateMemory.installed_plugins` in einem LevelDB-Block: enthält er `"id":"vibey"`?
fn last_record(b: &[u8]) -> Option<bool> {
    const KEY: &[u8] = b"StateMemory.installed_plugins";
    let pos = b.windows(KEY.len()).rposition(|w| w == KEY)?;
    let rest = &b[pos + KEY.len()..];
    let start = rest.iter().position(|&c| c == b'[')?;
    if start > 16 {
        return None;
    }
    let end = rest[start..].iter().position(|&c| c == b']').map(|e| start + e + 1)?;
    let json = String::from_utf8_lossy(&rest[start..end]);
    Some(json.replace(' ', "").contains("\"id\":\"vibey\""))
}

#[derive(Debug, Clone, Serialize)]
pub struct BlockbenchStatus {
    /// Pfad zu Blockbench (None = nicht gefunden)
    pub blockbench: Option<String>,
    /// Ort der vom Launcher verwalteten Plugin-Datei
    pub plugin_path: String,
    /// Plugin-Datei liegt dort
    pub plugin_present: bool,
    pub plugin_version: Option<String>,
    /// In Blockbench eingerichtet (best effort, None = unbekannt)
    pub registered: Option<bool>,
    pub latest_version: Option<String>,
    /// Älteste Vibey-Client-Version, mit der Live-Link/Einreichen gehen
    pub min_client: Option<String>,
    pub notes: Option<String>,
    pub update_available: bool,
    pub error: Option<String>,
}

pub async fn status(state: &AppState) -> BlockbenchStatus {
    let meta: Option<PluginMeta> = std::fs::read(plugin_meta_path(state)).ok().and_then(|b| serde_json::from_slice(&b).ok());
    let present = plugin_path(state).is_file();
    let mut out = BlockbenchStatus {
        blockbench: find_exe().map(|p| p.to_string_lossy().to_string()),
        plugin_path: plugin_path(state).to_string_lossy().to_string(),
        plugin_present: present,
        plugin_version: present.then(|| meta.as_ref().map(|m| m.version.clone())).flatten(),
        registered: tokio::task::spawn_blocking(plugin_registered).await.ok().flatten(),
        latest_version: None,
        min_client: None,
        notes: None,
        update_available: false,
        error: None,
    };
    if state.settings().vibe.enabled {
        match latest_plugin(state, false).await {
            Ok(bb) => {
                out.update_available = present && meta.as_ref().map_or(true, |m| m.sha256 != bb.sha256);
                out.latest_version = Some(bb.version);
                out.min_client = bb.min_client;
                out.notes = bb.notes;
            }
            Err(e) => out.error = Some(e.to_string()),
        }
    }
    out
}

/// Neuestes Plugin laden (SHA-256 geprüft) und an den festen Ort legen.
pub async fn install_plugin(state: &AppState) -> AppResult<BlockbenchStatus> {
    // Creator-Tools gehören zu Vibe und folgen dem Hauptschalter, auch wenn die Datei von GitHub kommt
    crate::vibe::ensure(state, crate::vibe::Feature::Any)?;
    let bb = latest_plugin(state, true).await?;
    // Immer als vibey.js ablegen: Blockbench nimmt den Dateinamen als Plugin-ID
    super::download_verified(state, &bb.url, &plugin_path(state), &bb.sha256, Some(bb.size)).await?;
    crate::util::write_json_atomic(&plugin_meta_path(state), &PluginMeta { version: bb.version, sha256: bb.sha256 })?;
    Ok(status(state).await)
}

/// Blockbench starten.
pub fn open() -> AppResult<()> {
    let exe = find_exe().ok_or_else(|| AppError::NotFound("Blockbench wurde nicht gefunden".into()))?;
    #[cfg(target_os = "macos")]
    std::process::Command::new("open").arg(&exe).spawn()?;
    #[cfg(not(target_os = "macos"))]
    std::process::Command::new(&exe).spawn()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn picks_highest_plugin_release() {
        let r = |t: &str, draft, prerelease| GhRelease { tag_name: t.into(), draft, prerelease };
        let rels = vec![
            r("v0.3.0", false, false),
            r("blockbench-v0.2.3", false, false),
            r("blockbench-v0.2.10", false, false),
            r("blockbench-v0.4.0", true, false),
            r("blockbench-v0.5.0", false, true),
            r("blockbench-v", false, false),
        ];
        assert_eq!(pick_tag(&rels), Some("blockbench-v0.2.10"));
        assert_eq!(pick_tag(&[r("v0.2.1", false, false)]), None);
        assert_eq!(gh_download("blockbench-v0.2.3", "vibey.js"), "https://github.com/vibec-studios/vibey-client/releases/download/blockbench-v0.2.3/vibey.js");
    }

    #[test]
    fn record_parsing() {
        let mut b = b"xx\x00StateMemory.installed_plugins\x92\x01\x01[{\"id\":\"geckolib\",\"source\":\"store\"}]\x01".to_vec();
        assert_eq!(last_record(&b), Some(false));
        b.extend_from_slice(b"StateMemory.installed_plugins\x01[{\"id\":\"vibey\",\"version\":\"0.2.0\",\"path\":\"C:\\\\x\\\\vibey.js\",\"source\":\"file\"}]");
        assert_eq!(last_record(&b), Some(true));
        assert_eq!(last_record(b"nichts hier"), None);
    }

    #[test]
    fn leveldb_dir() {
        let dir = std::env::temp_dir().join(format!("vibey-bb-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        // ältere Tabelle sagt ja, neueres Log sagt nein -> nein
        std::fs::write(dir.join("000005.ldb"), b"StateMemory.installed_plugins\x01[{\"id\":\"vibey\"}]").unwrap();
        std::fs::write(dir.join("000009.log"), b"StateMemory.installed_plugins\x01[]").unwrap();
        assert_eq!(registered_in(&dir), Some(false));
        std::fs::write(dir.join("000011.log"), b"StateMemory.installed_plugins\x01[{\"id\":\"vibey\"}]").unwrap();
        assert_eq!(registered_in(&dir), Some(true));
        let _ = std::fs::remove_dir_all(&dir);
        assert_eq!(registered_in(&dir), None);
    }
}
