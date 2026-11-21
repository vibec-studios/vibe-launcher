use crate::error::AppResult;
use crate::portable::{self, copy::CopyResult, Status};
use crate::state::AppState;
use tauri::State;

#[tauri::command]
pub async fn portable_status(state: State<'_, AppState>) -> AppResult<Status> {
    Ok(portable::status(&state))
}

#[tauri::command]
pub async fn portable_set_forget(state: State<'_, AppState>, on: bool) -> AppResult<Status> {
    portable::set_forget_on_exit(&state, on)
}

#[tauri::command]
pub async fn portable_forget_here(state: State<'_, AppState>) -> AppResult<usize> {
    let st = state.inner().clone();
    Ok(tokio::task::spawn_blocking(move || portable::forget_here(&st)).await?)
}

#[tauri::command]
pub async fn portable_create_copy(target: String) -> AppResult<CopyResult> {
    tokio::task::spawn_blocking(move || portable::copy::create(&target)).await?
}
