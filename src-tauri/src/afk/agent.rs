use crate::error::{AppError, AppResult};
use crate::net::DownloadItem;
use crate::state::AppState;
use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};

const GH_REPO: &str = "vibec-studios/vibey-client";
pub const AGENT_VERSION: &str = "0.1.0";
pub const AGENT_SHA256: &str = "67bf7fa4053c51ea939ac7fe3984a698da73e4bf8bb510dd7c08c9207fedca45";
pub const JAR: &str = "vibe-afk-agent.jar";
pub const DEV_ENV: &str = "VIBE_AFK_AGENT_JAR";

#[derive(Debug, Clone)]
pub struct AgentJar {
    pub path: PathBuf,
    pub version: String,
}

pub fn root(state: &AppState) -> PathBuf {
    state.paths.root.join("afk")
}

fn tools(state: &AppState) -> PathBuf {
    state.paths.root.join("tools").join("afk-agent")
}

pub fn jar_path(tools: &Path, version: &str) -> PathBuf {
    tools.join(version).join(JAR)
}

pub fn release_url(version: &str) -> String {
    format!("https://github.com/{GH_REPO}/releases/download/afk-agent-v{version}/vibe-afk-agent-{version}.jar")
}

pub fn sha256_file(path: &Path) -> Option<String> {
    let data = std::fs::read(path).ok()?;
    Some(hex::encode(Sha256::digest(&data)))
}

pub fn verified(path: &Path, sha: &str) -> bool {
    sha256_file(path).is_some_and(|h| h.eq_ignore_ascii_case(sha))
}

pub fn cached(state: &AppState) -> Option<AgentJar> {
    if let Some(dev) = dev_override() {
        return Some(dev);
    }
    let path = jar_path(&tools(state), AGENT_VERSION);
    verified(&path, AGENT_SHA256).then(|| AgentJar { path, version: AGENT_VERSION.into() })
}

fn dev_override() -> Option<AgentJar> {
    if !cfg!(debug_assertions) {
        return None;
    }
    let p = PathBuf::from(std::env::var_os(DEV_ENV)?);
    p.is_file().then(|| AgentJar { path: p, version: format!("{AGENT_VERSION}-dev") })
}

async fn download(state: &AppState, path: &Path) -> AppResult<()> {
    let _ = std::fs::remove_file(path);
    state.net.download(&DownloadItem::new(release_url(AGENT_VERSION), path.to_path_buf()), None, None).await?;
    if !verified(path, AGENT_SHA256) {
        let _ = std::fs::remove_file(path);
        return Err(AppError::Invalid("AFK-Helfer: Prüfsumme stimmt nicht".into()));
    }
    Ok(())
}

pub async fn ensure(state: &AppState) -> Result<AgentJar, String> {
    if let Some(j) = cached(state) {
        return Ok(j);
    }
    let path = jar_path(&tools(state), AGENT_VERSION);
    download(state, &path).await.map_err(|e| e.to_string())?;
    Ok(AgentJar { path, version: AGENT_VERSION.into() })
}

pub fn agent_arg(jar: &Path, vibe_dir: &Path) -> String {
    format!("-javaagent:{}={}", jar.display(), vibe_dir.display())
}

fn version_parts(mc: &str) -> Option<(u32, u32, u32)> {
    let mut it = mc.trim().split(|c: char| !c.is_ascii_digit()).filter(|s| !s.is_empty()).map(|s| s.parse::<u32>().ok());
    let a = it.next()??;
    let b = it.next().flatten().unwrap_or(0);
    let c = it.next().flatten().unwrap_or(0);
    Some((a, b, c))
}

pub fn modern_lwjgl(mc: &str) -> bool {
    let mc = mc.trim();
    if mc.starts_with(['a', 'b', 'c']) || mc.starts_with("rd-") || mc.starts_with("inf-") {
        return false;
    }
    if let Some((yy, _)) = mc.split_once('w').filter(|(y, _)| y.len() == 2 && y.chars().all(|c| c.is_ascii_digit())) {
        return yy.parse::<u32>().is_ok_and(|y| y >= 18);
    }
    match version_parts(mc) {
        Some((1, minor, _)) => minor >= 13,
        Some((major, ..)) => major >= 2,
        None => false,
    }
}

pub fn game_state_supported(loader: &str, mc: &str) -> bool {
    let Some(v) = version_parts(mc).filter(|_| !mc.contains('w')) else { return modern_lwjgl(mc) };
    if v.0 >= 2 {
        return true;
    }
    match loader {
        "neoforge" => v >= (1, 20, 5),
        "forge" => v >= (1, 20, 6),
        _ => v >= (1, 14, 4),
    }
}

#[derive(Deserialize)]
struct VersionDownloads {
    downloads: Option<std::collections::HashMap<String, Download>>,
}

#[derive(Deserialize)]
struct Download {
    url: String,
    sha1: Option<String>,
    size: Option<u64>,
}

pub async fn mappings(state: &AppState, base_id: &str) -> Option<PathBuf> {
    if base_id.is_empty() || base_id.contains(['/', '\\', ':']) || base_id.contains("..") {
        return None;
    }
    let raw = tokio::fs::read_to_string(state.paths.version_json(base_id)).await.ok()?;
    let v: VersionDownloads = serde_json::from_str(&raw).ok()?;
    let d = v.downloads?.remove("client_mappings")?;
    let path = root(state).join("mappings").join(format!("{base_id}.txt"));
    let item = DownloadItem::new(d.url, path.clone()).sha1(d.sha1).size(d.size);
    if crate::net::Net::is_valid(&item).await {
        return Some(path);
    }
    match state.net.download(&item, None, None).await {
        Ok(()) => Some(path),
        Err(e) => {
            tracing::warn!("AFK: Mappings für {base_id} nicht ladbar: {e}");
            None
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::util::testdir::TestDir;

    #[test]
    fn pinned_release_url_and_hash() {
        assert_eq!(release_url("0.1.0"), "https://github.com/vibec-studios/vibey-client/releases/download/afk-agent-v0.1.0/vibe-afk-agent-0.1.0.jar");
        assert_eq!(AGENT_SHA256.len(), 64);
        assert!(AGENT_SHA256.chars().all(|c| c.is_ascii_hexdigit()));
    }

    #[test]
    fn jar_must_match_pinned_hash() {
        let dir = TestDir::new("afk-agent");
        let p = jar_path(dir.path(), "0.1.0");
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        std::fs::write(&p, b"jar").unwrap();
        let good = sha256_file(&p).unwrap();
        assert!(verified(&p, &good));
        assert!(verified(&p, &good.to_uppercase()));
        std::fs::write(&p, b"evil").unwrap();
        assert!(!verified(&p, &good));
        assert!(!verified(&dir.path().join("missing.jar"), &good));
    }

    #[test]
    fn agent_arg_is_one_element() {
        let a = agent_arg(Path::new("C:/a b/vibe-afk-agent.jar"), Path::new("C:/inst x/.vibe"));
        assert_eq!(a, "-javaagent:C:/a b/vibe-afk-agent.jar=C:/inst x/.vibe");
    }

    #[test]
    fn lwjgl_versions() {
        assert!(modern_lwjgl("1.13"));
        assert!(modern_lwjgl("1.21.4"));
        assert!(!modern_lwjgl("1.12.2"));
        assert!(!modern_lwjgl("1.8.9"));
        assert!(modern_lwjgl("24w14a"));
        assert!(!modern_lwjgl("17w43a"));
        assert!(modern_lwjgl("26.1"));
        assert!(!modern_lwjgl("b1.7.3"));
        assert!(!modern_lwjgl("rd-132211"));
    }

    #[test]
    fn game_state_matrix() {
        assert!(game_state_supported("vanilla", "1.14.4"));
        assert!(!game_state_supported("vanilla", "1.14.3"));
        assert!(game_state_supported("fabric", "1.21.11"));
        assert!(!game_state_supported("neoforge", "1.20.4"));
        assert!(game_state_supported("neoforge", "1.21.1"));
        assert!(!game_state_supported("forge", "1.20.1"));
        assert!(!game_state_supported("forge", "1.16.5"));
        assert!(game_state_supported("forge", "1.20.6"));
        assert!(game_state_supported("forge", "26.1"));
        assert!(!game_state_supported("vanilla", "1.8.9"));
    }
}
