use super::*;

#[derive(Debug, Default, Serialize, Deserialize)]
pub(super) struct ImportState {
    #[serde(default)]
    pub(super) auto: bool,
    /// Schon angebotene/übernommene Schlüssel – Auto-Import nimmt nur neue
    #[serde(default)]
    pub(super) seen: Vec<String>,
}

pub(super) fn state_path(st: &AppState) -> PathBuf {
    st.paths.root.join("skin-import.json")
}

pub(super) fn load_state(st: &AppState) -> ImportState {
    std::fs::read(state_path(st)).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default()
}

pub(super) fn save_state(st: &AppState, s: &ImportState) -> AppResult<()> {
    crate::util::write_json_atomic(&state_path(st), s)
}

pub fn set_auto(st: &AppState, on: bool) -> AppResult<()> {
    let mut s = load_state(st);
    s.auto = on;
    save_state(st, &s)
}
