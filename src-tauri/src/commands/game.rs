//! OWNER: Game-Agent.
use crate::error::{AppError, AppResult};
use crate::instance::LoaderKind;
use crate::minecraft::sessions::BeginOpts;
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

#[tauri::command]
pub async fn instance_version_preview(
    state: State<'_, AppState>, id: String, target: crate::content::migration::GameVersion,
) -> AppResult<crate::content::migration::Preview> {
    crate::content::migration::preview(&state, &id, target).await
}

#[tauri::command]
pub async fn instance_version_apply(
    state: State<'_, AppState>, id: String, target: crate::content::migration::GameVersion, token: String,
) -> AppResult<String> {
    crate::content::migration::start(&state, id, target, token).await
}

/// Installation/Reparatur einer Instanz als Hintergrundaufgabe. Gibt Task-ID zurück.
#[tauri::command]
pub async fn instance_install(state: State<'_, AppState>, id: String, force: Option<bool>) -> AppResult<String> {
    let lock = state.content.lock(&id);
    let _guard = lock.lock().await;
    crate::content::migration::guard(&state, &id)?;
    let inst = state.instances.get(&id)?;
    if inst.is_bedrock() {
        return Err(AppError::Invalid("Bedrock wird über den Microsoft Store installiert und aktualisiert.".into()));
    }
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
pub async fn instance_launch(
    state: State<'_, AppState>,
    id: String,
    account_id: Option<String>,
    world: Option<String>,
    server: Option<String>,
    offline: Option<bool>,
    afk: Option<bool>,
) -> AppResult<String> {
    crate::content::migration::guard(&state, &id)?;
    let inst = state.instances.get(&id)?;
    let afk = afk == Some(true);
    if afk && (inst.is_bedrock() || !state.settings().afk.enabled) {
        return Err(AppError::Invalid("Der Hintergrund-Start (AFK) ist für diese Instanz nicht verfügbar.".into()));
    }
    // Bedrock: eigener Ablauf (kein Java, kein Account – das Spiel meldet sich selbst bei Xbox an)
    if inst.is_bedrock() {
        return crate::bedrock::game::start(&state, &id);
    }
    // Quick Play: nur ein Ordnername unter saves/, nichts anderes
    let world = world.filter(|w| !w.trim().is_empty());
    if let Some(w) = &world {
        if w.contains(['/', '\\', ':']) || w == "." || w == ".." {
            return Err(AppError::Invalid("Ungültiger Weltname".into()));
        }
    }
    // Direkt auf einen Server: Adresse streng prüfen
    let server = server.filter(|s| !s.trim().is_empty());
    if let Some(s) = &server {
        crate::platform::servers::parse_address(s)?;
    }
    // Ohne Account gar nicht erst installieren/laden – sofort verständlich melden.
    let dev_offline = cfg!(debug_assertions) && std::env::var_os("VIBE_DEV_OFFLINE_ACCOUNT").is_some();
    if state.auth.list().is_empty() && !dev_offline {
        return Err(AppError::NotConfigured("Kein Account – bitte unter Accounts mit Microsoft anmelden".into()));
    }
    let _launch_gate = state.content.launch_gate(&id).try_lock_owned()
        .map_err(|_| AppError::Invalid("Diese Instanz wird gerade geändert. Versuche es gleich erneut.".into()))?;
    let lock = state.content.lock(&id);
    let guard = lock.lock().await;
    crate::content::migration::guard(&state, &id)?;
    let run = state.game.begin_with(&id, BeginOpts { exclusive: false, world: world.as_deref(), server: server.as_deref() })?;
    drop(guard);
    if afk {
        crate::afk::request(&state, &run)?;
    }
    if offline == Some(true) {
        state.auth.grant_offline(account_id.as_deref());
    }
    crate::platform::on_launch(&state, &id, &run, world.clone(), server.clone());
    crate::console::on_launch(&state, &run);
    let st = state.inner().clone();
    let iid = id.clone();
    let rid = run.clone();
    let offer_account = account_id.clone();
    let task_id = state.tasks.spawn("launch", format!("{} wird gestartet", inst.name), Some(id.clone()), move |task| async move {
        let r = minecraft::launch::launch(&st, &iid, &rid, account_id, world, server, &task).await;
        if let Err(e) = &r {
            st.game.fail(&rid, e);
            if let AppError::OfflineAvailable(message) = e {
                let payload = serde_json::json!({ "instance_id": iid, "account_id": offer_account, "message": message });
                crate::events::emit(&st.app, crate::events::AUTH_OFFLINE_AVAILABLE, &payload);
            }
        }
        r
    });
    state.game.set_task(&run, &task_id);
    Ok(task_id)
}

/// Spiel beenden: mit `run_id` nur diese Sitzung, sonst alle Sitzungen der Instanz.
#[tauri::command]
pub async fn instance_kill(state: State<'_, AppState>, id: String, run_id: Option<String>) -> AppResult<()> {
    if state.instances.get(&id).is_ok_and(|i| i.is_bedrock()) {
        return crate::bedrock::game::kill(&state, &id);
    }
    let key = run_id.filter(|r| state.game.state_of(r).is_some_and(|s| s.instance_id == id)).unwrap_or(id);
    state.game.kill(&state, &key)
}

/// Konsolenfenster öffnen (optional direkt mit dieser Sitzung).
#[tauri::command]
pub async fn console_open(state: State<'_, AppState>, run_id: Option<String>) -> AppResult<()> {
    crate::console::open(&state.app, run_id.as_deref())
}

#[tauri::command]
pub async fn game_states(state: State<'_, AppState>) -> AppResult<Vec<GameState>> {
    Ok(state.game.states())
}

/// Log-Zeilen einer Sitzung (`run_id`) bzw. der aktuellen/letzten Sitzung der Instanz (Puffer im Speicher).
#[tauri::command]
pub async fn instance_log_session(state: State<'_, AppState>, id: String, run_id: Option<String>) -> AppResult<Vec<LogLine>> {
    Ok(state.game.session_log(run_id.as_deref().unwrap_or(&id)))
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

#[tauri::command]
pub async fn mclogs_preview(content: String) -> AppResult<String> {
    tokio::task::spawn_blocking(move || logs::prepare_for_mclogs(&content, &crate::feedback::redact::Known::from_env()))
        .await
        .map_err(|e| AppError::msg(e.to_string()))
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
