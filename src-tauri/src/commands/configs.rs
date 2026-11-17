//! Konfigurations-Editor einer Instanz (siehe `content::configs`). Alle Dateizugriffe laufen blockierend
//! in `spawn_blocking`; Pfade sind relativ zum Spielordner und werden dort geprüft.
use crate::content::configs::{self, ConfigDirs, ConfigEntry, ConfigFile, SearchHit, ValidationError};
use crate::error::AppResult;
use crate::state::AppState;
use tauri::State;

fn dirs(state: &AppState, instance_id: &str) -> AppResult<ConfigDirs> {
    state.instances.get(instance_id)?;
    Ok(ConfigDirs::new(&state.paths, instance_id))
}

/// Flache Liste: `config/`, `defaultconfigs/` (rekursiv) und die options-Dateien.
#[tauri::command]
pub async fn config_tree(state: State<'_, AppState>, instance_id: String) -> AppResult<Vec<ConfigEntry>> {
    let d = dirs(&state, &instance_id)?;
    Ok(tokio::task::spawn_blocking(move || configs::tree(&d)).await?)
}

#[tauri::command]
pub async fn config_read(state: State<'_, AppState>, instance_id: String, path: String) -> AppResult<ConfigFile> {
    let d = dirs(&state, &instance_id)?;
    tokio::task::spawn_blocking(move || configs::read(&d, &path)).await?
}

/// Speichert (vorher Sicherung der alten Fassung, höchstens 10 je Datei) und liefert die neue Fassung.
#[tauri::command]
pub async fn config_write(state: State<'_, AppState>, instance_id: String, path: String, content: String) -> AppResult<ConfigFile> {
    let d = dirs(&state, &instance_id)?;
    tokio::task::spawn_blocking(move || configs::write(&d, &path, &content)).await?
}

/// Letzte Sicherung zurückspielen (die aktuelle Fassung wird dabei selbst gesichert).
#[tauri::command]
pub async fn config_restore(state: State<'_, AppState>, instance_id: String, path: String) -> AppResult<ConfigFile> {
    let d = dirs(&state, &instance_id)?;
    tokio::task::spawn_blocking(move || configs::restore(&d, &path)).await?
}

#[tauri::command]
pub async fn config_validate(path: String, content: String) -> AppResult<Vec<ValidationError>> {
    Ok(tokio::task::spawn_blocking(move || configs::validate(&path, &content)).await?)
}

/// Volltextsuche (ohne Groß-/Kleinschreibung) in allen Konfigurationsdateien, höchstens 200 Treffer.
#[tauri::command]
pub async fn config_search(state: State<'_, AppState>, instance_id: String, query: String) -> AppResult<Vec<SearchHit>> {
    let d = dirs(&state, &instance_id)?;
    Ok(tokio::task::spawn_blocking(move || configs::search(&d, &query)).await?)
}
