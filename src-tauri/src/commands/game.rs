//! OWNER: Game-Agent.
use crate::error::{AppError, AppResult};
use crate::instance::LoaderKind;
use crate::minecraft::{GameState, JavaInstall, LoaderVersion, LogFile, LogLine, McVersion, MclogsResult};
use crate::state::AppState;
use tauri::State;

/// Alle Minecraft-Versionen (neueste zuerst). `refresh` erzwingt Neuladen des Manifests.
#[tauri::command]
pub async fn game_versions(_state: State<'_, AppState>, _refresh: Option<bool>) -> AppResult<Vec<McVersion>> {
    Err(AppError::msg("noch nicht implementiert"))
}

/// Minecraft-Versionen, die ein Loader unterstützt (neueste zuerst).
#[tauri::command]
pub async fn loader_game_versions(_state: State<'_, AppState>, _loader: LoaderKind) -> AppResult<Vec<String>> {
    Err(AppError::msg("noch nicht implementiert"))
}

/// Loader-Versionen für eine Minecraft-Version (neueste/empfohlene zuerst).
#[tauri::command]
pub async fn loader_versions(_state: State<'_, AppState>, _loader: LoaderKind, _mc_version: String) -> AppResult<Vec<LoaderVersion>> {
    Err(AppError::msg("noch nicht implementiert"))
}

/// Installation/Reparatur einer Instanz als Hintergrundaufgabe. Gibt Task-ID zurück.
#[tauri::command]
pub async fn instance_install(_state: State<'_, AppState>, _id: String, _force: Option<bool>) -> AppResult<String> {
    Err(AppError::msg("noch nicht implementiert"))
}

/// Instanz starten (installiert bei Bedarf). Gibt Task-ID der Vorbereitung zurück.
#[tauri::command]
pub async fn instance_launch(_state: State<'_, AppState>, _id: String, _account_id: Option<String>) -> AppResult<String> {
    Err(AppError::msg("noch nicht implementiert"))
}

#[tauri::command]
pub async fn instance_kill(_state: State<'_, AppState>, _id: String) -> AppResult<()> {
    Err(AppError::msg("noch nicht implementiert"))
}

#[tauri::command]
pub async fn game_states(state: State<'_, AppState>) -> AppResult<Vec<GameState>> {
    Ok(state.game.states())
}

/// Log-Zeilen der aktuellen/letzten Sitzung (Puffer im Speicher).
#[tauri::command]
pub async fn instance_log_session(_state: State<'_, AppState>, _id: String) -> AppResult<Vec<LogLine>> {
    Ok(vec![])
}

/// Log-Dateien und Crash-Reports im Spielordner.
#[tauri::command]
pub async fn instance_log_files(_state: State<'_, AppState>, _id: String) -> AppResult<Vec<LogFile>> {
    Ok(vec![])
}

/// Inhalt einer Log-Datei (entpackt .gz automatisch).
#[tauri::command]
pub async fn instance_log_read(_state: State<'_, AppState>, _id: String, _name: String) -> AppResult<String> {
    Err(AppError::msg("noch nicht implementiert"))
}

/// Log zu mclo.gs hochladen.
#[tauri::command]
pub async fn mclogs_upload(_state: State<'_, AppState>, _content: String) -> AppResult<MclogsResult> {
    Err(AppError::msg("noch nicht implementiert"))
}

/// Gefundene Java-Installationen (System + vom Launcher verwaltet).
#[tauri::command]
pub async fn java_list(_state: State<'_, AppState>) -> AppResult<Vec<JavaInstall>> {
    Ok(vec![])
}

/// Java-Pfad prüfen.
#[tauri::command]
pub async fn java_test(_state: State<'_, AppState>, _path: String) -> AppResult<JavaInstall> {
    Err(AppError::msg("noch nicht implementiert"))
}

/// Java-Hauptversion herunterladen. Gibt Task-ID zurück.
#[tauri::command]
pub async fn java_install(_state: State<'_, AppState>, _major: u32) -> AppResult<String> {
    Err(AppError::msg("noch nicht implementiert"))
}
