use crate::content::datapacks;
use crate::error::AppResult;
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
    let dir = state.paths.game_dir(&instance_id);
    tokio::task::spawn_blocking(move || datapacks::copy_to_worlds(&dir, &files, &worlds)).await?
}
