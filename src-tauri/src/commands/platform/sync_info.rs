use super::*;

#[derive(Serialize)]
pub struct SharedFolder {
    /// resourcepacks | shaderpacks | screenshots | servers
    pub area: String,
    pub count: usize,
    pub size: u64,
}

#[derive(Serialize)]
pub struct InstanceSyncState {
    pub last_sync: Option<i64>,
    pub conflicts: Vec<optsync::ConflictNote>,
    pub errors: Vec<String>,
}

#[derive(Serialize)]
pub struct OptSyncInfo {
    pub config: optsync::SyncConfig,
    /// Bereiche aus options.txt
    pub categories: Vec<String>,
    /// Weitere Bereiche (Ordner, Server-Liste)
    pub areas: Vec<String>,
    /// Anzahl Master-Schlüssel je Kategorie
    pub counts: std::collections::BTreeMap<String, usize>,
    pub shared: Vec<SharedFolder>,
    /// Abgleichstand je Instanz (nur synchronisierte)
    pub states: std::collections::BTreeMap<String, InstanceSyncState>,
}

pub(super) fn optsync_info(root: &Path) -> OptSyncInfo {
    let config = optsync::SyncConfig::load(&optsync::config_path(root));
    let mut counts = std::collections::BTreeMap::new();
    for k in config.master.keys() {
        if let Some(c) = optsync::category_of(k) {
            *counts.entry(c.to_string()).or_insert(0) += 1;
        }
    }
    if !config.legacy_keybinds.is_empty() {
        *counts.entry("keybinds".into()).or_insert(0) += config.legacy_keybinds.len();
    }
    if let Some(p) = &config.resource_packs {
        counts.insert("resourcepacks".into(), p.iter().filter(|x| x.starts_with("file/")).count());
    }
    let mut shared: Vec<SharedFolder> = ["resourcepacks", "shaderpacks", "screenshots"]
        .iter()
        .map(|a| {
            let (count, size) = crate::platform::syncdir::summary(&optsync::shared_dir(root, a));
            SharedFolder { area: a.to_string(), count, size }
        })
        .collect();
    shared.push(SharedFolder { area: "servers".into(), count: crate::platform::syncservers::count(&optsync::shared_servers(root)), size: 0 });
    let states = config
        .instances
        .iter()
        .filter(|(_, s)| s.enabled)
        .map(|(id, _)| {
            let st = optsync::InstanceState::load(root, id);
            (id.clone(), InstanceSyncState { last_sync: st.last_sync, conflicts: st.conflicts, errors: st.errors })
        })
        .collect();
    OptSyncInfo {
        config,
        categories: optsync::CATEGORIES.iter().map(|s| s.to_string()).collect(),
        areas: optsync::AREAS.iter().map(|s| s.to_string()).collect(),
        counts,
        shared,
        states,
    }
}

#[tauri::command]
pub async fn optsync_get(state: State<'_, AppState>) -> AppResult<OptSyncInfo> {
    let root = state.paths.root.clone();
    tokio::task::spawn_blocking(move || optsync_info(&root)).await.map_err(join_err)
}

pub(super) fn check_categories(c: &[String]) -> AppResult<()> {
    if c.iter().all(|x| optsync::known_area(x)) {
        Ok(())
    } else {
        Err(AppError::Invalid("Unbekannter Bereich".into()))
    }
}
