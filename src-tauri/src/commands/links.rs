use crate::error::{AppError, AppResult};
use crate::platform::mrscheme::{self, SchemeStatus};
use crate::platform::links;
use crate::state::AppState;
use tauri::State;

#[tauri::command]
pub async fn modrinth_links_status() -> AppResult<SchemeStatus> {
    tauri::async_runtime::spawn_blocking(mrscheme::status).await.map_err(|e| AppError::msg(e.to_string()))
}

#[tauri::command]
pub async fn modrinth_links_set(state: State<'_, AppState>, enabled: bool) -> AppResult<SchemeStatus> {
    let root = state.paths.root.clone();
    tauri::async_runtime::spawn_blocking(move || mrscheme::set(&root, enabled)).await.map_err(|e| AppError::msg(e.to_string()))?
}

#[tauri::command]
pub async fn app_link_parse(url: String) -> AppResult<Option<links::AppAction>> {
    Ok(links::parse_url(&url))
}

#[tauri::command]
pub async fn content_version_project(state: State<'_, AppState>, version_id: String) -> AppResult<String> {
    crate::content::modrinth::version_project_id(&state, &version_id).await
}
