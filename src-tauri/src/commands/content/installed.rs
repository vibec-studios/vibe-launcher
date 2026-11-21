use super::*;

#[tauri::command]
pub async fn content_list(state: State<'_, AppState>, instance_id: String, kind: ContentKind) -> AppResult<Vec<ContentItem>> {
    local::list(&state, &instance_id, kind).await
}

#[tauri::command]
pub async fn content_set_enabled(
    state: State<'_, AppState>,
    instance_id: String,
    kind: ContentKind,
    file_name: String,
    enabled: bool,
) -> AppResult<ContentItem> {
    local::set_enabled(&state, &instance_id, kind, &file_name, enabled).await
}

#[tauri::command]
pub async fn content_remove(state: State<'_, AppState>, instance_id: String, kind: ContentKind, file_names: Vec<String>) -> AppResult<()> {
    local::remove(&state, &instance_id, kind, &file_names).await
}

/// Lokale Dateien (z. B. per Drag & Drop) in den passenden Ordner kopieren.
#[tauri::command]
pub async fn content_add_files(state: State<'_, AppState>, instance_id: String, kind: ContentKind, paths: Vec<String>) -> AppResult<Vec<ContentItem>> {
    local::add_files(&state, &instance_id, kind, &paths).await
}

#[tauri::command]
pub async fn content_check_updates(state: State<'_, AppState>, instance_id: String) -> AppResult<Vec<ContentUpdate>> {
    install::check_updates(&state, &instance_id).await
}

/// Gibt Task-ID zurück. Leere Liste = alle verfügbaren Updates.
#[tauri::command]
pub async fn content_update(state: State<'_, AppState>, instance_id: String, file_names: Vec<String>) -> AppResult<String> {
    state.instances.get(&instance_id)?;
    let st = state.inner().clone();
    let iid = instance_id.clone();
    Ok(state.tasks.spawn("content", "Inhalte aktualisieren", Some(instance_id), move |task| install::run_update(st, task, iid, file_names)))
}

#[tauri::command]
pub async fn worlds_list(state: State<'_, AppState>, instance_id: String) -> AppResult<Vec<World>> {
    worlds::list(&state, &instance_id).await
}

#[tauri::command]
pub async fn world_delete(state: State<'_, AppState>, instance_id: String, folder: String) -> AppResult<()> {
    worlds::delete(&state, &instance_id, &folder).await
}

/// Version eines Inhalts fixieren (kein Auto-Update, nicht bei „Alle aktualisieren“) oder lösen.
#[tauri::command]
pub async fn content_set_pinned(state: State<'_, AppState>, instance_id: String, kind: ContentKind, file_name: String, pinned: bool) -> AppResult<ContentItem> {
    autoupdate::set_pinned(&state, &instance_id, kind, &file_name, pinned).await
}

/// Anzahl verfügbarer Updates je Instanz (Hintergrundprüfung, höchstens alle 30 min; danach `content://changed`).
#[tauri::command]
pub async fn content_update_counts(state: State<'_, AppState>) -> AppResult<std::collections::HashMap<String, u32>> {
    Ok(autoupdate::update_counts(&state).await)
}

/// Konfigurierte Stores (Standard-Store immer enthalten) mit Name/Icon/Projektanzahl aus der Datei.
#[tauri::command]
pub async fn stores_list(state: State<'_, AppState>) -> AppResult<Vec<store::StoreInfo>> {
    Ok(store::list(&state).await)
}

/// Store per URL hinzufügen (lädt und prüft die Datei).
#[tauri::command]
pub async fn store_add(state: State<'_, AppState>, url: String) -> AppResult<store::StoreInfo> {
    store::add(&state, &url).await
}

#[tauri::command]
pub async fn store_remove(state: State<'_, AppState>, id: String) -> AppResult<()> {
    store::remove(&state, &id)
}

#[tauri::command]
pub async fn store_set_enabled(state: State<'_, AppState>, id: String, enabled: bool) -> AppResult<()> {
    store::set_enabled(&state, &id, enabled)
}
