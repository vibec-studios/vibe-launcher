//! OWNER: Frontend-Agent A. Commands der Plattform-Funktionen (siehe `platform/`).
use crate::error::{AppError, AppResult};
use crate::platform::{crash, links, optsync, servers, shortcuts, stats, PlatformState};
use crate::state::AppState;
use serde::Serialize;
use std::path::{Path, PathBuf};
use tauri::State;

mod server_list;
mod sync_info;
mod sync;

pub use server_list::*;
pub use sync_info::*;
pub use sync::*;

fn join_err(e: tokio::task::JoinError) -> AppError {
    AppError::msg(e.to_string())
}

// ------------------------------------------------------------------ Verknüpfungen, externe Aktionen

#[tauri::command]
pub async fn shortcut_create(
    state: State<'_, AppState>,
    instance_id: String,
    location: String,
) -> AppResult<String> {
    let inst = state.instances.get(&instance_id)?;
    let dir = shortcuts::target_dir(&location)?;
    let icon_src = crate::instance::icon::file_path(inst.icon.as_deref())
        .map(PathBuf::from)
        .filter(|p| p.is_file());
    let cache = state
        .paths
        .cache()
        .join("shortcut-icons")
        .join(format!("{instance_id}.ico"));
    let name = inst.name.clone();
    tokio::task::spawn_blocking(move || {
        let ico = if cfg!(windows) {
            icon_src
                .as_deref()
                .and_then(|p| shortcuts::make_ico(p, &cache))
        } else {
            icon_src.clone()
        };
        shortcuts::create(&dir, &name, &instance_id, ico.as_deref())
            .map(|p| p.to_string_lossy().to_string())
    })
    .await
    .map_err(join_err)?
}

/// Ausstehende Aktionen von Kommandozeile/Deep-Links abholen (leert die Warteschlange).
#[tauri::command]
pub async fn app_actions_take(p: State<'_, PlatformState>) -> AppResult<Vec<links::AppAction>> {
    Ok(p.take_actions())
}

/// Ist Discord Rich Presence in diesem Build verfügbar (Client-ID gesetzt)?
#[tauri::command]
pub async fn discord_available(p: State<'_, PlatformState>) -> AppResult<bool> {
    Ok(p.discord.available())
}
