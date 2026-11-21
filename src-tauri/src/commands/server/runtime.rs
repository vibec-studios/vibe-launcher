use super::*;

#[tauri::command]
pub async fn server_install(state: State<'_, AppState>, id: String, force: Option<bool>) -> AppResult<String> {
    server::ops::install(&state, &id, force.unwrap_or(false))
}

#[tauri::command]
pub async fn server_accept_eula(state: State<'_, AppState>, id: String) -> AppResult<Server> {
    server::ops::accept_eula(&state, &id, "Vibe Launcher")
}

#[tauri::command]
pub async fn server_start(state: State<'_, AppState>, id: String) -> AppResult<()> {
    server::run::start(&state, &id)
}

#[tauri::command]
pub async fn server_stop(state: State<'_, AppState>, id: String) -> AppResult<()> {
    state.server_mgr.stop(&id)
}

#[tauri::command]
pub async fn server_restart(state: State<'_, AppState>, id: String) -> AppResult<()> {
    state.server_mgr.restart(&state, &id)
}

#[tauri::command]
pub async fn server_kill(state: State<'_, AppState>, id: String) -> AppResult<()> {
    state.server_mgr.kill(&id)
}

#[tauri::command]
pub async fn server_command(state: State<'_, AppState>, id: String, command: String) -> AppResult<()> {
    state.server_mgr.command(&id, &command)
}

#[tauri::command]
pub async fn server_statuses(state: State<'_, AppState>) -> AppResult<Vec<ServerStatus>> {
    Ok(state.server_mgr.statuses())
}

#[tauri::command]
pub async fn server_log(state: State<'_, AppState>, id: String) -> AppResult<Vec<LogLine>> {
    Ok(state.server_mgr.log(&id))
}

#[tauri::command]
pub async fn server_addresses(state: State<'_, AppState>, id: String) -> AppResult<ServerAddresses> {
    server::ops::addresses(&state, &id)
}

#[tauri::command]
pub async fn server_properties_get(state: State<'_, AppState>, id: String) -> AppResult<Vec<(String, String)>> {
    server::ops::properties(&state, &id)
}

#[tauri::command]
pub async fn server_properties_set(state: State<'_, AppState>, id: String, values: HashMap<String, String>) -> AppResult<Vec<(String, String)>> {
    server::ops::set_properties(&state, &id, values)
}

#[tauri::command]
pub async fn server_properties_raw(state: State<'_, AppState>, id: String) -> AppResult<String> {
    server::ops::properties_raw(&state, &id)
}

#[tauri::command]
pub async fn server_properties_raw_set(state: State<'_, AppState>, id: String, text: String) -> AppResult<()> {
    server::ops::set_properties_raw(&state, &id, &text)
}

#[tauri::command]
pub async fn server_players(state: State<'_, AppState>, id: String) -> AppResult<ServerPlayers> {
    state.servers.get(&id)?;
    Ok(server::players::read_all(&state, &id))
}

#[tauri::command]
pub async fn server_player_action(
    state: State<'_, AppState>,
    id: String,
    list: ListKind,
    action: String,
    name: String,
    reason: Option<String>,
) -> AppResult<ServerPlayers> {
    state.servers.get(&id)?;
    server::players::action(&state, &id, list, action == "add", &name, reason).await
}

#[tauri::command]
pub async fn server_set_whitelist(state: State<'_, AppState>, id: String, enabled: bool) -> AppResult<ServerPlayers> {
    state.servers.get(&id)?;
    server::players::set_whitelist(&state, &id, enabled).await
}

#[tauri::command]
pub async fn server_worlds(state: State<'_, AppState>, id: String) -> AppResult<Vec<ServerWorld>> {
    state.servers.get(&id)?;
    let st = state.inner().clone();
    Ok(tokio::task::spawn_blocking(move || server::backup::worlds(&st, &id)).await?)
}

#[tauri::command]
pub async fn server_backups(state: State<'_, AppState>, id: String) -> AppResult<Vec<ServerBackup>> {
    state.servers.get(&id)?;
    Ok(server::backup::list(&state, &id))
}

#[tauri::command]
pub async fn server_backup_create(state: State<'_, AppState>, id: String, world: Option<String>) -> AppResult<String> {
    server::ops::backup_create(&state, &id, world)
}

#[tauri::command]
pub async fn server_backup_delete(state: State<'_, AppState>, id: String, name: String) -> AppResult<()> {
    state.servers.get(&id)?;
    server::backup::delete(&state, &id, &name)
}

#[tauri::command]
pub async fn server_backup_restore(state: State<'_, AppState>, id: String, name: String) -> AppResult<String> {
    server::ops::backup_restore(&state, &id, &name)
}

#[tauri::command]
pub async fn server_open_folder(state: State<'_, AppState>, id: String, sub: Option<String>) -> AppResult<()> {
    state.servers.get(&id)?;
    let base = server_dir(&state.paths, &id);
    let dir = match sub.as_deref() {
        Some(s) if !s.is_empty() => crate::util::safe_join(&base, s).ok_or_else(|| AppError::Invalid("Pfad".into()))?,
        _ => base,
    };
    std::fs::create_dir_all(&dir)?;
    crate::util::open_in_explorer(&dir)
}

#[tauri::command]
pub async fn server_tunnel_reset(state: State<'_, AppState>, id: String) -> AppResult<()> {
    server::ops::tunnel_reset(&state, &id)
}

/// Antwort auf `servers://close-requested`.
#[tauri::command]
pub async fn servers_quit(state: State<'_, AppState>, stop: bool) -> AppResult<()> {
    state.server_mgr.set_quitting();
    if stop {
        state.server_mgr.stop_all().await;
    }
    state.app.exit(0);
    Ok(())
}
