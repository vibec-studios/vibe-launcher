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

// ------------------------------------------------------------------ Optionen-Sync

#[derive(Serialize)]
pub struct OptSyncInfo {
    pub config: optsync::SyncConfig,
    pub categories: Vec<String>,
    /// Anzahl Master-Schlüssel je Kategorie
    pub counts: std::collections::BTreeMap<String, usize>,
}

fn optsync_info(root: &Path) -> OptSyncInfo {
    let config = optsync::SyncConfig::load(&optsync::config_path(root));
    let mut counts = std::collections::BTreeMap::new();
    for k in config.master.keys() {
        if let Some(c) = optsync::category_of(k) {
            *counts.entry(c.to_string()).or_insert(0) += 1;
        }
    }
    OptSyncInfo {
        config,
        categories: optsync::CATEGORIES.iter().map(|s| s.to_string()).collect(),
        counts,
    }
}

#[tauri::command]
pub async fn optsync_get(state: State<'_, AppState>) -> AppResult<OptSyncInfo> {
    Ok(optsync_info(&state.paths.root))
}

fn check_categories(c: &[String]) -> AppResult<()> {
    if c.iter().all(|x| optsync::CATEGORIES.contains(&x.as_str())) {
        Ok(())
    } else {
        Err(AppError::Invalid("Unbekannte Kategorie".into()))
    }
}

#[tauri::command]
pub async fn optsync_set_instance(
    state: State<'_, AppState>,
    instance_id: String,
    enabled: bool,
    categories: Vec<String>,
) -> AppResult<OptSyncInfo> {
    state.instances.get(&instance_id)?;
    check_categories(&categories)?;
    let p = optsync::config_path(&state.paths.root);
    let mut cfg = optsync::SyncConfig::load(&p);
    cfg.instances.insert(
        instance_id,
        optsync::InstanceSync {
            enabled,
            categories,
        },
    );
    cfg.save(&p)?;
    Ok(optsync_info(&state.paths.root))
}

/// Master-Profil aus einer Instanz übernehmen (ersetzt die Werte der gewählten Kategorien).
#[tauri::command]
pub async fn optsync_capture(
    state: State<'_, AppState>,
    instance_id: String,
    categories: Vec<String>,
) -> AppResult<OptSyncInfo> {
    state.instances.get(&instance_id)?;
    check_categories(&categories)?;
    let text = std::fs::read_to_string(state.paths.game_dir(&instance_id).join("options.txt"))
        .map_err(|_| AppError::NotFound("Diese Instanz hat noch keine options.txt – einmal starten und Einstellungen vornehmen".into()))?;
    let p = optsync::config_path(&state.paths.root);
    let mut cfg = optsync::SyncConfig::load(&p);
    cfg.master
        .retain(|k, _| optsync::category_of(k).map_or(true, |c| !categories.iter().any(|x| x == c)));
    optsync::capture(&text, &mut cfg.master, &categories);
    cfg.source = Some(instance_id);
    cfg.updated_at = Some(chrono::Utc::now().timestamp_millis());
    cfg.save(&p)?;
    Ok(optsync_info(&state.paths.root))
}

/// Master-Profil sofort auf alle aktivierten (nicht laufenden) Instanzen anwenden. Gibt die Anzahl zurück.
#[tauri::command]
pub async fn optsync_apply_all(state: State<'_, AppState>) -> AppResult<usize> {
    let cfg = optsync::SyncConfig::load(&optsync::config_path(&state.paths.root));
    let mut n = 0;
    for (id, s) in &cfg.instances {
        if !s.enabled || state.game.is_running(id) {
            continue;
        }
        if let Ok(inst) = state.instances.get(id) {
            if optsync::apply(
                &state.paths.root,
                &state.paths.game_dir(id),
                id,
                &inst.mc_version,
            )? > 0
            {
                n += 1;
            }
        }
    }
    Ok(n)
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
    let icon_src = inst
        .icon
        .as_deref()
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
