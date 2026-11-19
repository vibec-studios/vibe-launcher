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
) -> AppResult<String> {
    // NoRisk-Profile: Kennung `<spielordner>#<profil-id>`; der Ordner fehlt bei nie gestarteten Profilen
    if source != LauncherKind::Norisk && !std::path::Path::new(&source_path).is_dir() {
        return Err(AppError::NotFound(source_path));
    }
    let st = state.inner().clone();
    let title = std::path::Path::new(&source_path).file_name().map(|n| format!("{} übernehmen", n.to_string_lossy())).unwrap_or_else(|| "Instanz übernehmen".into());
    Ok(state.tasks.spawn("import", title, None, move |task| external::run_import(st, task, source, source_path, name, mc_version, loader)))
}

/// Version eines Inhalts fixieren (kein Auto-Update, nicht bei „Alle aktualisieren“) oder lösen.
#[tauri::command]
pub async fn content_set_pinned(state: State<'_, AppState>, instance_id: String, kind: ContentKind, file_name: String, pinned: bool) -> AppResult<ContentItem> {
    autoupdate::set_pinned(&state, &instance_id, kind, &file_name, pinned).await
}

/// Anzahl verfügbarer Updates je Instanz (Hintergrundprüfung, höchstens alle 30 min; danach `content://changed`).
#[tauri::command]
pub async fn content_update_counts(state: State<'_, AppState>) -> AppResult<std::collections::HashMap<String, u32>> {
    Ok(autoupdate::update_counts(&state).await)
}

/// Konfigurierte Stores (Standard-Store immer enthalten) mit Name/Icon/Projektanzahl aus der Datei.
#[tauri::command]
pub async fn stores_list(state: State<'_, AppState>) -> AppResult<Vec<store::StoreInfo>> {
    Ok(store::list(&state).await)
}

/// Store per URL hinzufügen (lädt und prüft die Datei).
#[tauri::command]
pub async fn store_add(state: State<'_, AppState>, url: String) -> AppResult<store::StoreInfo> {
    store::add(&state, &url).await
}

#[tauri::command]
pub async fn store_remove(state: State<'_, AppState>, id: String) -> AppResult<()> {
    store::remove(&state, &id)
}

#[tauri::command]
pub async fn store_set_enabled(state: State<'_, AppState>, id: String, enabled: bool) -> AppResult<()> {
    store::set_enabled(&state, &id, enabled)
}

// ---------------------------------------------------------------- Modpack-Updates

/// Neuere Version des Modpacks dieser Instanz (oder `null`).
#[tauri::command]
pub async fn modpack_check(state: State<'_, AppState>, instance_id: String) -> AppResult<Option<modpack::ModpackUpdate>> {
    modpack::check(&state, &instance_id).await
}

/// Änderungen eines Modpack-Updates (Dateien, Overrides, Version/Loader). `version_id = None` -> neueste.
#[tauri::command]
pub async fn modpack_update_preview(state: State<'_, AppState>, instance_id: String, version_id: Option<String>) -> AppResult<modpack::ModpackPreview> {
    modpack::preview(&state, &instance_id, version_id).await
}

/// Modpack aktualisieren (vorher automatischer Snapshot). Gibt Task-ID zurück.
#[tauri::command]
pub async fn modpack_update(state: State<'_, AppState>, instance_id: String, version_id: Option<String>) -> AppResult<String> {
    let inst = state.instances.get(&instance_id)?;
    let st = state.inner().clone();
    let iid = instance_id.clone();
    Ok(state.tasks.spawn("update", format!("{} aktualisieren", inst.name), Some(instance_id), move |task| modpack::run_update(st, task, iid, version_id)))
}

// ---------------------------------------------------------------- Abhängigkeiten, Seiten

/// Abhängigkeits-Check der Mods (fehlend, Versionen, Konflikte, Loader, Duplikate) mit Lösungsvorschlägen.
#[tauri::command]
pub async fn content_check_deps(state: State<'_, AppState>, instance_id: String) -> AppResult<Vec<deps::DepIssue>> {
    deps::check(&state, &instance_id, true).await
}

// ---------------------------------------------------------------- Probleme beheben (Autofix)

/// Behebbare Probleme der Instanz als Plan (Abhängigkeiten, Konflikte, letzte Crash-Analyse).
#[tauri::command]
pub async fn autofix_plan(state: State<'_, AppState>, instance_id: String, crash_report: Option<String>, exit_code: Option<i32>) -> AppResult<autofix::FixPlan> {
    autofix::plan(&state, &instance_id, crash_report, exit_code).await
}

/// Gewählte Schritte ausführen (vorher Snapshot). Gibt die Task-ID zurück; Ergebnis über `autofix_last`.
#[tauri::command]
pub async fn autofix_apply(state: State<'_, AppState>, instance_id: String, actions: Vec<autofix::FixAction>) -> AppResult<String> {
    state.instances.get(&instance_id)?;
    let st = state.inner().clone();
    let iid = instance_id.clone();
    Ok(state.tasks.spawn("autofix", "Probleme beheben", Some(instance_id), move |task| autofix::run_apply(st, task, iid, actions)))
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

// ---------------------------------------------------------------- Mod-Sets

#[tauri::command]
pub async fn modsets_list(state: State<'_, AppState>, instance_id: String) -> AppResult<modsets::ModSets> {
    modsets::list(&state, &instance_id).await
}

/// Neues Set aus dem aktuellen Zustand (wird aktiv).
#[tauri::command]
pub async fn modset_create(state: State<'_, AppState>, instance_id: String, name: String) -> AppResult<modsets::ModSets> {
    modsets::create(&state, &instance_id, &name).await
}

/// Set anwenden (aktiviert/deaktiviert Inhalte).
#[tauri::command]
pub async fn modset_apply(state: State<'_, AppState>, instance_id: String, set_id: String) -> AppResult<modsets::ModSets> {
    modsets::apply(&state, &instance_id, &set_id).await
}

/// Aktuellen Zustand in ein Set übernehmen.
#[tauri::command]
pub async fn modset_save(state: State<'_, AppState>, instance_id: String, set_id: String) -> AppResult<modsets::ModSets> {
    modsets::overwrite(&state, &instance_id, &set_id).await
}

#[tauri::command]
pub async fn modset_rename(state: State<'_, AppState>, instance_id: String, set_id: String, name: String) -> AppResult<modsets::ModSets> {
    modsets::rename(&state, &instance_id, &set_id, &name).await
}

#[tauri::command]
pub async fn modset_delete(state: State<'_, AppState>, instance_id: String, set_id: String) -> AppResult<modsets::ModSets> {
    modsets::delete(&state, &instance_id, &set_id).await
}

// ---------------------------------------------------------------- Performance

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
