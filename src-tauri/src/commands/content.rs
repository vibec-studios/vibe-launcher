//! OWNER: Content-Agent.
use crate::content::*;
use crate::error::{AppError, AppResult};
use crate::instance::LoaderKind;
use crate::state::AppState;
use tauri::State;

/// Ist CurseForge nutzbar (API-Key vorhanden)?
#[tauri::command]
pub async fn curseforge_available(state: State<'_, AppState>) -> AppResult<bool> {
    Ok(curseforge::available(&state))
}

#[tauri::command]
pub async fn content_search(state: State<'_, AppState>, query: SearchQuery) -> AppResult<SearchResult> {
    provider::search(&state, &query).await
}

#[tauri::command]
pub async fn content_categories(state: State<'_, AppState>, source: Source, project_type: ProjectType) -> AppResult<Vec<Category>> {
    provider::categories(&state, source, project_type).await
}

#[tauri::command]
pub async fn content_project(state: State<'_, AppState>, source: Source, id: String) -> AppResult<ProjectDetails> {
    provider::project(&state, source, &id).await
}

/// Versionen eines Projekts, neueste zuerst. Filter: Minecraft-Version und Loader (passend zum Projekttyp:
/// Shader/Resourcepacks werden nicht nach Mod-Loader gefiltert, Fabric-Mods gelten auch für Quilt).
#[tauri::command]
pub async fn content_versions(
    state: State<'_, AppState>,
    source: Source,
    id: String,
    game_version: Option<String>,
    loader: Option<LoaderKind>,
) -> AppResult<Vec<ProjectVersion>> {
    let gv = game_version.filter(|v| !v.is_empty());
    let (v, _, _) = provider::versions_for(&state, source, &id, gv.as_deref(), loader).await?;
    Ok(v)
}

/// Projekt (Mod/Resourcepack/Shader/Datapack) in eine Instanz installieren, inkl. Pflicht-Abhängigkeiten.
/// `version_id = None` -> neueste passende Version. Gibt Task-ID zurück.
#[tauri::command]
pub async fn content_install(
    state: State<'_, AppState>,
    instance_id: String,
    source: Source,
    project_id: String,
    version_id: Option<String>,
) -> AppResult<String> {
    state.instances.get(&instance_id)?;
    if source == Source::Curseforge {
        curseforge::key(&state)?;
    }
    let st = state.inner().clone();
    let iid = instance_id.clone();
    Ok(state.tasks.spawn("content", "Inhalt installieren", Some(instance_id), move |task| {
        install::run_install(st, task, iid, source, project_id, version_id)
    }))
}

#[tauri::command]
pub async fn content_list(state: State<'_, AppState>, instance_id: String, kind: ContentKind) -> AppResult<Vec<ContentItem>> {
    local::list(&state, &instance_id, kind).await
}

#[tauri::command]
pub async fn content_set_enabled(
    state: State<'_, AppState>,
    instance_id: String,
    kind: ContentKind,
    file_name: String,
    enabled: bool,
) -> AppResult<ContentItem> {
    local::set_enabled(&state, &instance_id, kind, &file_name, enabled).await
}

#[tauri::command]
pub async fn content_remove(state: State<'_, AppState>, instance_id: String, kind: ContentKind, file_names: Vec<String>) -> AppResult<()> {
    local::remove(&state, &instance_id, kind, &file_names).await
}

/// Lokale Dateien (z. B. per Drag & Drop) in den passenden Ordner kopieren.
#[tauri::command]
pub async fn content_add_files(state: State<'_, AppState>, instance_id: String, kind: ContentKind, paths: Vec<String>) -> AppResult<Vec<ContentItem>> {
    local::add_files(&state, &instance_id, kind, &paths).await
}

#[tauri::command]
pub async fn content_check_updates(state: State<'_, AppState>, instance_id: String) -> AppResult<Vec<ContentUpdate>> {
    install::check_updates(&state, &instance_id).await
}

/// Gibt Task-ID zurück. Leere Liste = alle verfügbaren Updates.
#[tauri::command]
pub async fn content_update(state: State<'_, AppState>, instance_id: String, file_names: Vec<String>) -> AppResult<String> {
    state.instances.get(&instance_id)?;
    let st = state.inner().clone();
    let iid = instance_id.clone();
    Ok(state.tasks.spawn("content", "Inhalte aktualisieren", Some(instance_id), move |task| install::run_update(st, task, iid, file_names)))
}

#[tauri::command]
pub async fn worlds_list(state: State<'_, AppState>, instance_id: String) -> AppResult<Vec<World>> {
    worlds::list(&state, &instance_id).await
}

#[tauri::command]
pub async fn world_delete(state: State<'_, AppState>, instance_id: String, folder: String) -> AppResult<()> {
    worlds::delete(&state, &instance_id, &folder).await
}

/// Modpack von Modrinth/CurseForge als neue Instanz installieren. Gibt Task-ID zurück.
#[tauri::command]
pub async fn modpack_install(state: State<'_, AppState>, source: Source, project_id: String, version_id: Option<String>) -> AppResult<String> {
    if source == Source::Curseforge {
        curseforge::key(&state)?;
    }
    let st = state.inner().clone();
    Ok(state.tasks.spawn("import", "Modpack installieren", None, move |task| import::run_modpack_install(st, task, source, project_id, version_id)))
}

/// Datei (.mrpack, CurseForge-.zip, .vlpack, Prism/MultiMC-.zip) analysieren.
#[tauri::command]
pub async fn import_preview(_state: State<'_, AppState>, path: String) -> AppResult<ImportPreview> {
    import::preview(&path).await
}

/// Datei als neue Instanz importieren. Gibt Task-ID zurück.
#[tauri::command]
pub async fn import_pack(state: State<'_, AppState>, path: String, name: Option<String>) -> AppResult<String> {
    if !std::path::Path::new(&path).is_file() {
        return Err(AppError::NotFound(path));
    }
    let st = state.inner().clone();
    let title = std::path::Path::new(&path).file_name().map(|n| format!("{} importieren", n.to_string_lossy())).unwrap_or_else(|| "Importieren".into());
    Ok(state.tasks.spawn("import", title, None, move |task| import::run_import_task(st, task, path, name)))
}

/// Dateien/Ordner im Spielordner, die für einen Export infrage kommen.
#[tauri::command]
pub async fn export_entries(state: State<'_, AppState>, instance_id: String) -> AppResult<Vec<ExportEntry>> {
    export::entries(&state, &instance_id).await
}

/// Instanz exportieren. Gibt Task-ID zurück.
#[tauri::command]
pub async fn export_instance(state: State<'_, AppState>, instance_id: String, options: ExportOptions) -> AppResult<String> {
    let inst = state.instances.get(&instance_id)?;
    let st = state.inner().clone();
    let iid = instance_id.clone();
    Ok(state.tasks.spawn("export", format!("{} exportieren", inst.name), Some(instance_id), move |task| export::run_export(st, task, iid, options)))
}

/// Dateien, die manuell heruntergeladen werden müssen (z. B. nach CurseForge-Import).
/// Bereits vorhandene Dateien (vom Nutzer in den Ordner gelegt) werden nicht mehr gelistet.
#[tauri::command]
pub async fn content_missing(state: State<'_, AppState>, instance_id: String) -> AppResult<Vec<MissingDownload>> {
    missing::list(&state, &instance_id).await
}

/// Liste der fehlenden Downloads verwerfen.
#[tauri::command]
pub async fn content_missing_dismiss(state: State<'_, AppState>, instance_id: String) -> AppResult<()> {
    state.instances.get(&instance_id)?;
    missing::dismiss(&state.paths, &instance_id)
}
