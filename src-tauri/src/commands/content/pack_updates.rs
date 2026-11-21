use super::*;

/// Neuere Version des Modpacks dieser Instanz (oder `null`).
#[tauri::command]
pub async fn modpack_check(state: State<'_, AppState>, instance_id: String) -> AppResult<Option<modpack::ModpackUpdate>> {
    modpack::check(&state, &instance_id).await
}

/// Änderungen eines Modpack-Updates (Dateien, Overrides, Version/Loader). `version_id = None` -> neueste.
#[tauri::command]
pub async fn modpack_update_preview(state: State<'_, AppState>, instance_id: String, version_id: Option<String>) -> AppResult<modpack::ModpackPreview> {
    modpack::preview(&state, &instance_id, version_id).await
}

/// Modpack aktualisieren (vorher automatischer Snapshot). Gibt Task-ID zurück.
#[tauri::command]
pub async fn modpack_update(state: State<'_, AppState>, instance_id: String, version_id: Option<String>) -> AppResult<String> {
    let inst = state.instances.get(&instance_id)?;
    let st = state.inner().clone();
    let iid = instance_id.clone();
    Ok(state.tasks.spawn("update", format!("{} aktualisieren", inst.name), Some(instance_id), move |task| modpack::run_update(st, task, iid, version_id)))
}

#[tauri::command]
pub async fn modpack_from_preview(state: State<'_, AppState>, instance_id: String, input: crate::content::modpack_from::PackInput) -> AppResult<modpack::ModpackPreview> {
    crate::content::modpack_from::preview(&state, &instance_id, input).await
}

#[tauri::command]
pub async fn modpack_from_update(state: State<'_, AppState>, instance_id: String, input: crate::content::modpack_from::PackInput) -> AppResult<String> {
    let inst = state.instances.get(&instance_id)?;
    let st = state.inner().clone();
    let iid = instance_id.clone();
    Ok(state.tasks.spawn("update", format!("{} aktualisieren", inst.name), Some(instance_id), move |task| crate::content::modpack_from::run_update(st, task, iid, input)))
}

#[tauri::command]
pub async fn modpack_remote_check(state: State<'_, AppState>, instance_id: String) -> AppResult<Option<crate::content::modpack_from::RemoteUpdate>> {
    crate::content::modpack_from::check_remote(&state, &instance_id).await
}
