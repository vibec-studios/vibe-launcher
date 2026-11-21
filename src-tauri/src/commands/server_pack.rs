use crate::error::{AppError, AppResult};
use crate::server::server_dir;
use crate::serverpack::bundle::{self, BundleInfo};
use crate::serverpack::place::{self, Manifest};
use crate::serverpack::snapshot::{self, PackSnapshot};
use crate::serverpack::{run, PackApplied, PackApply, PackInput, PackOptions, PackPreview};
use crate::state::AppState;
use serde::Serialize;
use tauri::State;

#[tauri::command]
pub async fn server_pack_preview(state: State<'_, AppState>, input: PackInput, server_id: Option<String>) -> AppResult<PackPreview> {
    run::preview(&state, &input, server_id.as_deref()).await
}

#[tauri::command]
pub async fn server_pack_apply(state: State<'_, AppState>, req: PackApply) -> AppResult<PackApplied> {
    run::start(&state, req).await
}

#[tauri::command]
pub async fn server_pack_bundle(state: State<'_, AppState>, input: PackInput, options: Option<PackOptions>) -> AppResult<BundleInfo> {
    let task = state.tasks.create("server", "Server-Paket wird gepackt", None);
    let res = bundle::build(&state, &input, &options.unwrap_or_default(), &task.sub(0.0, 0.95)).await;
    task.finish(match &res {
        Ok(_) => Ok(()),
        Err(AppError::Cancelled) => Err(AppError::Cancelled),
        Err(e) => Err(AppError::msg(e.to_string())),
    });
    res
}

#[derive(Serialize)]
pub struct PackStatus {
    pub manifest: Option<Manifest>,
    pub snapshots: Vec<PackSnapshot>,
}

#[tauri::command]
pub async fn server_pack_status(state: State<'_, AppState>, id: String) -> AppResult<PackStatus> {
    state.servers.get(&id)?;
    let dir = server_dir(&state.paths, &id);
    Ok(tokio::task::spawn_blocking(move || PackStatus { manifest: place::load_manifest(&dir), snapshots: snapshot::list(&dir) }).await?)
}

#[tauri::command]
pub async fn server_pack_restore(state: State<'_, AppState>, id: String, name: String) -> AppResult<String> {
    run::restore(&state, &id, &name)
}

#[tauri::command]
pub async fn server_pack_snapshot_delete(state: State<'_, AppState>, id: String, name: String) -> AppResult<()> {
    state.servers.get(&id)?;
    snapshot::delete(&server_dir(&state.paths, &id), &name)
}
