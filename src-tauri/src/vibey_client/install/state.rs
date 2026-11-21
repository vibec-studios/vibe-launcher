use super::*;

/// Zustand je Instanz (`vibey-client.json`).
#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
#[serde(default)]
pub struct InstanceState {
    pub enabled: bool,
    pub version: Option<String>,
    pub channel: Option<String>,
    /// Dateiname in `mods/` (ohne `.disabled`)
    pub file: Option<String>,
    pub sha256: Option<String>,
    /// Für welche Instanz-Version installiert (Wechsel der MC-Version/des Loaders erkennen)
    pub mc_version: Option<String>,
    pub loader: Option<String>,
    pub installed_at: Option<i64>,
    /// Vom Launcher mitinstallierte Abhängigkeiten (Modrinth-IDs)
    pub requires: Vec<String>,
}

pub(super) fn state_path(state: &AppState, id: &str) -> PathBuf {
    state.paths.instance_dir(id).join("vibey-client.json")
}

pub fn load(state: &AppState, id: &str) -> InstanceState {
    std::fs::read(state_path(state, id)).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default()
}

pub(super) fn save(state: &AppState, id: &str, s: &InstanceState) -> AppResult<()> {
    if !state.paths.instance_dir(id).exists() {
        return Ok(());
    }
    crate::util::write_json_atomic(&state_path(state, id), s)
}

/// Loader-Name im Manifest (nur Fabric und NeoForge werden unterstützt).
pub fn loader_name(kind: LoaderKind) -> Option<&'static str> {
    match kind {
        LoaderKind::Fabric => Some("fabric"),
        LoaderKind::Neoforge => Some("neoforge"),
        _ => None,
    }
}

pub(super) fn mods_dir(state: &AppState, id: &str) -> PathBuf {
    state.paths.game_dir(id).join("mods")
}

/// Pfad der verwalteten Datei, falls vorhanden: (Pfad, aktiv?)
pub(super) fn managed_file(state: &AppState, id: &str, s: &InstanceState) -> Option<(PathBuf, bool)> {
    let f = s.file.as_ref()?;
    let p = mods_dir(state, id).join(f);
    if p.is_file() {
        return Some((p, true));
    }
    let d = mods_dir(state, id).join(format!("{f}.disabled"));
    d.is_file().then_some((d, false))
}
