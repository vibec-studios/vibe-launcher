use crate::datadir;
use crate::error::AppResult;
use crate::state::AppState;
use tauri::State;

#[tauri::command]
pub async fn datadir_preview(state: State<'_, AppState>, target: Option<String>) -> AppResult<datadir::Preview> {
    datadir::preview(&state, target).await
}

#[tauri::command]
pub async fn datadir_move(state: State<'_, AppState>, target: String) -> AppResult<String> {
    datadir::start(&state, target)
}
