use super::*;

#[tauri::command]
pub async fn crash_analyze(
    state: State<'_, AppState>,
    instance_id: String,
    crash_report: Option<String>,
    exit_code: Option<i32>,
) -> AppResult<Vec<crash::Diagnosis>> {
    crash::analyze_instance(&state, &instance_id, crash_report, exit_code).await
}

pub(super) fn servers_path(state: &AppState, id: &str) -> AppResult<PathBuf> {
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
    let mut live: std::collections::BTreeMap<String, i64> = std::collections::BTreeMap::new();
    for g in state.game.states() {
        if let (crate::minecraft::RunState::Running, Some(start)) = (&g.state, g.started_at) {
            let e = live.entry(g.instance_id.clone()).or_insert(start);
            *e = (*e).min(start);
        }
    }
    for (instance_id, start) in live {
        list.push(stats::Session { instance_id, start, end: now, world: None, server: None });
    }
    Ok(list)
}
