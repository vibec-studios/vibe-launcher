use super::*;

/// Modpack von Modrinth/CurseForge als neue Instanz installieren. Gibt Task-ID zurück.
#[tauri::command]
pub async fn modpack_install(state: State<'_, AppState>, source: Source, project_id: String, version_id: Option<String>) -> AppResult<String> {
    if source == Source::Curseforge {
        curseforge::key(&state)?;
    }
    crate::util::spacecheck::for_modpack(&state.paths).await?;
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
    crate::util::spacecheck::for_pack_file(&state.paths, std::path::Path::new(&path)).await?;
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

/// Andere Launcher an den Standardorten (Modrinth App, Prism, CurseForge, ATLauncher) mit ihren Instanzen.
#[tauri::command]
pub async fn launchers_detect(state: State<'_, AppState>) -> AppResult<Vec<ExternalLauncher>> {
    external::detect(&state).await
}

/// Frei gewählten Ordner analysieren (Launcher-Ordner, Instanzen-Ordner, einzelne Instanz oder Spielordner).
#[tauri::command]
pub async fn launcher_scan_dir(state: State<'_, AppState>, path: String) -> AppResult<ExternalLauncher> {
    external::scan_dir(&state, path).await
}

/// Instanz aus einem anderen Launcher kopieren (Original bleibt unverändert). Gibt Task-ID zurück.
/// `mc_version`/`loader` überschreiben erkannte bzw. geschätzte Werte.
#[tauri::command]
pub async fn import_external(
    state: State<'_, AppState>,
    source: LauncherKind,
    source_path: String,
    name: Option<String>,
    mc_version: Option<String>,
    loader: Option<crate::instance::Loader>,
    settings: Option<Vec<String>>,
) -> AppResult<String> {
    // NoRisk-Profile: Kennung `<spielordner>#<profil-id>`; der Ordner fehlt bei nie gestarteten Profilen
    if source != LauncherKind::Norisk && !std::path::Path::new(&source_path).is_dir() {
        return Err(AppError::NotFound(source_path));
    }
    crate::util::spacecheck::for_launcher_import(&state.paths, &source_path).await?;
    let st = state.inner().clone();
    let title = std::path::Path::new(&source_path).file_name().map(|n| format!("{} übernehmen", n.to_string_lossy())).unwrap_or_else(|| "Instanz übernehmen".into());
    Ok(state.tasks.spawn("import", title, None, move |task| external::run_import(st, task, source, source_path, name, mc_version, loader, settings)))
}

/// Importierte Instanzen, deren Einstellungen im Ursprungs-Launcher abweichen (für den Hinweis „Einstellungen übernehmen“).
#[tauri::command]
pub async fn import_settings_pending(state: State<'_, AppState>) -> AppResult<Vec<extsettings::SettingsOffer>> {
    extsettings::pending(&state).await
}

/// Einstellungen + Dateien, die sich für eine importierte Instanz übernehmen ließen (`null`: keine Quelle).
#[tauri::command]
pub async fn import_settings_offer(state: State<'_, AppState>, instance_id: String) -> AppResult<Option<extsettings::SettingsOffer>> {
    extsettings::offer(&state, &instance_id).await
}

/// Gewählte Einstellungen (`keys`) übernehmen; `data` kopiert gewählte Ordner/Dateien im Hintergrund (nur Fehlendes,
/// Überschreiben nur mit `overwrite`; vorher Snapshot bzw. Welt-Backup).
#[tauri::command]
pub async fn import_report(state: State<'_, AppState>, instance_id: String) -> AppResult<Option<crate::content::importreport::ImportReport>> {
    state.instances.get(&instance_id)?;
    Ok(crate::content::importreport::load(&state, &instance_id))
}

#[tauri::command]
pub async fn import_settings_apply(
    state: State<'_, AppState>,
    instance_id: String,
    keys: Vec<String>,
    data: Option<Vec<crate::content::gamedata::DataPick>>,
) -> AppResult<crate::instance::Instance> {
    extsettings::apply_offer(&state, &instance_id, keys, data.unwrap_or_default()).await
}
