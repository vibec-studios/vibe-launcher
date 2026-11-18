//! Tauri-Commands der Client-Packs.
use super::PacksOverview;
use crate::error::{AppError, AppResult};
use crate::instance::LoaderKind;
use crate::state::AppState;
use tauri::State;

/// Packs für eine Instanz (mit Installationsstand) oder für eine geplante Instanz (`mc_version` + `loader`).
#[tauri::command]
pub async fn client_packs_list(
    state: State<'_, AppState>,
    instance_id: Option<String>,
    mc_version: Option<String>,
    loader: Option<LoaderKind>,
) -> AppResult<PacksOverview> {
    if let Some(id) = instance_id {
        let inst = state.instances.get(&id)?;
        return Ok(super::overview(&state, Some(&inst), &inst.mc_version.clone(), inst.loader.kind).await);
    }
    let (Some(mc), Some(loader)) = (mc_version, loader) else {
        return Err(AppError::Invalid("Instanz oder Version + Loader angeben".into()));
    };
    Ok(super::overview(&state, None, &mc, loader).await)
}

/// Pack installieren bzw. aktualisieren. `replace`: andere Clients vorher entfernen (nach Bestätigung).
/// Liefert die Task-ID.
#[tauri::command]
pub async fn client_pack_install(state: State<'_, AppState>, instance_id: String, pack_id: String, replace: Option<bool>) -> AppResult<String> {
    let (inst, d, others) = super::precheck(&state, &instance_id, &pack_id, replace.unwrap_or(false))?;
    let st = state.inner().clone();
    let title = format!("{} für {} installieren", super::pretty(d.id), inst.name);
    Ok(state.tasks.spawn("client_pack", title, Some(instance_id.clone()), move |task| super::install(st, task, instance_id, pack_id, others)))
}

/// Pack entfernen (nur die eigenen Dateien).
#[tauri::command]
pub async fn client_pack_remove(state: State<'_, AppState>, instance_id: String, pack_id: String) -> AppResult<()> {
    super::remove(&state, &instance_id, &pack_id).await
}
