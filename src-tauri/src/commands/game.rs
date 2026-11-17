//! OWNER: Game-Agent.
use crate::error::{AppError, AppResult};
use crate::instance::LoaderKind;
use crate::minecraft::{self, java, loaders, logs, GameState, JavaInstall, LoaderVersion, LogFile, LogLine, McVersion, MclogsResult};
use crate::state::AppState;
use tauri::State;

/// Alle Minecraft-Versionen (neueste zuerst). `refresh` erzwingt Neuladen des Manifests.
#[tauri::command]
pub async fn game_versions(state: State<'_, AppState>, refresh: Option<bool>) -> AppResult<Vec<McVersion>> {
    let m = minecraft::meta::manifest(&state, refresh.unwrap_or(false)).await?;
    Ok(m.versions.into_iter().map(|v| McVersion { id: v.id, kind: v.kind, release_time: v.release_time }).collect())
}

/// Minecraft-Versionen, die ein Loader unterstützt (neueste zuerst).
#[tauri::command]
pub async fn loader_game_versions(state: State<'_, AppState>, loader: LoaderKind) -> AppResult<Vec<String>> {
    loaders::game_versions(&state, loader).await
}

/// Loader-Versionen für eine Minecraft-Version (neueste/empfohlene zuerst).
#[tauri::command]
pub async fn loader_versions(state: State<'_, AppState>, loader: LoaderKind, mc_version: String) -> AppResult<Vec<LoaderVersion>> {
    loaders::loader_versions(&state, loader, &mc_version).await
}

/// Installation/Reparatur einer Instanz als Hintergrundaufgabe. Gibt Task-ID zurück.
#[tauri::command]
pub async fn instance_install(state: State<'_, AppState>, id: String, force: Option<bool>) -> AppResult<String> {
    let inst = state.instances.get(&id)?;
    if state.game.is_running(&id) {
        return Err(AppError::Invalid("Die Instanz läuft gerade – bitte zuerst beenden.".into()));
    }
    let force = force.unwrap_or(false);
    let st = state.inner().clone();
    let title = if force { format!("{} wird repariert", inst.name) } else { format!("{} wird installiert", inst.name) };
    let iid = id.clone();
    Ok(state.tasks.spawn("install", title, Some(id), move |task| async move {
        minecraft::install_instance_opts(&st, &iid, &task.sub(0.0, 1.0), force).await.map(|_| ())
    }))
}

/// Instanz starten (installiert bei Bedarf). Gibt Task-ID der Vorbereitung zurück.
#[tauri::command]
pub async fn instance_launch(state: State<'_, AppState>, id: String, account_id: Option<String>) -> AppResult<String> {
    let inst = state.instances.get(&id)?;
    state.game.begin(&id)?;
    let st = state.inner().clone();
    let iid = id.clone();
    let task_id = state.tasks.spawn("launch", format!("{} wird gestartet", inst.name), Some(id.clone()), move |task| async move {
        let r = minecraft::launch::launch(&st, &iid, account_id, &task).await;
        if let Err(e) = &r {
            st.game.fail(&iid, e);
        }
        r
    });
    state.game.set_task(&id, &task_id);
    Ok(task_id)
}

#[tauri::command]
pub async fn instance_kill(state: State<'_, AppState>, id: String) -> AppResult<()> {
    state.game.kill(&state, &id)
}

#[tauri::command]
pub async fn game_states(state: State<'_, AppState>) -> AppResult<Vec<GameState>> {
    Ok(state.game.states())
}

/// Log-Zeilen der aktuellen/letzten Sitzung (Puffer im Speicher).
#[tauri::command]
pub async fn instance_log_session(state: State<'_, AppState>, id: String) -> AppResult<Vec<LogLine>> {
    Ok(state.game.session_log(&id))
}

/// Log-Dateien und Crash-Reports im Spielordner.
#[tauri::command]
pub async fn instance_log_files(state: State<'_, AppState>, id: String) -> AppResult<Vec<LogFile>> {
    state.instances.get(&id)?;
    let dir = state.paths.game_dir(&id);
    Ok(tokio::task::spawn_blocking(move || logs::list_files(&dir)).await?)
}

/// Inhalt einer Log-Datei (entpackt .gz automatisch).
#[tauri::command]
pub async fn instance_log_read(state: State<'_, AppState>, id: String, name: String) -> AppResult<String> {
    state.instances.get(&id)?;
    let dir = state.paths.game_dir(&id);
    tokio::task::spawn_blocking(move || logs::read_file(&dir, &name)).await?
}

/// Log zu mclo.gs hochladen.
#[tauri::command]
pub async fn mclogs_upload(state: State<'_, AppState>, content: String) -> AppResult<MclogsResult> {
    logs::mclogs_upload(&state, &content).await
}

/// Gefundene Java-Installationen (System + vom Launcher verwaltet).
#[tauri::command]
pub async fn java_list(state: State<'_, AppState>) -> AppResult<Vec<JavaInstall>> {
    Ok(java::list(&state).await)
}

/// Java-Pfad prüfen.
#[tauri::command]
pub async fn java_test(state: State<'_, AppState>, path: String) -> AppResult<JavaInstall> {
    let p = java::normalize_java_path(std::path::Path::new(path.trim()))
        .ok_or_else(|| AppError::Invalid(format!("Unter „{path}“ wurde keine Java-Installation gefunden.")))?;
    let managed = p.starts_with(state.paths.java_root());
    java::probe(&p, managed).await
}

/// Java-Hauptversion herunterladen. Gibt Task-ID zurück.
#[tauri::command]
pub async fn java_install(state: State<'_, AppState>, major: u32) -> AppResult<String> {
    if !(8..=99).contains(&major) {
        return Err(AppError::Invalid(format!("Java {major} gibt es nicht")));
    }
    let st = state.inner().clone();
    Ok(state.tasks.spawn("java", format!("Java {major} wird installiert"), None, move |task| async move {
        let p = java::install_major(&st, major, Some(&task.sub(0.0, 1.0))).await?;
        java::probe(&p, true).await?;
        Ok(())
    }))
}
