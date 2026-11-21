//! OWNER: Auth-Agent.
use crate::auth::{Account, DeviceCode};
use crate::error::AppResult;
use crate::state::AppState;
use tauri::State;

#[tauri::command]
pub async fn accounts_list(state: State<'_, AppState>) -> AppResult<Vec<Account>> {
    Ok(state.auth.list())
}

/// Account entfernen (inkl. gespeicherter Tokens im Schlüsselbund).
#[tauri::command]
pub async fn account_remove(state: State<'_, AppState>, id: String) -> AppResult<()> {
    state.auth.remove(&id)?;
    crate::vibe::forget_tokens(&state, &id);
    Ok(())
}

#[tauri::command]
pub async fn account_set_active(state: State<'_, AppState>, id: String) -> AppResult<()> {
    state.auth.set_active(&id)
}

/// Microsoft-Tokens sofort erneuern. Bei Fehlschlag wird `needs_relogin` gesetzt.
#[tauri::command]
pub async fn account_refresh(state: State<'_, AppState>, id: String) -> AppResult<Account> {
    let st = state.inner().clone();
    st.auth.refresh(&st, &id, true).await
}

/// Ist ein Microsoft-Login möglich (Client-ID konfiguriert)?
#[tauri::command]
pub async fn auth_msa_available(state: State<'_, AppState>) -> AppResult<bool> {
    Ok(state.settings().msa_client().is_some())
}

/// Startet den Device-Code-Flow. Danach `auth_msa_wait` aufrufen.
#[tauri::command]
pub async fn auth_msa_begin(state: State<'_, AppState>) -> AppResult<DeviceCode> {
    let st = state.inner().clone();
    st.auth.msa_begin(&st).await
}

/// Wartet, bis der Nutzer den Code eingegeben hat, und legt den Account an.
#[tauri::command]
pub async fn auth_msa_wait(state: State<'_, AppState>) -> AppResult<Account> {
    let st = state.inner().clone();
    st.auth.msa_wait(&st).await
}

#[tauri::command]
pub async fn auth_msa_window_login(state: State<'_, AppState>, title: Option<String>) -> AppResult<Account> {
    let st = state.inner().clone();
    let title = title.filter(|t| !t.trim().is_empty()).unwrap_or_else(|| "Microsoft".into());
    st.auth.msa_window_login(&st, &title).await
}

#[tauri::command]
pub async fn auth_msa_cancel(state: State<'_, AppState>) -> AppResult<()> {
    state.auth.msa_cancel();
    Ok(())
}
