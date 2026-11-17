//! OWNER: Auth-Agent.
use crate::auth::{Account, DeviceCode};
use crate::error::{AppError, AppResult};
use crate::state::AppState;
use tauri::State;

#[tauri::command]
pub async fn accounts_list(state: State<'_, AppState>) -> AppResult<Vec<Account>> {
    Ok(state.auth.list())
}

#[tauri::command]
pub async fn account_offline_add(_state: State<'_, AppState>, _username: String) -> AppResult<Account> {
    Err(AppError::msg("noch nicht implementiert"))
}

#[tauri::command]
pub async fn account_remove(_state: State<'_, AppState>, _id: String) -> AppResult<()> {
    Err(AppError::msg("noch nicht implementiert"))
}

#[tauri::command]
pub async fn account_set_active(_state: State<'_, AppState>, _id: String) -> AppResult<()> {
    Err(AppError::msg("noch nicht implementiert"))
}

#[tauri::command]
pub async fn account_refresh(_state: State<'_, AppState>, _id: String) -> AppResult<Account> {
    Err(AppError::msg("noch nicht implementiert"))
}

/// Ist ein Microsoft-Login möglich (Client-ID konfiguriert)?
#[tauri::command]
pub async fn auth_msa_available(state: State<'_, AppState>) -> AppResult<bool> {
    Ok(state.settings().msa_client().is_some())
}

/// Startet den Device-Code-Flow. Danach `auth_msa_wait` aufrufen.
#[tauri::command]
pub async fn auth_msa_begin(_state: State<'_, AppState>) -> AppResult<DeviceCode> {
    Err(AppError::msg("noch nicht implementiert"))
}

/// Wartet, bis der Nutzer den Code eingegeben hat, und legt den Account an.
#[tauri::command]
pub async fn auth_msa_wait(_state: State<'_, AppState>) -> AppResult<Account> {
    Err(AppError::msg("noch nicht implementiert"))
}

#[tauri::command]
pub async fn auth_msa_cancel(_state: State<'_, AppState>) -> AppResult<()> {
    Ok(())
}
