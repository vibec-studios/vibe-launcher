use crate::content::organize::view::{self, Organize, RemovalExtra};
use crate::content::organize::{edit, Target};
use crate::error::AppResult;
use crate::state::AppState;
use tauri::State;

#[tauri::command]
pub async fn content_organize(state: State<'_, AppState>, instance_id: String) -> AppResult<Organize> {
    view::get(&state, &instance_id).await
}

#[tauri::command]
pub async fn content_group_save(
    state: State<'_, AppState>,
    instance_id: String,
    group_id: Option<String>,
    name: String,
    color: Option<String>,
    targets: Option<Vec<Target>>,
) -> AppResult<Organize> {
    edit::group_save(&state, &instance_id, group_id, name, color, targets.unwrap_or_default()).await
}

#[tauri::command]
pub async fn content_group_delete(state: State<'_, AppState>, instance_id: String, group_id: String) -> AppResult<Organize> {
    edit::group_delete(&state, &instance_id, group_id).await
}

#[tauri::command]
pub async fn content_group_assign(state: State<'_, AppState>, instance_id: String, targets: Vec<Target>, group_id: Option<String>) -> AppResult<Organize> {
    edit::group_assign(&state, &instance_id, targets, group_id).await
}

#[tauri::command]
pub async fn content_tags_edit(state: State<'_, AppState>, instance_id: String, targets: Vec<Target>, add: Vec<String>, remove: Vec<String>) -> AppResult<Organize> {
    edit::tags(&state, &instance_id, targets, add, remove).await
}

#[tauri::command]
pub async fn content_deps_keep(state: State<'_, AppState>, instance_id: String, targets: Vec<Target>) -> AppResult<Organize> {
    edit::keep(&state, &instance_id, targets).await
}

#[tauri::command]
pub async fn content_removal_extras(state: State<'_, AppState>, instance_id: String, targets: Vec<Target>) -> AppResult<Vec<RemovalExtra>> {
    edit::removal_extras(&state, &instance_id, targets).await
}
