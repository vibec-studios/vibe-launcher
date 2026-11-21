use super::*;

/// Einstellungen einer Instanz speichern. Neu gewählte Ordner-/Server-Bereiche werden gleich abgeglichen, wenn die
/// Instanz nicht läuft (sonst nach dem Beenden).
#[tauri::command]
pub async fn optsync_set_instance(
    state: State<'_, AppState>,
    instance_id: String,
    enabled: bool,
    categories: Vec<String>,
) -> AppResult<OptSyncInfo> {
    let inst = state.instances.get(&instance_id)?;
    check_categories(&categories)?;
    let root = state.paths.root.clone();
    let game = state.paths.game_dir(&instance_id);
    let state = state.inner().clone();
    tokio::task::spawn_blocking(move || -> AppResult<OptSyncInfo> {
        let added = optsync::set_instance(&root, &instance_id, enabled, categories)?;
        if !added.is_empty() {
            if let Ok(_guard) = state.content.launch_gate(&instance_id).try_lock_owned() {
                if !state.game.is_running(&instance_id) {
                    optsync::sync_now(&root, &game, &instance_id, &inst.name, &inst.mc_version);
                }
            }
        }
        Ok(optsync_info(&root))
    })
    .await
    .map_err(join_err)?
}

/// Master-Profil aus einer Instanz übernehmen (ersetzt die Werte der gewählten Bereiche).
#[tauri::command]
pub async fn optsync_capture(
    state: State<'_, AppState>,
    instance_id: String,
    categories: Vec<String>,
) -> AppResult<OptSyncInfo> {
    let inst = state.instances.get(&instance_id)?;
    check_categories(&categories)?;
    let guard = state.content.launch_gate(&instance_id).try_lock_owned()
        .map_err(|_| AppError::Invalid("Diese Instanz wird gerade geändert.".into()))?;
    if state.game.is_running(&instance_id) {
        return Err(AppError::Invalid("Beende zuerst alle Spielsitzungen dieser Instanz.".into()));
    }
    let root = state.paths.root.clone();
    let game = state.paths.game_dir(&instance_id);
    tokio::task::spawn_blocking(move || -> AppResult<OptSyncInfo> {
        let _guard = guard;
        optsync::capture_from(&root, &game, &instance_id, &inst.mc_version, &categories)?;
        Ok(optsync_info(&root))
    })
    .await
    .map_err(join_err)?
}

/// Master-Profil sofort auf alle aktivierten (nicht laufenden) Instanzen anwenden. Gibt die Anzahl zurück.
#[tauri::command]
pub async fn optsync_apply_all(state: State<'_, AppState>) -> AppResult<usize> {
    let cfg = optsync::SyncConfig::load(&optsync::config_path(&state.paths.root));
    let state = state.inner().clone();
    tokio::task::spawn_blocking(move || {
        let mut guards = Vec::new();
        let mut targets = Vec::new();
        for (id, sync) in cfg.instances {
            if !sync.enabled {
                continue;
            }
            let Ok(inst) = state.instances.get(&id) else { continue };
            let Ok(guard) = state.content.launch_gate(&id).try_lock_owned() else { continue };
            if !state.game.is_running(&id) {
                guards.push(guard);
                targets.push((id.clone(), state.paths.game_dir(&id), inst.mc_version));
            }
        }
        optsync::apply_all(&state.paths.root, &targets)
    }).await.map_err(join_err)?
}

#[derive(Serialize)]
pub struct SyncAllResult {
    pub instances: usize,
    pub changes: usize,
    pub conflicts: usize,
    pub errors: Vec<String>,
    /// Übersprungen, weil sie gerade laufen (Namen)
    pub running: Vec<String>,
}

/// Ordner, Server-Liste und Screenshots jetzt abgleichen – eine Instanz (`instance_id`) oder alle synchronisierten,
/// die nicht laufen. Bei allen zwei Durchgänge, damit jede Instanz auch die Änderungen der anderen bekommt.
#[tauri::command]
pub async fn optsync_sync_now(state: State<'_, AppState>, instance_id: Option<String>) -> AppResult<SyncAllResult> {
    let cfg = optsync::SyncConfig::load(&optsync::config_path(&state.paths.root));
    let ids: Vec<String> = match &instance_id {
        Some(id) => {
            state.instances.get(id)?;
            if state.game.is_running(id) {
                return Err(AppError::Invalid("Die Instanz läuft gerade – abgeglichen wird nach dem Beenden.".into()));
            }
            vec![id.clone()]
        }
        None => cfg.instances.iter().filter(|(_, s)| s.enabled).map(|(id, _)| id.clone()).collect(),
    };
    let mut running = vec![];
    let mut targets = vec![];
    let mut guards = Vec::new();
    for id in ids {
        let Ok(inst) = state.instances.get(&id) else { continue };
        let guard = state.content.launch_gate(&id).try_lock_owned();
        if state.game.is_running(&id) || guard.is_err() {
            running.push(inst.name);
        } else {
            guards.extend(guard.ok());
            targets.push((id.clone(), state.paths.game_dir(&id), inst.name, inst.mc_version));
        }
    }
    let root = state.paths.root.clone();
    let passes = if instance_id.is_some() { 1 } else { 2 };
    tokio::task::spawn_blocking(move || {
        let _guards = guards;
        let mut r = SyncAllResult { instances: targets.len(), changes: 0, conflicts: 0, errors: vec![], running };
        for pass in 0..passes {
            for (id, game, name, mc) in &targets {
                let s = optsync::sync_now(&root, game, id, name, mc);
                r.changes += s.changes + s.screenshots;
                r.conflicts += s.conflicts.len();
                if pass + 1 == passes {
                    r.errors.extend(s.errors.into_iter().map(|e| format!("{name}: {e}")));
                }
            }
        }
        r
    })
    .await
    .map_err(join_err)
}

/// Gemeinsamen Ordner im Explorer öffnen (resourcepacks | shaderpacks | screenshots).
#[tauri::command]
pub async fn optsync_open_folder(state: State<'_, AppState>, area: String) -> AppResult<()> {
    if !["resourcepacks", "shaderpacks", "screenshots"].contains(&area.as_str()) {
        return Err(AppError::Invalid("Unbekannter Bereich".into()));
    }
    let dir = optsync::shared_dir(&state.paths.root, &area);
    std::fs::create_dir_all(&dir)?;
    crate::util::open_in_explorer(&dir)
}

/// Konfliktmeldungen einer Instanz ausblenden.
#[tauri::command]
pub async fn optsync_clear_conflicts(state: State<'_, AppState>, instance_id: String) -> AppResult<OptSyncInfo> {
    let root = state.paths.root.clone();
    tokio::task::spawn_blocking(move || -> AppResult<OptSyncInfo> {
        optsync::clear_conflicts(&root, &instance_id)?;
        Ok(optsync_info(&root))
    })
    .await
    .map_err(join_err)?
}
