use super::{InstalledPack, PackIssue, PackPreview};
use crate::error::{AppError, AppResult};
use crate::state::AppState;
use serde::Serialize;
use std::path::PathBuf;
use tauri::State;

#[derive(Debug, Serialize)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum InspectOutcome {
    Ok { preview: Box<PackPreview> },
    Error { issue: PackIssue },
}

pub fn usage(state: &AppState, id: &str, version: &str) -> usize {
    state.instances.list().iter().filter(|i| i.custom_loader.as_ref().is_some_and(|c| c.id == id && c.version == version)).count()
}

fn require_enabled(state: &AppState) -> AppResult<()> {
    if state.settings().custom_loaders {
        Ok(())
    } else {
        Err(AppError::Invalid("Eigene Loader sind ausgeschaltet (Einstellungen → Spiel → Experimentell).".into()))
    }
}

fn with_usage(state: &AppState, mut p: InstalledPack) -> InstalledPack {
    p.instances = usage(state, &p.id, &p.loader_version);
    p
}

#[tauri::command]
pub async fn custom_loader_inspect(state: State<'_, AppState>, path: String) -> AppResult<InspectOutcome> {
    let paths = state.paths.clone();
    let res = tokio::task::spawn_blocking(move || super::inspect(&paths, &PathBuf::from(path))).await?;
    Ok(match res {
        Ok(preview) => InspectOutcome::Ok { preview: Box::new(preview) },
        Err(issue) => InspectOutcome::Error { issue },
    })
}

#[tauri::command]
pub async fn custom_loader_import(state: State<'_, AppState>, path: String, replace: bool) -> AppResult<InstalledPack> {
    require_enabled(&state)?;
    let paths = state.paths.clone();
    let p = tokio::task::spawn_blocking(move || super::import(&paths, &PathBuf::from(path), replace)).await??;
    Ok(with_usage(&state, p))
}

#[tauri::command]
pub async fn custom_loaders_list(state: State<'_, AppState>) -> AppResult<Vec<InstalledPack>> {
    let paths = state.paths.clone();
    let list = tokio::task::spawn_blocking(move || super::list(&paths)).await?;
    Ok(list.into_iter().map(|p| with_usage(&state, p)).collect())
}

#[tauri::command]
pub async fn custom_loader_delete(state: State<'_, AppState>, id: String, version: String) -> AppResult<()> {
    let n = usage(&state, &id, &version);
    if n > 0 {
        let what = if n == 1 { "1 Instanz".to_string() } else { format!("{n} Instanzen") };
        return Err(AppError::Invalid(format!("Das Loader-Pack wird noch von {what} benutzt. Lösche oder ändere diese zuerst.")));
    }
    let paths = state.paths.clone();
    tokio::task::spawn_blocking(move || super::delete(&paths, &id, &version)).await?
}
