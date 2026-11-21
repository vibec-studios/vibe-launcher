use super::*;

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
    expect_manual: Option<bool>,
) -> AppResult<String> {
    state.instances.get(&instance_id)?;
    if source == Source::Curseforge {
        curseforge::key(&state)?;
    }
    let st = state.inner().clone();
    let iid = instance_id.clone();
    let manual = expect_manual.unwrap_or(false);
    Ok(state.tasks.spawn("content", "Inhalt installieren", Some(instance_id), move |task| {
        install::run_install_with(st, task, iid, source, project_id, version_id, manual)
    }))
}

/// Ziel für „Auf CurseForge herunterladen“: Dateiseite der passenden (oder gewählten) Version.
/// `downloadable = true` -> doch automatisch installierbar (Datei freigegeben bzw. identisch auf Modrinth).
#[tauri::command]
pub async fn content_manual_target(
    state: State<'_, AppState>,
    instance_id: String,
    source: Source,
    project_id: String,
    version_id: Option<String>,
) -> AppResult<ManualTarget> {
    install::manual_target(&state, &instance_id, source, &project_id, version_id.as_deref()).await
}

/// CurseForge-Projekte der Instanz ohne Freigabe für andere Launcher (Projekt-IDs, für die Markierung).
#[tauri::command]
pub async fn content_manual_projects(state: State<'_, AppState>, instance_id: String) -> AppResult<Vec<String>> {
    install::manual_projects(&state, &instance_id).await
}

/// „Ich habe sie heruntergeladen – suchen“: Download-Ordner sofort prüfen (nur Dateien mit passendem Hash
/// werden übernommen) und danach noch einige Minuten beobachten.
#[tauri::command]
pub async fn content_missing_scan(state: State<'_, AppState>, instance_id: String) -> AppResult<MissingScan> {
    missing::scan_now(&state, &instance_id).await
}

/// Download-Ordner für diese Instanz einige Minuten beobachten (nach Klick auf einen Download-Link).
/// Gibt das Ende der Beobachtung zurück (ms seit Epoch), `None` ohne Download-Ordner.
#[tauri::command]
pub async fn content_missing_watch(state: State<'_, AppState>, instance_id: String) -> AppResult<Option<i64>> {
    state.instances.get(&instance_id)?;
    Ok(missing::watch(&state, &instance_id, missing::WATCH_FOR))
}
