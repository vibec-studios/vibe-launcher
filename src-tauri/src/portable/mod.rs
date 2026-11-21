pub mod copy;

use crate::error::AppResult;
use crate::paths::portable as marker;
use crate::state::AppState;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

pub const CONFIG_FILE: &str = "portable.json";
pub const RELEASES_URL: &str = "https://github.com/vibec-studios/vibe-launcher/releases/latest";

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(default)]
pub struct Config {
    pub id: String,
    pub forget_on_exit: bool,
}

fn valid_id(id: &str) -> bool {
    (8..=32).contains(&id.len()) && id.bytes().all(|b| b.is_ascii_alphanumeric())
}

pub fn config_file(root: &Path) -> PathBuf {
    root.join(CONFIG_FILE)
}

pub fn load(root: &Path) -> Config {
    let mut c: Config = std::fs::read(config_file(root)).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default();
    if !valid_id(&c.id) {
        c.id = uuid::Uuid::new_v4().simple().to_string()[..16].to_string();
        if let Err(e) = save(root, &c) {
            tracing::warn!("portable.json nicht schreibbar: {e}");
        }
    }
    c
}

pub fn save(root: &Path, c: &Config) -> AppResult<()> {
    crate::util::write_json_atomic(&config_file(root), c)
}

pub fn service_name(root: &Path) -> String {
    static ID: OnceLock<String> = OnceLock::new();
    format!("VibeLauncher-portable-{}", ID.get_or_init(|| load(root).id))
}

pub fn webview_dir(root: &Path) -> PathBuf {
    root.join("webview")
}

pub fn prepare_process() {
    if !marker::active() || std::env::var_os("WEBVIEW2_USER_DATA_FOLDER").is_some() {
        return;
    }
    if let Some(root) = marker::root() {
        let dir = webview_dir(&root);
        let _ = std::fs::create_dir_all(&dir);
        std::env::set_var("WEBVIEW2_USER_DATA_FOLDER", dir);
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct Status {
    pub active: bool,
    pub root: String,
    pub exe_dir: Option<String>,
    pub marker: &'static str,
    pub data_dir: &'static str,
    pub forget_on_exit: bool,
    pub releases_url: &'static str,
}

pub fn status(state: &AppState) -> Status {
    let active = marker::active();
    Status {
        active,
        root: state.paths.root.to_string_lossy().to_string(),
        exe_dir: marker::exe_dir().map(|p| p.to_string_lossy().to_string()),
        marker: marker::MARKER,
        data_dir: marker::DATA_DIR,
        forget_on_exit: active && load(&state.paths.root).forget_on_exit,
        releases_url: RELEASES_URL,
    }
}

pub fn set_forget_on_exit(state: &AppState, on: bool) -> AppResult<Status> {
    if !marker::active() {
        return Err(crate::error::AppError::Invalid("Diese Einstellung gibt es nur im portablen Modus.".into()));
    }
    let mut c = load(&state.paths.root);
    c.forget_on_exit = on;
    save(&state.paths.root, &c)?;
    Ok(status(state))
}

pub fn forget_here(state: &AppState) -> usize {
    let ids = state.auth.forget_local_secrets();
    for id in &ids {
        crate::vibe::forget_tokens(state, id);
    }
    tracing::info!("Zugangsdaten von {} Konto/Konten aus dem Schlüsselbund dieses PCs entfernt", ids.len());
    ids.len()
}

pub fn on_exit(state: &AppState) {
    if marker::active() && load(&state.paths.root).forget_on_exit {
        forget_here(state);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::util::testdir::TestDir;

    #[test]
    fn id_is_created_once_and_kept() {
        let d = TestDir::new("portable-cfg");
        let a = load(d.path());
        assert!(valid_id(&a.id));
        assert_eq!(load(d.path()).id, a.id);
    }

    #[test]
    fn broken_config_gets_new_id_and_keeps_defaults() {
        let d = TestDir::new("portable-cfg");
        std::fs::write(config_file(d.path()), "{\"id\":\"../x\",\"forget_on_exit\":true}").unwrap();
        let c = load(d.path());
        assert!(valid_id(&c.id));
        assert!(c.forget_on_exit);
    }
}
