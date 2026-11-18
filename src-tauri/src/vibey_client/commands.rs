//! Tauri-Commands des Vibey Clients (Verteilung, Cosmetics-Assets, Einreichungen, Creator-Tools).
use super::{blockbench, cosmetics, install, ClientRelease};
use crate::error::AppResult;
use crate::state::AppState;
use serde_json::Value;
use std::path::PathBuf;
use tauri::State;

/// Neuestes Release (Kanal passend zum Launcher-Update-Kanal).
#[tauri::command]
pub async fn vibey_client_latest(state: State<'_, AppState>, force: Option<bool>) -> AppResult<ClientRelease> {
    super::latest(&state, force.unwrap_or(false)).await
}

#[tauri::command]
pub async fn vibey_client_status(state: State<'_, AppState>, instance_id: String) -> AppResult<install::ClientStatus> {
    install::status(&state, &instance_id).await
}

/// Schalter je Instanz. An: Task-ID der Installation; aus: sofort entfernt (`None`).
#[tauri::command]
pub async fn vibey_client_set(state: State<'_, AppState>, instance_id: String, enabled: bool) -> AppResult<Option<String>> {
    if !enabled {
        install::disable(&state, &instance_id).await?;
        return Ok(None);
    }
    let inst = state.instances.get(&instance_id)?;
    crate::vibe::ensure(&state, crate::vibe::Feature::Any)?;
    let st = state.inner().clone();
    let id = instance_id.clone();
    Ok(Some(state.tasks.spawn("vibey", format!("Vibey Client für {} installieren", inst.name), Some(instance_id), move |task| install::enable(st, task, id))))
}

/// Neue Fabric-Instanz mit Vibey Client. Task-ID (neue Instanz über `TaskInfo.instance_id`).
#[tauri::command]
pub async fn vibey_client_create_instance(state: State<'_, AppState>) -> AppResult<String> {
    crate::vibe::ensure(&state, crate::vibe::Feature::Any)?;
    let st = state.inner().clone();
    Ok(state.tasks.spawn("vibey", "Vibey-Client-Instanz erstellen", None, move |task| install::create_instance(st, task)))
}

/// Instanzen mit aktivem Vibey Client (Spielordner für den Blockbench-Live-Link).
#[tauri::command]
pub async fn vibey_client_instances(state: State<'_, AppState>) -> AppResult<Vec<install::VibeyInstance>> {
    Ok(install::vibey_instances(&state))
}

/// `.vibey`-Asset per SHA-256 (gecacht). Liefert den JSON-Text.
#[tauri::command]
pub async fn vibey_cosmetic_asset(state: State<'_, AppState>, hash: String) -> AppResult<String> {
    cosmetics::asset(&state, &hash).await
}

/// Vorschaubild als data:-URL (None = keins).
#[tauri::command]
pub async fn vibey_cosmetic_thumbnail(state: State<'_, AppState>, url: String, token: Option<String>) -> AppResult<Option<String>> {
    cosmetics::thumbnail(&state, &url, token.as_deref()).await
}

/// Eigene `.vibey`-Datei lesen (Vorschau/Prüfung).
#[tauri::command]
pub async fn vibey_bundle_read(path: String) -> AppResult<String> {
    cosmetics::read_bundle(&PathBuf::from(path)).await
}

/// Eigenes PNG als Vorschaubild lesen: `{ dataUrl, width, height }`.
#[tauri::command]
pub async fn vibey_png_read(path: String) -> AppResult<Value> {
    let (url, w, h) = cosmetics::read_png(&PathBuf::from(path)).await?;
    Ok(serde_json::json!({ "dataUrl": url, "width": w, "height": h }))
}

/// Einreichung hochladen (`POST /api/v1/cosmetics/submissions`). Liefert `{ submission }`.
#[tauri::command]
pub async fn vibey_submission_upload(
    state: State<'_, AppState>,
    token: String,
    path: String,
    name: String,
    description: String,
    thumbnail: Option<String>,
) -> AppResult<Value> {
    cosmetics::submit(&state, &token, &PathBuf::from(path), &name, &description, thumbnail.as_deref()).await
}

#[tauri::command]
pub async fn vibey_blockbench_status(state: State<'_, AppState>) -> AppResult<blockbench::BlockbenchStatus> {
    Ok(blockbench::status(&state).await)
}

#[tauri::command]
pub async fn vibey_blockbench_install_plugin(state: State<'_, AppState>) -> AppResult<blockbench::BlockbenchStatus> {
    blockbench::install_plugin(&state).await
}

#[tauri::command]
pub async fn vibey_blockbench_open() -> AppResult<()> {
    blockbench::open()
}

/// Plugin-Datei im Dateimanager zeigen.
#[tauri::command]
pub async fn vibey_blockbench_reveal_plugin(state: State<'_, AppState>) -> AppResult<()> {
    let p = blockbench::plugin_path(&state);
    super::reveal(if p.is_file() { &p } else { p.parent().unwrap_or(&p) })
}
