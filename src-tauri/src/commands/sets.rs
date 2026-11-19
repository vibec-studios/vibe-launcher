//! OWNER: Content-Agent. Mod-Sets (instanzübergreifende Wunschlisten), siehe `content/sets.rs` und
//! `content/sets_apply.rs`.
use crate::content::sets::{self, ImportResult, InstanceCandidates, ModSet, ModSetInfo, ParsedLine, SetEntry};
use crate::content::sets_apply::{self, Pick, SetCheck, SetCompat, SetNews, SetPreview};
use crate::error::AppResult;
use crate::instance::LoaderKind;
use crate::state::AppState;
use tauri::State;

#[tauri::command]
pub async fn sets_list(state: State<'_, AppState>) -> AppResult<Vec<ModSetInfo>> {
    Ok(sets::list(&state))
}

#[tauri::command]
pub async fn sets_create(state: State<'_, AppState>, name: String, description: Option<String>, entries: Vec<SetEntry>) -> AppResult<ModSet> {
    sets::create(&state.paths, &name, description, entries)
}

/// Name und/oder Beschreibung ändern (`None` = unverändert, leere Beschreibung = entfernen).
#[tauri::command]
pub async fn sets_update(state: State<'_, AppState>, id: String, name: Option<String>, description: Option<String>) -> AppResult<ModSet> {
    sets::update(&state.paths, &id, name, description)
}

#[tauri::command]
pub async fn sets_delete(state: State<'_, AppState>, id: String) -> AppResult<()> {
    sets::delete(&state.paths, &id)
}

#[tauri::command]
pub async fn sets_duplicate(state: State<'_, AppState>, id: String) -> AppResult<ModSet> {
    sets::duplicate(&state.paths, &id)
}

#[tauri::command]
pub async fn sets_add_entries(state: State<'_, AppState>, id: String, entries: Vec<SetEntry>) -> AppResult<ModSet> {
    sets::add_entries(&state.paths, &id, entries)
}

/// `keys`: `quelle:projekt-id`
#[tauri::command]
pub async fn sets_remove_entries(state: State<'_, AppState>, id: String, keys: Vec<String>) -> AppResult<ModSet> {
    sets::remove_entries(&state.paths, &id, &keys)
}

/// Liste von Links/Slugs/Namen (eine pro Zeile) erkennen und auflösen.
#[tauri::command]
pub async fn sets_parse_list(state: State<'_, AppState>, text: String) -> AppResult<Vec<ParsedLine>> {
    sets::parse_list(&state, &text).await
}

/// Code, Set-Datei-Inhalt oder Linkliste importieren (legt noch nichts an).
#[tauri::command]
pub async fn sets_import_text(state: State<'_, AppState>, text: String) -> AppResult<ImportResult> {
    sets::import_text(&state, &text).await
}

#[tauri::command]
pub async fn sets_import_file(state: State<'_, AppState>, path: String) -> AppResult<ImportResult> {
    sets::import_file(&state, &path).await
}

#[tauri::command]
pub async fn sets_export_file(state: State<'_, AppState>, id: String, path: String) -> AppResult<()> {
    sets::export_file(&state.paths, &id, &path)
}

#[tauri::command]
pub async fn sets_export_code(state: State<'_, AppState>, id: String) -> AppResult<String> {
    sets::export_code(&state.paths, &id)
}

#[tauri::command]
pub async fn sets_export_links(state: State<'_, AppState>, id: String) -> AppResult<String> {
    sets::export_links(&state.paths, &id)
}

/// Inhalte einer Instanz, die als Set übernommen werden können.
#[tauri::command]
pub async fn sets_instance_candidates(state: State<'_, AppState>, instance_id: String) -> AppResult<InstanceCandidates> {
    sets::instance_candidates(&state, &instance_id).await
}

/// Profil einer Instanz (früher „Mod-Set“) als globales Mod-Set übernehmen. Gibt das Set und die Zahl
/// übersprungener Dateien ohne Herkunft zurück.
#[tauri::command]
pub async fn sets_from_profile(state: State<'_, AppState>, instance_id: String, profile_id: String) -> AppResult<(ModSet, usize)> {
    crate::content::modsets::to_global_set(&state, &instance_id, &profile_id).await
}

/// Vorschau: was würde installiert, was ist schon da, was gibt es nicht (mit Grund/Alternativen).
#[tauri::command]
pub async fn sets_preview(state: State<'_, AppState>, instance_id: String, set_ids: Vec<String>, only: Option<Vec<String>>) -> AppResult<SetPreview> {
    sets_apply::preview(&state, &instance_id, &set_ids, only).await
}

/// Ausgewählte Projekte installieren (vorher Sicherung). Gibt Task-ID zurück.
#[tauri::command]
pub async fn sets_apply(state: State<'_, AppState>, instance_id: String, set_ids: Vec<String>, picks: Vec<Pick>) -> AppResult<String> {
    state.instances.get(&instance_id)?;
    let st = state.inner().clone();
    let iid = instance_id.clone();
    Ok(state.tasks.spawn("content", "Mod-Set anwenden", Some(instance_id), move |task| sets_apply::run_apply(st, task, iid, set_ids, Some(picks), true)))
}

/// Neue Instanz: alles Passende aus den Sets installieren (ohne Vorschau, ohne Sicherung). Task-ID.
#[tauri::command]
pub async fn sets_install_new(state: State<'_, AppState>, instance_id: String, set_ids: Vec<String>) -> AppResult<String> {
    state.instances.get(&instance_id)?;
    let st = state.inner().clone();
    let iid = instance_id.clone();
    Ok(state.tasks.spawn("content", "Mod-Sets installieren", Some(instance_id), move |task| sets_apply::run_apply(st, task, iid, set_ids, None, false)))
}

/// Verfügbarkeit für eine geplante Instanz (Neue Instanz).
#[tauri::command]
pub async fn sets_check(state: State<'_, AppState>, set_ids: Vec<String>, mc_version: String, loader: LoaderKind) -> AppResult<SetCheck> {
    sets_apply::check(&state, &set_ids, &mc_version, loader).await
}

#[tauri::command]
pub async fn sets_compat(state: State<'_, AppState>, id: String) -> AppResult<SetCompat> {
    sets_apply::compat(&state, &id).await
}

/// Neue Projekte in Sets, die auf die Instanz angewendet wurden.
#[tauri::command]
pub async fn sets_news(state: State<'_, AppState>, instance_id: String) -> AppResult<Vec<SetNews>> {
    sets_apply::news(&state, &instance_id)
}

/// Neue Projekte nicht installieren (`forget`: Set für diese Instanz nicht mehr verfolgen).
#[tauri::command]
pub async fn sets_dismiss_news(state: State<'_, AppState>, instance_id: String, set_id: String, forget: Option<bool>) -> AppResult<()> {
    sets_apply::dismiss_news(&state, &instance_id, &set_id, forget.unwrap_or(false))
}
