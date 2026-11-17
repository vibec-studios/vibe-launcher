//! OWNER: Content-Agent.
use crate::content::*;
use crate::error::{AppError, AppResult};
use crate::instance::LoaderKind;
use crate::state::AppState;
use tauri::State;

fn todo<T>() -> AppResult<T> {
    Err(AppError::msg("noch nicht implementiert"))
}

/// Ist CurseForge nutzbar (API-Key vorhanden)?
#[tauri::command]
pub async fn curseforge_available(state: State<'_, AppState>) -> AppResult<bool> {
    Ok(state.settings().curseforge_key().is_some())
}

#[tauri::command]
pub async fn content_search(_state: State<'_, AppState>, _query: SearchQuery) -> AppResult<SearchResult> {
    todo()
}

#[tauri::command]
pub async fn content_categories(_state: State<'_, AppState>, _source: Source, _project_type: ProjectType) -> AppResult<Vec<Category>> {
    todo()
}

#[tauri::command]
pub async fn content_project(_state: State<'_, AppState>, _source: Source, _id: String) -> AppResult<ProjectDetails> {
    todo()
}

#[tauri::command]
pub async fn content_versions(
    _state: State<'_, AppState>,
    _source: Source,
    _id: String,
    _game_version: Option<String>,
    _loader: Option<LoaderKind>,
) -> AppResult<Vec<ProjectVersion>> {
    todo()
}

/// Projekt (Mod/Resourcepack/Shader) in eine Instanz installieren, inkl. Pflicht-Abhängigkeiten.
/// `version_id = None` -> neueste passende Version. Gibt Task-ID zurück.
#[tauri::command]
pub async fn content_install(
    _state: State<'_, AppState>,
    _instance_id: String,
    _source: Source,
    _project_id: String,
    _version_id: Option<String>,
) -> AppResult<String> {
    todo()
}

#[tauri::command]
pub async fn content_list(_state: State<'_, AppState>, _instance_id: String, _kind: ContentKind) -> AppResult<Vec<ContentItem>> {
    todo()
}

#[tauri::command]
pub async fn content_set_enabled(
    _state: State<'_, AppState>,
    _instance_id: String,
    _kind: ContentKind,
    _file_name: String,
    _enabled: bool,
) -> AppResult<ContentItem> {
    todo()
}

#[tauri::command]
pub async fn content_remove(_state: State<'_, AppState>, _instance_id: String, _kind: ContentKind, _file_names: Vec<String>) -> AppResult<()> {
    todo()
}

/// Lokale Dateien (z. B. per Drag & Drop) in den passenden Ordner kopieren.
#[tauri::command]
pub async fn content_add_files(_state: State<'_, AppState>, _instance_id: String, _kind: ContentKind, _paths: Vec<String>) -> AppResult<Vec<ContentItem>> {
    todo()
}

#[tauri::command]
pub async fn content_check_updates(_state: State<'_, AppState>, _instance_id: String) -> AppResult<Vec<ContentUpdate>> {
    todo()
}

/// Gibt Task-ID zurück.
#[tauri::command]
pub async fn content_update(_state: State<'_, AppState>, _instance_id: String, _file_names: Vec<String>) -> AppResult<String> {
    todo()
}

#[tauri::command]
pub async fn worlds_list(_state: State<'_, AppState>, _instance_id: String) -> AppResult<Vec<World>> {
    todo()
}

#[tauri::command]
pub async fn world_delete(_state: State<'_, AppState>, _instance_id: String, _folder: String) -> AppResult<()> {
    todo()
}

/// Modpack von Modrinth/CurseForge als neue Instanz installieren. Gibt Task-ID zurück.
#[tauri::command]
pub async fn modpack_install(
    _state: State<'_, AppState>,
    _source: Source,
    _project_id: String,
    _version_id: Option<String>,
) -> AppResult<String> {
    todo()
}

/// Datei (.mrpack, CurseForge-.zip, .vlpack, Prism/MultiMC-.zip) analysieren.
#[tauri::command]
pub async fn import_preview(_state: State<'_, AppState>, _path: String) -> AppResult<ImportPreview> {
    todo()
}

/// Datei als neue Instanz importieren. Gibt Task-ID zurück.
#[tauri::command]
pub async fn import_pack(_state: State<'_, AppState>, _path: String, _name: Option<String>) -> AppResult<String> {
    todo()
}

/// Dateien/Ordner im Spielordner, die für einen Export infrage kommen.
#[tauri::command]
pub async fn export_entries(_state: State<'_, AppState>, _instance_id: String) -> AppResult<Vec<ExportEntry>> {
    todo()
}

/// Instanz exportieren. Gibt Task-ID zurück.
#[tauri::command]
pub async fn export_instance(_state: State<'_, AppState>, _instance_id: String, _options: ExportOptions) -> AppResult<String> {
    todo()
}

/// Dateien, die manuell heruntergeladen werden müssen (z. B. nach CurseForge-Import).
/// Bereits vorhandene Dateien (vom Nutzer in den Ordner gelegt) werden nicht mehr gelistet.
#[tauri::command]
pub async fn content_missing(_state: State<'_, AppState>, _instance_id: String) -> AppResult<Vec<MissingDownload>> {
    Ok(vec![])
}

/// Liste der fehlenden Downloads verwerfen.
#[tauri::command]
pub async fn content_missing_dismiss(_state: State<'_, AppState>, _instance_id: String) -> AppResult<()> {
    Ok(())
}
