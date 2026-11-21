//! Lokale Server. OWNER: Game-Agent.
use crate::error::{AppError, AppResult};
use crate::minecraft::LogLine;
use crate::server::backup::{ServerBackup, ServerWorld};
use crate::server::players::{ListKind, ServerPlayers};
use crate::server::run::ServerStatus;
use crate::server::sides::ServerModCandidate;
use crate::server::{self, server_dir, Server, ServerCreate, ServerPatch};
use crate::state::AppState;
use serde::Serialize;
use std::collections::HashMap;
use tauri::State;

mod manage;
mod runtime;

pub use manage::*;
pub use runtime::*;

// ------------------------------------------------------------------ Plugin-Software (Paper/Purpur/Folia)

#[tauri::command]
pub async fn server_platform_versions(state: State<'_, AppState>, kind: server::platform::PlatformKind) -> AppResult<Vec<server::platform::PlatformVersion>> {
    server::platform::versions(&state, kind).await
}

#[tauri::command]
pub async fn server_platform_builds(
    state: State<'_, AppState>,
    kind: server::platform::PlatformKind,
    mc: String,
) -> AppResult<Vec<server::platform::PlatformBuild>> {
    server::platform::builds(&state, kind, &mc).await
}

/// Anderen Build der Server-Software einspielen (Update/Downgrade). `build = None` -> neuester stabiler.
#[tauri::command]
pub async fn server_platform_set_build(state: State<'_, AppState>, id: String, build: Option<String>) -> AppResult<String> {
    server::ops::set_platform_build(&state, &id, build).await
}

// ------------------------------------------------------------------ Plugins / Mods des Servers

use crate::server::plugins::{self, AddonList, AddonSearch, AddonSource, AddonUpdate};

#[tauri::command]
pub async fn server_addons(state: State<'_, AppState>, id: String) -> AppResult<AddonList> {
    let s = state.servers.get(&id)?;
    plugins::list(&state, &s).await
}

#[tauri::command]
pub async fn server_addon_search(
    state: State<'_, AppState>,
    id: String,
    source: AddonSource,
    query: String,
    sort: Option<String>,
    offset: Option<u32>,
) -> AppResult<AddonSearch> {
    let s = state.servers.get(&id)?;
    plugins::search(&state, &s, source, &query, sort.as_deref().unwrap_or("relevance"), offset.unwrap_or(0)).await
}

/// Projektdetails für das Overlay: Hangar über die Hangar-API (Modrinth nutzt `content_project`).
#[tauri::command]
pub async fn server_addon_project(state: State<'_, AppState>, project: String) -> AppResult<plugins::AddonProject> {
    plugins::hangar_project(&state, &project).await
}

#[tauri::command]
pub async fn server_addon_install(state: State<'_, AppState>, id: String, source: AddonSource, project: String) -> AppResult<Vec<String>> {
    let s = state.servers.get(&id)?;
    plugins::install(&state, &s, source, &project).await
}

#[tauri::command]
pub async fn server_addon_updates(state: State<'_, AppState>, id: String) -> AppResult<Vec<AddonUpdate>> {
    let s = state.servers.get(&id)?;
    plugins::updates(&state, &s).await
}

#[tauri::command]
pub async fn server_addon_update(state: State<'_, AppState>, id: String, files: Option<Vec<String>>) -> AppResult<usize> {
    let s = state.servers.get(&id)?;
    plugins::apply_updates(&state, &s, files).await
}

#[tauri::command]
pub async fn server_addon_set_enabled(state: State<'_, AppState>, id: String, file: String, enabled: bool) -> AppResult<String> {
    let s = state.servers.get(&id)?;
    plugins::set_enabled(&state, &s, &file, enabled)
}

#[tauri::command]
pub async fn server_addon_remove(state: State<'_, AppState>, id: String, file: String) -> AppResult<()> {
    let s = state.servers.get(&id)?;
    plugins::remove(&state, &s, &file)
}

/// Sprachchat/Bedrock-Status eines Servers (Vertrag 04/28).
#[tauri::command]
pub async fn server_extras_get(state: State<'_, AppState>, id: String) -> AppResult<crate::server::extras::ExtrasInfo> {
    let s = state.servers.get(&id)?;
    Ok(crate::server::extras::info(&state, &s).await)
}

/// Sprachchat (Simple Voice Chat) bzw. Bedrock (Geyser + Floodgate) ein-/ausschalten: installiert bzw. deaktiviert die
/// Erweiterungen über Modrinth. Nur bei gestopptem Server.
#[tauri::command]
pub async fn server_extras_set(state: State<'_, AppState>, id: String, voice: Option<bool>, bedrock: Option<bool>) -> AppResult<crate::server::extras::ExtrasInfo> {
    crate::server::extras::set(&state, &id, voice, bedrock).await
}
