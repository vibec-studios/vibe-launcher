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
use crate::error::{AppError, AppResult};
use crate::state::AppState;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

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
        update_available: false,
        error: None,
    };
    if state.settings().vibe.enabled {
        match super::latest(state, false).await {
            Ok(rel) => {
                if let Some(bb) = rel.blockbench {
                    out.update_available = present && meta.as_ref().is_none_or(|m| m.sha256 != bb.sha256);
                    out.latest_version = Some(bb.version);
                }
            }
            Err(e) => out.error = Some(e.to_string()),
        }
    }
    out
}

/// Neuestes Plugin laden (SHA-256 geprüft) und an den festen Ort legen.
pub async fn install_plugin(state: &AppState) -> AppResult<BlockbenchStatus> {
    let base = crate::vibe::ensure(state, crate::vibe::Feature::Any)?;
    let rel = super::latest(state, true).await?;
    let bb = rel.blockbench.ok_or_else(|| AppError::NotFound("Dieses Release enthält kein Blockbench-Plugin.".into()))?;
    super::safe_file_name(&bb.file, ".js")?;
    let url = super::resolve_url(&base, &bb.url)?;
    // Immer als vibey.js ablegen: Blockbench nimmt den Dateinamen als Plugin-ID
    super::download_verified(state, &url, &plugin_path(state), &bb.sha256, Some(bb.size)).await?;
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
