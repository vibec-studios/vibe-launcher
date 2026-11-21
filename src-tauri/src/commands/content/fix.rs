use super::*;

/// Abhängigkeits-Check der Mods (fehlend, Versionen, Konflikte, Loader, Duplikate) mit Lösungsvorschlägen.
#[tauri::command]
pub async fn content_check_deps(state: State<'_, AppState>, instance_id: String) -> AppResult<Vec<deps::DepIssue>> {
    deps::check(&state, &instance_id, true).await
}

/// Behebbare Probleme der Instanz als Plan (Abhängigkeiten, Konflikte, letzte Crash-Analyse).
/// `ignore_crash`: nur statisch prüfen (Nachprüfung nach dem Beheben).
#[tauri::command]
pub async fn autofix_plan(
    state: State<'_, AppState>,
    instance_id: String,
    crash_report: Option<String>,
    exit_code: Option<i32>,
    ignore_crash: Option<bool>,
) -> AppResult<autofix::FixPlan> {
    autofix::plan(&state, &instance_id, crash_report, exit_code, ignore_crash.unwrap_or(false)).await
}

/// Gewählte Schritte ausführen (vorher Snapshot). Gibt die Task-ID zurück; Ergebnis über `autofix_last`.
#[tauri::command]
pub async fn autofix_apply(state: State<'_, AppState>, instance_id: String, actions: Vec<autofix::FixAction>, backup: Option<crate::settings::FixBackup>) -> AppResult<String> {
    state.instances.get(&instance_id)?;
    let st = state.inner().clone();
    let iid = instance_id.clone();
    Ok(state.tasks.spawn("autofix", "Probleme beheben", Some(instance_id), move |task| autofix::run_apply(st, task, iid, actions, backup)))
}

#[tauri::command]
pub async fn autofix_last(state: State<'_, AppState>, instance_id: String) -> AppResult<Option<autofix::FixReport>> {
    state.instances.get(&instance_id)?;
    Ok(autofix::last_report(&state, &instance_id))
}

/// Letzten Durchlauf rückgängig machen (Snapshot wiederherstellen, Java/RAM zurück). Gibt die Task-ID zurück.
#[tauri::command]
pub async fn autofix_undo(state: State<'_, AppState>, instance_id: String) -> AppResult<String> {
    state.instances.get(&instance_id)?;
    let st = state.inner().clone();
    let iid = instance_id.clone();
    Ok(state.tasks.spawn("autofix", "Probleme beheben rückgängig machen", Some(instance_id), move |task| autofix::run_undo(st, task, iid)))
}

/// „Neu prüfen“: Ordner neu einlesen, Updates ohne Cache prüfen, Probleme (inkl. Loader) neu berechnen.
#[tauri::command]
pub async fn instance_refresh(state: State<'_, AppState>, instance_id: String) -> AppResult<crate::content::refresh::RefreshReport> {
    crate::content::refresh::run(&state, &instance_id).await
}

/// Schnelle Prüfung ohne Netz (vor dem Start).
#[tauri::command]
pub async fn autofix_quick(state: State<'_, AppState>, instance_id: String) -> AppResult<autofix::QuickCheck> {
    autofix::quick(&state, &instance_id).await
}

/// Client/Server-Einordnung aller Inhalte (lädt fehlende Angaben nach).
#[tauri::command]
pub async fn content_sides(state: State<'_, AppState>, instance_id: String) -> AppResult<Vec<sides::SideInfo>> {
    sides::classify(&state, &instance_id).await
}

/// Passende Performance-Mods (Modrinth) für Loader/Version der Instanz.
#[tauri::command]
pub async fn perf_preview(state: State<'_, AppState>, instance_id: String) -> AppResult<Vec<perf::PerfCandidate>> {
    perf::preview(&state, &instance_id).await
}

/// Ausgewählte Performance-Mods installieren (vorher Snapshot). Gibt Task-ID zurück.
#[tauri::command]
pub async fn perf_install(state: State<'_, AppState>, instance_id: String, project_ids: Vec<String>) -> AppResult<String> {
    state.instances.get(&instance_id)?;
    let st = state.inner().clone();
    let iid = instance_id.clone();
    Ok(state.tasks.spawn("content", "Performance-Mods installieren", Some(instance_id), move |task| perf::run_install(st, task, iid, project_ids)))
}
