//! OWNER: Frontend-Agent A. Commands der Plattform-Funktionen (siehe `platform/`).
use crate::error::{AppError, AppResult};
use crate::platform::{crash, links, optsync, servers, shortcuts, stats, PlatformState};
use crate::state::AppState;
use serde::Serialize;
use std::path::{Path, PathBuf};
use tauri::State;

fn join_err(e: tokio::task::JoinError) -> AppError {
    AppError::msg(e.to_string())
}

// ------------------------------------------------------------------ Crash-Analyse

#[tauri::command]
pub async fn crash_analyze(
    state: State<'_, AppState>,
    instance_id: String,
    crash_report: Option<String>,
    exit_code: Option<i32>,
) -> AppResult<Vec<crash::Diagnosis>> {
    crash::analyze_instance(&state, &instance_id, crash_report, exit_code).await
}

// ------------------------------------------------------------------ Server

fn servers_path(state: &AppState, id: &str) -> AppResult<PathBuf> {
    state.instances.get(id)?;
    Ok(state.paths.game_dir(id).join("servers.dat"))
}

#[tauri::command]
pub async fn instance_servers_list(
    state: State<'_, AppState>,
    instance_id: String,
) -> AppResult<Vec<servers::ServerEntry>> {
    let p = servers_path(&state, &instance_id)?;
    tokio::task::spawn_blocking(move || servers::read_servers(&p))
        .await
        .map_err(join_err)?
}

/// Domain-Umzug: Adressen `*.vibey.henny.dev` in `servers.dat` auf `*.axolite.cc` umstellen. Anzahl geänderter Einträge.
#[tauri::command]
pub async fn instance_servers_modernize(state: State<'_, AppState>, instance_id: String) -> AppResult<usize> {
    if state.game.is_running(&instance_id) {
        return Err(AppError::Invalid("Die Serverliste kann nicht geändert werden, solange das Spiel läuft".into()));
    }
    let p = servers_path(&state, &instance_id)?;
    let n = tokio::task::spawn_blocking(move || servers::modernize_servers_file(&p)).await.map_err(join_err)??;
    if n > 0 {
        crate::events::emit(&state.app, crate::events::CONTENT_CHANGED, &serde_json::json!({ "instance_id": instance_id }));
    }
    Ok(n)
}

#[tauri::command]
pub async fn instance_servers_save(
    state: State<'_, AppState>,
    instance_id: String,
    servers: Vec<servers::ServerEntry>,
) -> AppResult<()> {
    if state.game.is_running(&instance_id) {
        // Das Spiel schreibt servers.dat selbst beim Beenden – sonst gingen Änderungen verloren
        return Err(AppError::Invalid(
            "Die Serverliste kann nicht geändert werden, solange das Spiel läuft".into(),
        ));
    }
    for s in &servers {
        servers::parse_address(&s.ip)?;
        if s.name.chars().count() > 100 {
            return Err(AppError::Invalid("Servername zu lang".into()));
        }
    }
    let p = servers_path(&state, &instance_id)?;
    tokio::task::spawn_blocking(move || servers::write_servers(&p, &servers))
        .await
        .map_err(join_err)??;
    crate::events::emit(
        &state.app,
        crate::events::CONTENT_CHANGED,
        &serde_json::json!({ "instance_id": instance_id }),
    );
    Ok(())
}

#[tauri::command]
pub async fn server_ping(address: String) -> AppResult<servers::ServerStatus> {
    servers::parse_address(&address)?;
    Ok(servers::ping(&address).await)
}

#[derive(Serialize)]
pub struct RecentServer {
    pub address: String,
    pub instance_id: String,
    pub last_played: i64,
    pub play_time_secs: i64,
}

/// Zuletzt gespielte Server (aus der Spielzeit-Statistik), neueste zuerst.
#[tauri::command]
pub async fn servers_recent(
    state: State<'_, AppState>,
    limit: Option<usize>,
) -> AppResult<Vec<RecentServer>> {
    let mut out: Vec<RecentServer> = vec![];
    for s in stats::read(&state.paths.root, None).into_iter().rev() {
        let Some(addr) = s.server else { continue };
        let secs = (s.end - s.start) / 1000;
        match out
            .iter_mut()
            .find(|r| r.address.eq_ignore_ascii_case(&addr))
        {
            Some(r) => r.play_time_secs += secs,
            None => out.push(RecentServer {
                address: addr,
                instance_id: s.instance_id,
                last_played: s.end,
                play_time_secs: secs,
            }),
        }
    }
    out.retain(|r| state.instances.get(&r.instance_id).is_ok());
    out.truncate(limit.unwrap_or(8));
    Ok(out)
}

// ------------------------------------------------------------------ Spielzeit

/// Sitzungen ab `since` (ms); laufende Sitzungen werden bis „jetzt“ mitgezählt.
#[tauri::command]
pub async fn playtime_sessions(
    state: State<'_, AppState>,
    since: Option<i64>,
) -> AppResult<Vec<stats::Session>> {
    let root = state.paths.root.clone();
    let mut list = tokio::task::spawn_blocking(move || stats::read(&root, since))
        .await
        .map_err(join_err)?;
    let now = chrono::Utc::now().timestamp_millis();
    for g in state.game.states() {
        if let (crate::minecraft::RunState::Running, Some(start)) = (&g.state, g.started_at) {
            list.push(stats::Session {
                instance_id: g.instance_id.clone(),
                start,
                end: now,
                world: None,
                server: None,
            });
        }
    }
    Ok(list)
}

// ------------------------------------------------------------------ Synchronisieren (Optionen, Ordner, Server)

#[derive(Serialize)]
pub struct SharedFolder {
    /// resourcepacks | shaderpacks | screenshots | servers
    pub area: String,
    pub count: usize,
    pub size: u64,
}

#[derive(Serialize)]
pub struct InstanceSyncState {
    pub last_sync: Option<i64>,
    pub conflicts: Vec<optsync::ConflictNote>,
    pub errors: Vec<String>,
}

#[derive(Serialize)]
pub struct OptSyncInfo {
    pub config: optsync::SyncConfig,
    /// Bereiche aus options.txt
    pub categories: Vec<String>,
    /// Weitere Bereiche (Ordner, Server-Liste)
    pub areas: Vec<String>,
    /// Anzahl Master-Schlüssel je Kategorie
    pub counts: std::collections::BTreeMap<String, usize>,
    pub shared: Vec<SharedFolder>,
    /// Abgleichstand je Instanz (nur synchronisierte)
    pub states: std::collections::BTreeMap<String, InstanceSyncState>,
}

fn optsync_info(root: &Path) -> OptSyncInfo {
    let config = optsync::SyncConfig::load(&optsync::config_path(root));
    let mut counts = std::collections::BTreeMap::new();
    for k in config.master.keys() {
        if let Some(c) = optsync::category_of(k) {
            *counts.entry(c.to_string()).or_insert(0) += 1;
        }
    }
    if let Some(p) = &config.resource_packs {
        counts.insert("resourcepacks".into(), p.iter().filter(|x| x.starts_with("file/")).count());
    }
    let mut shared: Vec<SharedFolder> = ["resourcepacks", "shaderpacks", "screenshots"]
        .iter()
        .map(|a| {
            let (count, size) = crate::platform::syncdir::summary(&optsync::shared_dir(root, a));
            SharedFolder { area: a.to_string(), count, size }
        })
        .collect();
    shared.push(SharedFolder { area: "servers".into(), count: crate::platform::syncservers::count(&optsync::shared_servers(root)), size: 0 });
    let states = config
        .instances
        .iter()
        .filter(|(_, s)| s.enabled)
        .map(|(id, _)| {
            let st = optsync::InstanceState::load(root, id);
            (id.clone(), InstanceSyncState { last_sync: st.last_sync, conflicts: st.conflicts, errors: st.errors })
        })
        .collect();
    OptSyncInfo {
        config,
        categories: optsync::CATEGORIES.iter().map(|s| s.to_string()).collect(),
        areas: optsync::AREAS.iter().map(|s| s.to_string()).collect(),
        counts,
        shared,
        states,
    }
}

#[tauri::command]
pub async fn optsync_get(state: State<'_, AppState>) -> AppResult<OptSyncInfo> {
    let root = state.paths.root.clone();
    tokio::task::spawn_blocking(move || optsync_info(&root)).await.map_err(join_err)
}

fn check_categories(c: &[String]) -> AppResult<()> {
    if c.iter().all(|x| optsync::known_area(x)) {
        Ok(())
    } else {
        Err(AppError::Invalid("Unbekannter Bereich".into()))
    }
}

/// Einstellungen einer Instanz speichern. Neu gewählte Ordner-/Server-Bereiche werden gleich abgeglichen, wenn die
/// Instanz nicht läuft (sonst nach dem Beenden).
#[tauri::command]
pub async fn optsync_set_instance(
    state: State<'_, AppState>,
    instance_id: String,
    enabled: bool,
    categories: Vec<String>,
) -> AppResult<OptSyncInfo> {
    let inst = state.instances.get(&instance_id)?;
    check_categories(&categories)?;
    let root = state.paths.root.clone();
    let game = state.paths.game_dir(&instance_id);
    let running = state.game.is_running(&instance_id);
    tokio::task::spawn_blocking(move || -> AppResult<OptSyncInfo> {
        let added = optsync::set_instance(&root, &instance_id, enabled, categories)?;
        if !added.is_empty() && !running {
            optsync::sync_now(&root, &game, &instance_id, &inst.name);
        }
        Ok(optsync_info(&root))
    })
    .await
    .map_err(join_err)?
}

/// Master-Profil aus einer Instanz übernehmen (ersetzt die Werte der gewählten Bereiche).
#[tauri::command]
pub async fn optsync_capture(
    state: State<'_, AppState>,
    instance_id: String,
    categories: Vec<String>,
) -> AppResult<OptSyncInfo> {
    let inst = state.instances.get(&instance_id)?;
    check_categories(&categories)?;
    let root = state.paths.root.clone();
    let game = state.paths.game_dir(&instance_id);
    tokio::task::spawn_blocking(move || -> AppResult<OptSyncInfo> {
        optsync::capture_from(&root, &game, &instance_id, &inst.mc_version, &categories)?;
        Ok(optsync_info(&root))
    })
    .await
    .map_err(join_err)?
}

/// Master-Profil sofort auf alle aktivierten (nicht laufenden) Instanzen anwenden. Gibt die Anzahl zurück.
#[tauri::command]
pub async fn optsync_apply_all(state: State<'_, AppState>) -> AppResult<usize> {
    let cfg = optsync::SyncConfig::load(&optsync::config_path(&state.paths.root));
    let targets: Vec<(String, PathBuf, String)> = cfg
        .instances
        .iter()
        .filter(|(id, s)| s.enabled && !state.game.is_running(id))
        .filter_map(|(id, _)| state.instances.get(id).ok().map(|i| (id.clone(), state.paths.game_dir(id), i.mc_version)))
        .collect();
    let root = state.paths.root.clone();
    tokio::task::spawn_blocking(move || optsync::apply_all(&root, &targets)).await.map_err(join_err)?
}

#[derive(Serialize)]
pub struct SyncAllResult {
    pub instances: usize,
    pub changes: usize,
    pub conflicts: usize,
    pub errors: Vec<String>,
    /// Übersprungen, weil sie gerade laufen (Namen)
    pub running: Vec<String>,
}

/// Ordner, Server-Liste und Screenshots jetzt abgleichen – eine Instanz (`instance_id`) oder alle synchronisierten,
/// die nicht laufen. Bei allen zwei Durchgänge, damit jede Instanz auch die Änderungen der anderen bekommt.
#[tauri::command]
pub async fn optsync_sync_now(state: State<'_, AppState>, instance_id: Option<String>) -> AppResult<SyncAllResult> {
    let cfg = optsync::SyncConfig::load(&optsync::config_path(&state.paths.root));
    let ids: Vec<String> = match &instance_id {
        Some(id) => {
            state.instances.get(id)?;
            if state.game.is_running(id) {
                return Err(AppError::Invalid("Die Instanz läuft gerade – abgeglichen wird nach dem Beenden.".into()));
            }
            vec![id.clone()]
        }
        None => cfg.instances.iter().filter(|(_, s)| s.enabled).map(|(id, _)| id.clone()).collect(),
    };
    let mut running = vec![];
    let mut targets = vec![];
    for id in ids {
        let Ok(inst) = state.instances.get(&id) else { continue };
        if state.game.is_running(&id) {
            running.push(inst.name);
        } else {
            targets.push((id.clone(), state.paths.game_dir(&id), inst.name));
        }
    }
    let root = state.paths.root.clone();
    let passes = if instance_id.is_some() { 1 } else { 2 };
    tokio::task::spawn_blocking(move || {
        let mut r = SyncAllResult { instances: targets.len(), changes: 0, conflicts: 0, errors: vec![], running };
        for pass in 0..passes {
            for (id, game, name) in &targets {
                let s = optsync::sync_now(&root, game, id, name);
                r.changes += s.changes + s.screenshots;
                r.conflicts += s.conflicts.len();
                if pass + 1 == passes {
                    r.errors.extend(s.errors.into_iter().map(|e| format!("{name}: {e}")));
                }
            }
        }
        r
    })
    .await
    .map_err(join_err)
}

/// Gemeinsamen Ordner im Explorer öffnen (resourcepacks | shaderpacks | screenshots).
#[tauri::command]
pub async fn optsync_open_folder(state: State<'_, AppState>, area: String) -> AppResult<()> {
    if !["resourcepacks", "shaderpacks", "screenshots"].contains(&area.as_str()) {
        return Err(AppError::Invalid("Unbekannter Bereich".into()));
    }
    let dir = optsync::shared_dir(&state.paths.root, &area);
    std::fs::create_dir_all(&dir)?;
    crate::util::open_in_explorer(&dir)
}

/// Konfliktmeldungen einer Instanz ausblenden.
#[tauri::command]
pub async fn optsync_clear_conflicts(state: State<'_, AppState>, instance_id: String) -> AppResult<OptSyncInfo> {
    let root = state.paths.root.clone();
    tokio::task::spawn_blocking(move || -> AppResult<OptSyncInfo> {
        optsync::clear_conflicts(&root, &instance_id)?;
        Ok(optsync_info(&root))
    })
    .await
    .map_err(join_err)?
}

// ------------------------------------------------------------------ Verknüpfungen, externe Aktionen

#[tauri::command]
pub async fn shortcut_create(
    state: State<'_, AppState>,
    instance_id: String,
    location: String,
) -> AppResult<String> {
    let inst = state.instances.get(&instance_id)?;
    let dir = shortcuts::target_dir(&location)?;
    let icon_src = crate::instance::icon::file_path(inst.icon.as_deref())
        .map(PathBuf::from)
        .filter(|p| p.is_file());
    let cache = state
        .paths
        .cache()
        .join("shortcut-icons")
        .join(format!("{instance_id}.ico"));
    let name = inst.name.clone();
    tokio::task::spawn_blocking(move || {
        let ico = if cfg!(windows) {
            icon_src
                .as_deref()
                .and_then(|p| shortcuts::make_ico(p, &cache))
        } else {
            icon_src.clone()
        };
        shortcuts::create(&dir, &name, &instance_id, ico.as_deref())
            .map(|p| p.to_string_lossy().to_string())
    })
    .await
    .map_err(join_err)?
}

/// Ausstehende Aktionen von Kommandozeile/Deep-Links abholen (leert die Warteschlange).
#[tauri::command]
pub async fn app_actions_take(p: State<'_, PlatformState>) -> AppResult<Vec<links::AppAction>> {
    Ok(p.take_actions())
}

/// Ist Discord Rich Presence in diesem Build verfügbar (Client-ID gesetzt)?
#[tauri::command]
pub async fn discord_available(p: State<'_, PlatformState>) -> AppResult<bool> {
    Ok(p.discord.available())
}
