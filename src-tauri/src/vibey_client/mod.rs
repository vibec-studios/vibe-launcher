//! Vibey Client (Fabric/NeoForge-Client-Mod mit Cosmetics und Emotes) im Launcher.
//!
//! - **Verteilung** (`docs/VIBE-API-2.md` §2): `GET /api/v1/client/latest?channel=release|beta` liefert Jars je
//!   Loader + unterstützte Minecraft-Versionen, Pflicht-Abhängigkeiten (Modrinth) und das Blockbench-Plugin.
//! - **Pro Instanz** (`install.rs`): Schalter „Vibey Client“ legt das passende Jar (SHA-256 geprüft) als vom
//!   Launcher verwaltete Datei in `mods/`, installiert `requires` mit, aktualisiert vor jedem Spielstart still
//!   und entfernt es beim Ausschalten. Zustand: `instances/<id>/vibey-client.json`.
//! - **Cosmetics** (`cosmetics.rs`): `.vibey`-Assets und Vorschaubilder mit Platten-Cache, Einreichungen
//!   (Multipart-Upload).
//! - **Creator-Tools** (`blockbench.rs`): Blockbench finden, Plugin laden/aktualisieren.
//!
//! Alles Netzwerk respektiert den Vibe-Hauptschalter (`vibe::ensure`) und geht an die Backend-Adresse; nur das
//! Blockbench-Plugin kommt aus eigenen GitHub-Releases (`blockbench.rs`).
pub mod blockbench;
pub mod commands;
pub mod cosmetics;
pub mod install;

use crate::error::{AppError, AppResult};
use crate::state::AppState;
use crate::vibe::{self, Feature};
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use std::time::{Duration, Instant};

pub use install::before_launch;

/// Daten des Vibey-Clients im Launcher-Ordner (`<data>/vibey/`).
pub fn data_dir(state: &AppState) -> PathBuf {
    state.paths.root.join("vibey")
}

// ------------------------------------------------------------------ Release-Manifest

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Requirement {
    #[serde(default)]
    pub modrinth: Option<String>,
    #[serde(default)]
    pub name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ClientFile {
    pub loader: String,
    #[serde(default)]
    pub mc_versions: Vec<String>,
    pub file: String,
    #[serde(default)]
    pub size: u64,
    pub sha256: String,
    pub url: String,
    #[serde(default)]
    pub requires: Vec<Requirement>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BlockbenchFile {
    pub version: String,
    pub file: String,
    #[serde(default)]
    pub size: u64,
    pub sha256: String,
    pub url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ClientRelease {
    pub version: String,
    #[serde(default)]
    pub channel: String,
    #[serde(default)]
    pub published_at: Option<String>,
    #[serde(default)]
    pub changelog: Option<String>,
    #[serde(default)]
    pub files: Vec<ClientFile>,
    #[serde(default)]
    pub blockbench: Option<BlockbenchFile>,
}

impl ClientRelease {
    /// Jar für Loader + Minecraft-Version (exakter Versions-String wie im Manifest).
    pub fn file_for(&self, loader: &str, mc: &str) -> Option<&ClientFile> {
        self.files.iter().find(|f| f.loader.eq_ignore_ascii_case(loader) && f.mc_versions.iter().any(|v| v == mc))
    }

    /// Alle unterstützten Minecraft-Versionen eines Loaders.
    pub fn mc_versions(&self, loader: &str) -> Vec<String> {
        let mut v: Vec<String> = self.files.iter().filter(|f| f.loader.eq_ignore_ascii_case(loader)).flat_map(|f| f.mc_versions.iter().cloned()).collect();
        v.sort_by(|a, b| install::cmp_versions(a, b));
        v.dedup();
        v
    }
}

/// Kanal des Vibey-Clients passend zum Update-Kanal des Launchers (Dev-Builds -> beta).
pub fn channel(state: &AppState) -> &'static str {
    channel_for(&state.settings().update_channel)
}

pub fn channel_for(update_channel: &str) -> &'static str {
    if update_channel == "dev" {
        "beta"
    } else {
        "release"
    }
}

fn latest_cache() -> &'static Mutex<HashMap<String, (Instant, ClientRelease)>> {
    static C: OnceLock<Mutex<HashMap<String, (Instant, ClientRelease)>>> = OnceLock::new();
    C.get_or_init(Default::default)
}

const LATEST_TTL: Duration = Duration::from_secs(10 * 60);

/// Neuestes Release des aktuellen Kanals (10 min im Speicher, `force` fragt neu).
pub async fn latest(state: &AppState, force: bool) -> AppResult<ClientRelease> {
    let base = vibe::ensure(state, Feature::Any)?;
    let ch = channel(state);
    let key = format!("{base}|{ch}");
    if !force {
        if let Some((at, r)) = latest_cache().lock().get(&key) {
            if at.elapsed() < LATEST_TTL {
                return Ok(r.clone());
            }
        }
    }
    let url = format!("{base}/api/v1/client/latest?channel={ch}");
    let r = state.net.client.get(&url).header("accept", "application/json").timeout(Duration::from_secs(20)).send().await?;
    let status = r.status().as_u16();
    let body = r.text().await?;
    if status == 404 {
        return Err(AppError::NotFound("Für diesen Kanal gibt es noch keinen Vibey Client.".into()));
    }
    if !(200..300).contains(&status) {
        return Err(vibe::api_error(status, &body));
    }
    let rel: ClientRelease = serde_json::from_str(&body).map_err(|e| AppError::msg(format!("Antwort des Vibe-Servers ist ungültig: {e}")))?;
    latest_cache().lock().insert(key, (Instant::now(), rel.clone()));
    Ok(rel)
}

/// Download-URL aus dem Manifest auflösen (relativ oder absolut) – nur Adressen des Backends.
pub fn resolve_url(base: &str, url: &str) -> AppResult<String> {
    let abs = if url.starts_with('/') { format!("{base}{url}") } else { url.to_string() };
    vibe::check_api_url(base, &abs).map(|u| u.to_string())
}

/// Dateiname aus dem Manifest: nur ein Name, keine Pfade.
pub fn safe_file_name(name: &str, ext: &str) -> AppResult<String> {
    let ok = !name.is_empty()
        && name.len() <= 128
        && name.ends_with(ext)
        && !name.starts_with('.')
        && name.bytes().all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'-' | b'_' | b'+'));
    if !ok {
        return Err(AppError::Invalid(format!("Ungültiger Dateiname im Manifest: {name}")));
    }
    Ok(name.to_string())
}

pub fn valid_sha256(s: &str) -> bool {
    s.len() == 64 && s.bytes().all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
}

pub fn sha256_bytes(b: &[u8]) -> String {
    use sha2::{Digest, Sha256};
    let mut h = Sha256::new();
    h.update(b);
    hex(&h.finalize())
}

fn hex(b: &[u8]) -> String {
    b.iter().map(|x| format!("{x:02x}")).collect()
}

/// Lädt eine Datei des Backends nach `dest` (über eine temporäre Datei) und prüft Größe + SHA-256.
pub async fn download_verified(state: &AppState, url: &str, dest: &Path, sha256: &str, size: Option<u64>) -> AppResult<()> {
    if !valid_sha256(sha256) {
        return Err(AppError::Invalid("Ungültige Prüfsumme im Manifest".into()));
    }
    let r = state.net.client.get(url).timeout(Duration::from_secs(300)).send().await?;
    let status = r.status().as_u16();
    if !(200..300).contains(&status) {
        let body = r.text().await.unwrap_or_default();
        return Err(vibe::api_error(status, &body));
    }
    let bytes = r.bytes().await?;
    if let Some(s) = size.filter(|s| *s > 0) {
        if bytes.len() as u64 != s {
            return Err(AppError::msg(format!("Download unvollständig ({} von {s} Bytes)", bytes.len())));
        }
    }
    let got = sha256_bytes(&bytes);
    if got != sha256 {
        return Err(AppError::msg("Prüfsumme stimmt nicht – Download verworfen".to_string()));
    }
    if let Some(p) = dest.parent() {
        tokio::fs::create_dir_all(p).await?;
    }
    let tmp = dest.with_file_name(format!(".{}.part", dest.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default()));
    tokio::fs::write(&tmp, &bytes).await?;
    if let Err(e) = tokio::fs::rename(&tmp, dest).await {
        let _ = tokio::fs::remove_file(&tmp).await;
        return Err(e.into());
    }
    Ok(())
}

/// Datei/Ordner im Dateimanager zeigen (Datei markiert).
pub fn reveal(path: &Path) -> AppResult<()> {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        std::process::Command::new("explorer").raw_arg(format!("/select,\"{}\"", path.display())).spawn()?;
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open").arg("-R").arg(path).spawn()?;
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        let dir = if path.is_dir() { path.to_path_buf() } else { path.parent().map(Path::to_path_buf).unwrap_or_default() };
        std::process::Command::new("xdg-open").arg(dir).spawn()?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rel() -> ClientRelease {
        serde_json::from_value(serde_json::json!({
            "version": "0.2.0", "channel": "release", "publishedAt": "2026-11-18T10:00:00Z", "changelog": "x",
            "files": [
                { "loader": "fabric", "mcVersions": ["1.21.1", "1.21.4"], "file": "vibeyclient-fabric-1.21.1-0.2.0.jar", "size": 3,
                  "sha256": "a".repeat(64), "url": "https://vibe.axolite.app/api/v1/client/files/x/y.jar",
                  "requires": [{ "modrinth": "P7dR8mSH", "name": "Fabric API" }] },
                { "loader": "neoforge", "mcVersions": ["1.21.1"], "file": "vibeyclient-neoforge-1.21.1-0.2.0.jar", "size": 3,
                  "sha256": "b".repeat(64), "url": "/api/v1/client/files/x/z.jar" }
            ],
            "blockbench": { "version": "0.2.0", "file": "vibey.js", "size": 1, "sha256": "c".repeat(64), "url": "/api/v1/client/files/c/vibey.js" }
        }))
        .unwrap()
    }

    #[test]
    fn picks_file() {
        let r = rel();
        assert_eq!(r.file_for("fabric", "1.21.4").unwrap().file, "vibeyclient-fabric-1.21.1-0.2.0.jar");
        assert_eq!(r.file_for("Fabric", "1.21.1").unwrap().requires[0].modrinth.as_deref(), Some("P7dR8mSH"));
        assert!(r.file_for("fabric", "1.20.1").is_none());
        assert!(r.file_for("forge", "1.21.1").is_none());
        assert_eq!(r.file_for("neoforge", "1.21.1").unwrap().requires.len(), 0);
        assert_eq!(r.mc_versions("fabric"), vec!["1.21.1", "1.21.4"]);
        let mut r2 = r.clone();
        r2.files[0].mc_versions = vec!["1.21.10".into(), "1.21.4".into(), "26.1".into(), "1.21.1".into()];
        assert_eq!(r2.mc_versions("fabric"), vec!["1.21.1", "1.21.4", "1.21.10", "26.1"]);
    }

    #[test]
    fn channels() {
        assert_eq!(channel_for("dev"), "beta");
        assert_eq!(channel_for("release"), "release");
        assert_eq!(channel_for("irgendwas"), "release");
    }

    #[test]
    fn urls() {
        let base = "https://vibe.axolite.app";
        assert_eq!(resolve_url(base, "/api/v1/client/files/a/b.jar").unwrap(), "https://vibe.axolite.app/api/v1/client/files/a/b.jar");
        assert!(resolve_url(base, "https://vibe.axolite.app/api/v1/client/files/a/b.jar").is_ok());
        // Manifeste mit der alten Adresse laden weiter (gleiches Backend)
        assert!(resolve_url(base, "https://vibe.henny.dev/api/v1/client/files/a/b.jar").is_ok());
        assert!(resolve_url(base, "https://evil.example/api/v1/client/files/a/b.jar").is_err());
        assert!(resolve_url(base, "/admin/x").is_err());
    }

    #[test]
    fn names() {
        assert!(safe_file_name("vibeyclient-fabric-1.21.1-0.2.0.jar", ".jar").is_ok());
        assert!(safe_file_name("vibey.js", ".js").is_ok());
        assert!(safe_file_name("../evil.jar", ".jar").is_err());
        assert!(safe_file_name("a/b.jar", ".jar").is_err());
        assert!(safe_file_name("x.exe", ".jar").is_err());
        assert!(safe_file_name(".jar", ".jar").is_err());
    }

    #[test]
    fn sha() {
        assert_eq!(sha256_bytes(b"abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
        assert!(valid_sha256(&"a".repeat(64)));
        assert!(!valid_sha256(&"A".repeat(64)));
        assert!(!valid_sha256("abc"));
    }
}
