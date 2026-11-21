use crate::content::datapacks;
use crate::error::{AppError, AppResult};
use crate::state::AppState;
use tauri::State;

#[tauri::command]
pub async fn datapacks_overview(state: State<'_, AppState>, instance_id: String) -> AppResult<datapacks::Overview> {
    state.instances.get(&instance_id)?;
    let dir = state.paths.game_dir(&instance_id);
    Ok(tokio::task::spawn_blocking(move || datapacks::overview(&dir)).await?)
}

#[tauri::command]
pub async fn datapacks_copy_to_worlds(state: State<'_, AppState>, instance_id: String, files: Vec<String>, worlds: Vec<String>) -> AppResult<usize> {
    state.instances.get(&instance_id)?;
    let lock = state.content.lock(&instance_id);
    let _guard = lock.lock().await;
    let dir = state.paths.game_dir(&instance_id);
    let result = tokio::task::spawn_blocking(move || datapacks::copy_to_worlds(&dir, &files, &worlds)).await?;
    state.content.emit_changed(&instance_id);
    result
}

#[tauri::command]
pub async fn world_datapacks_list(state: State<'_, AppState>, instance_id: String, world: String) -> AppResult<datapacks::WorldPacks> {
    state.instances.get(&instance_id)?;
    let dir = state.paths.game_dir(&instance_id);
    tokio::task::spawn_blocking(move || datapacks::list_world(&dir, &world)).await?
}

async fn change_world(
    state: &AppState,
    instance_id: &str,
    action: impl FnOnce(&std::path::Path) -> AppResult<()> + Send + 'static,
) -> AppResult<()> {
    state.instances.get(instance_id)?;
    let lock = state.content.lock(instance_id);
    let _guard = lock.lock().await;
    if state.game.is_running(instance_id) {
        return Err(AppError::Invalid("Bitte beende zuerst Minecraft".into()));
    }
    let dir = state.paths.game_dir(instance_id);
    tokio::task::spawn_blocking(move || action(&dir)).await??;
    state.content.emit_changed(instance_id);
    Ok(())
}

#[tauri::command]
pub async fn world_datapacks_add(state: State<'_, AppState>, instance_id: String, world: String, path: String) -> AppResult<()> {
    change_world(&state, &instance_id, move |dir| datapacks::add_world_zip(dir, &world, std::path::Path::new(&path))).await
}

#[tauri::command]
pub async fn world_datapacks_remove(state: State<'_, AppState>, instance_id: String, world: String, file: String) -> AppResult<()> {
    change_world(&state, &instance_id, move |dir| datapacks::remove_world_pack(dir, &world, &file)).await
}
