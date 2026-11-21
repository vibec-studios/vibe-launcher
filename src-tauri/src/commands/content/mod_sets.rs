use super::*;

#[tauri::command]
pub async fn modsets_list(state: State<'_, AppState>, instance_id: String) -> AppResult<modsets::ModSets> {
    modsets::list(&state, &instance_id).await
}

/// Neues Set aus dem aktuellen Zustand (wird aktiv).
#[tauri::command]
pub async fn modset_create(state: State<'_, AppState>, instance_id: String, name: String) -> AppResult<modsets::ModSets> {
    modsets::create(&state, &instance_id, &name).await
}

/// Set anwenden (aktiviert/deaktiviert Inhalte).
#[tauri::command]
pub async fn modset_apply(state: State<'_, AppState>, instance_id: String, set_id: String) -> AppResult<modsets::ModSets> {
    modsets::apply(&state, &instance_id, &set_id).await
}

/// Aktuellen Zustand in ein Set übernehmen.
#[tauri::command]
pub async fn modset_save(state: State<'_, AppState>, instance_id: String, set_id: String) -> AppResult<modsets::ModSets> {
    modsets::overwrite(&state, &instance_id, &set_id).await
}

#[tauri::command]
pub async fn modset_rename(state: State<'_, AppState>, instance_id: String, set_id: String, name: String) -> AppResult<modsets::ModSets> {
    modsets::rename(&state, &instance_id, &set_id, &name).await
}

#[tauri::command]
pub async fn modset_delete(state: State<'_, AppState>, instance_id: String, set_id: String) -> AppResult<modsets::ModSets> {
    modsets::delete(&state, &instance_id, &set_id).await
}
