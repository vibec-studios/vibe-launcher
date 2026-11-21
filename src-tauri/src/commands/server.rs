//! Lokale Server. OWNER: Game-Agent.
use crate::error::{AppError, AppResult};
use crate::minecraft::LogLine;
use crate::server::backup::{ServerBackup, ServerWorld};
use crate::server::players::{ListKind, ServerPlayers};
use crate::server::run::ServerStatus;
use crate::server::sides::ServerModCandidate;
use crate::server::{self, server_dir, Server, ServerCreate, ServerPatch};
use crate::state::AppState;
use serde::Serialize;
use std::collections::HashMap;
use tauri::State;

#[derive(Serialize)]
pub struct ServerCreated {
    pub server: Server,
    pub task_id: String,
}

#[derive(Serialize)]
pub struct ServerAddresses {
    pub local: String,
    pub lan: Vec<String>,
}

fn task_ref(id: &str) -> Option<String> {
    Some(format!("server:{id}"))
}

fn spawn_install(state: &AppState, s: &Server, force: bool, create: Option<ServerCreate>) -> String {
    let st = state.clone();
    let id = s.id.clone();
    let title = if force { format!("Server „{}“ wird repariert", s.name) } else { format!("Server „{}“ wird installiert", s.name) };
    state.tasks.spawn("server", title, task_ref(&s.id), move |task| async move {
        if let Some(req) = create {
            task.message("Inhalte werden aus der Instanz übernommen …");
            let st2 = st.clone();
            let id2 = id.clone();
            tokio::task::spawn_blocking(move || server::install::copy_from_instance(&st2, &req, &id2)).await??;
        }
        server::install::install(&st, &id, force, &task.sub(0.0, 1.0)).await
    })
}

#[tauri::command]
pub async fn servers_list(state: State<'_, AppState>) -> AppResult<Vec<Server>> {
    Ok(state.servers.list())
}

#[tauri::command]
pub async fn server_get(state: State<'_, AppState>, id: String) -> AppResult<Server> {
    state.servers.get(&id)
}

#[tauri::command]
pub async fn server_create(state: State<'_, AppState>, req: ServerCreate) -> AppResult<ServerCreated> {
    let mut req = req;
    if let Some(inst_id) = &req.from_instance {
        let inst = state.instances.get(inst_id)?;
        req.mc_version = inst.mc_version.clone();
        req.loader = inst.loader.clone();
    }
    let s = state.servers.create(&req)?;
    let from = req.from_instance.is_some().then(|| req.clone());
    let task_id = spawn_install(&state, &s, false, from);
    Ok(ServerCreated { server: s, task_id })
}

#[tauri::command]
pub async fn server_mod_candidates(state: State<'_, AppState>, instance_id: String) -> AppResult<Vec<ServerModCandidate>> {
    state.instances.get(&instance_id)?;
    let dir = state.paths.game_dir(&instance_id).join("mods");
    let mut list = tokio::task::spawn_blocking(move || server::sides::candidates(&dir)).await?;
    // Genauere Einordnung aus den Inhalts-Metadaten (Modrinth client_side/server_side, mrpack env, Stores)
    if let Ok(infos) = crate::content::sides::classify(&state, &instance_id).await {
        for m in list.iter_mut() {
            let Some(info) = infos.iter().find(|i| i.kind == crate::content::ContentKind::Mod && i.file_name == m.file_name) else { continue };
            let side = match info.side {
                crate::content::Side::Client => server::sides::ModSide::Client,
                crate::content::Side::Both => server::sides::ModSide::Both,
                crate::content::Side::Server => server::sides::ModSide::Server,
                _ => continue,
            };
            m.side = side;
            m.server_ok = m.enabled && side != server::sides::ModSide::Client;
        }
    }
    Ok(list)
}

#[tauri::command]
pub async fn server_update(state: State<'_, AppState>, id: String, patch: ServerPatch) -> AppResult<Server> {
    let before = state.servers.get(&id)?;
    let s = state.servers.patch(&id, patch)?;
    if s.port != before.port {
        let dir = server_dir(&state.paths, &id);
        server::props::set(&dir.join("server.properties"), &[("server-port".into(), s.port.to_string())])?;
    }
    if s.connection != before.connection {
        server::run::restart_tunnel_if_running(&state, &id);
    }
    Ok(s)
}

#[tauri::command]
pub async fn server_delete(state: State<'_, AppState>, id: String) -> AppResult<()> {
    if state.server_mgr.is_active(&id) {
        return Err(AppError::Invalid("Bitte den Server zuerst stoppen.".into()));
    }
    let store = state.servers.clone();
    tokio::task::spawn_blocking(move || store.delete(&id)).await?
}

#[tauri::command]
pub async fn server_set_icon(state: State<'_, AppState>, id: String, path: Option<String>) -> AppResult<Server> {
    let dir = server_dir(&state.paths, &id);
    state.servers.get(&id)?;
    let dest = dir.join("server-icon.png");
    match path {
        Some(p) => {
            let d2 = dest.clone();
            tokio::task::spawn_blocking(move || -> AppResult<()> {
                let img = image::open(&p).map_err(|e| AppError::Invalid(format!("Bild nicht lesbar: {e}")))?;
                img.resize_to_fill(64, 64, image::imageops::FilterType::Lanczos3)
                    .save_with_format(&d2, image::ImageFormat::Png)
                    .map_err(|e| AppError::msg(format!("Icon nicht speicherbar: {e}")))?;
                Ok(())
            })
            .await??;
            let p = dest.to_string_lossy().to_string();
            state.servers.modify(&id, |s| s.icon = Some(p))
        }
        None => {
            let _ = std::fs::remove_file(&dest);
            state.servers.modify(&id, |s| s.icon = None)
        }
    }
}

#[tauri::command]
pub async fn server_install(state: State<'_, AppState>, id: String, force: Option<bool>) -> AppResult<String> {
    let s = state.servers.get(&id)?;
    if state.server_mgr.is_active(&id) {
        return Err(AppError::Invalid("Bitte den Server zuerst stoppen.".into()));
    }
    Ok(spawn_install(&state, &s, force.unwrap_or(false), None))
}

#[tauri::command]
pub async fn server_accept_eula(state: State<'_, AppState>, id: String) -> AppResult<Server> {
    let dir = server_dir(&state.paths, &id);
    std::fs::create_dir_all(&dir)?;
    std::fs::write(dir.join("eula.txt"), "# Akzeptiert im Vibe Launcher (https://aka.ms/MinecraftEULA)\neula=true\n")?;
    state.servers.modify(&id, |s| s.eula = true)
}

#[tauri::command]
pub async fn server_start(state: State<'_, AppState>, id: String) -> AppResult<()> {
    server::run::start(&state, &id)
}

#[tauri::command]
pub async fn server_stop(state: State<'_, AppState>, id: String) -> AppResult<()> {
    state.server_mgr.stop(&id)
}

#[tauri::command]
pub async fn server_restart(state: State<'_, AppState>, id: String) -> AppResult<()> {
    state.server_mgr.restart(&state, &id)
}

#[tauri::command]
pub async fn server_kill(state: State<'_, AppState>, id: String) -> AppResult<()> {
    state.server_mgr.kill(&id)
}

#[tauri::command]
pub async fn server_command(state: State<'_, AppState>, id: String, command: String) -> AppResult<()> {
    state.server_mgr.command(&id, &command)
}

#[tauri::command]
pub async fn server_statuses(state: State<'_, AppState>) -> AppResult<Vec<ServerStatus>> {
    Ok(state.server_mgr.statuses())
}

#[tauri::command]
pub async fn server_log(state: State<'_, AppState>, id: String) -> AppResult<Vec<LogLine>> {
    Ok(state.server_mgr.log(&id))
}

/// Primäre LAN-Adresse (ohne Pakete zu senden: UDP-„connect“ wählt nur die Route).
fn lan_ip() -> Option<std::net::IpAddr> {
    let s = std::net::UdpSocket::bind("0.0.0.0:0").ok()?;
    s.connect("8.8.8.8:80").ok()?;
    let ip = s.local_addr().ok()?.ip();
    (!ip.is_loopback() && !ip.is_unspecified()).then_some(ip)
}

#[tauri::command]
pub async fn server_addresses(state: State<'_, AppState>, id: String) -> AppResult<ServerAddresses> {
    let s = state.servers.get(&id)?;
    let port = s.port;
    let fmt = |host: String| if port == 25565 { host } else { format!("{host}:{port}") };
    Ok(ServerAddresses { local: fmt("localhost".into()), lan: lan_ip().map(|ip| vec![fmt(ip.to_string())]).unwrap_or_default() })
}

#[tauri::command]
pub async fn server_properties_get(state: State<'_, AppState>, id: String) -> AppResult<Vec<(String, String)>> {
    state.servers.get(&id)?;
    Ok(server::props::read(&server_dir(&state.paths, &id).join("server.properties")))
}

#[tauri::command]
pub async fn server_properties_set(state: State<'_, AppState>, id: String, values: HashMap<String, String>) -> AppResult<Vec<(String, String)>> {
    let s = state.servers.get(&id)?;
    let path = server_dir(&state.paths, &id).join("server.properties");
    let mut vals: Vec<(String, String)> = values.into_iter().map(|(k, v)| (k.trim().to_string(), v)).filter(|(k, _)| !k.is_empty()).collect();
    vals.sort();
    // Port kommt aus dem Server-Modell
    if let Some((_, p)) = vals.iter().find(|(k, _)| k == "server-port") {
        let port: u16 = p.trim().parse().map_err(|_| AppError::Invalid("Ungültiger Port".into()))?;
        if port != s.port {
            state.servers.patch(&id, ServerPatch { port: Some(port), ..Default::default() })?;
        }
    }
    server::props::set(&path, &vals)?;
    if vals.iter().any(|(k, _)| k == "white-list") {
        server::relay::push_access(&state, &id);
    }
    Ok(server::props::read(&path))
}

#[tauri::command]
pub async fn server_properties_raw(state: State<'_, AppState>, id: String) -> AppResult<String> {
    state.servers.get(&id)?;
    Ok(std::fs::read_to_string(server_dir(&state.paths, &id).join("server.properties")).unwrap_or_default())
}

#[tauri::command]
pub async fn server_properties_raw_set(state: State<'_, AppState>, id: String, text: String) -> AppResult<()> {
    let s = state.servers.get(&id)?;
    let path = server_dir(&state.paths, &id).join("server.properties");
    std::fs::write(&path, text.replace("\r\n", "\n"))?;
    if let Some(port) = server::props::get(&path, "server-port").and_then(|p| p.trim().parse::<u16>().ok()) {
        if port != s.port {
            state.servers.patch(&id, ServerPatch { port: Some(port), ..Default::default() })?;
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn server_players(state: State<'_, AppState>, id: String) -> AppResult<ServerPlayers> {
    state.servers.get(&id)?;
    Ok(server::players::read_all(&state, &id))
}

#[tauri::command]
pub async fn server_player_action(
    state: State<'_, AppState>,
    id: String,
    list: ListKind,
    action: String,
    name: String,
    reason: Option<String>,
) -> AppResult<ServerPlayers> {
    state.servers.get(&id)?;
    server::players::action(&state, &id, list, action == "add", &name, reason).await
}

#[tauri::command]
pub async fn server_set_whitelist(state: State<'_, AppState>, id: String, enabled: bool) -> AppResult<ServerPlayers> {
    state.servers.get(&id)?;
    server::players::set_whitelist(&state, &id, enabled).await
}

#[tauri::command]
pub async fn server_worlds(state: State<'_, AppState>, id: String) -> AppResult<Vec<ServerWorld>> {
    state.servers.get(&id)?;
    let st = state.inner().clone();
    Ok(tokio::task::spawn_blocking(move || server::backup::worlds(&st, &id)).await?)
}

#[tauri::command]
pub async fn server_backups(state: State<'_, AppState>, id: String) -> AppResult<Vec<ServerBackup>> {
    state.servers.get(&id)?;
    Ok(server::backup::list(&state, &id))
}

#[tauri::command]
pub async fn server_backup_create(state: State<'_, AppState>, id: String, world: Option<String>) -> AppResult<String> {
    let s = state.servers.get(&id)?;
    let st = state.inner().clone();
    Ok(state.tasks.spawn("server", format!("Backup von „{}“", s.name), task_ref(&id), move |task| async move {
        server::backup::create(&st, &id, world, &task.sub(0.0, 1.0)).await
    }))
}

#[tauri::command]
pub async fn server_backup_delete(state: State<'_, AppState>, id: String, name: String) -> AppResult<()> {
    state.servers.get(&id)?;
    server::backup::delete(&state, &id, &name)
}

#[tauri::command]
pub async fn server_backup_restore(state: State<'_, AppState>, id: String, name: String) -> AppResult<String> {
    let s = state.servers.get(&id)?;
    if state.server_mgr.is_active(&id) {
        return Err(AppError::Invalid("Bitte den Server vor dem Wiederherstellen stoppen.".into()));
    }
    let st = state.inner().clone();
    Ok(state.tasks.spawn("server", format!("Backup wird wiederhergestellt („{}“)", s.name), task_ref(&id), move |task| async move {
        server::backup::restore(&st, &id, &name, &task.sub(0.0, 1.0)).await
    }))
}

#[tauri::command]
pub async fn server_open_folder(state: State<'_, AppState>, id: String, sub: Option<String>) -> AppResult<()> {
    state.servers.get(&id)?;
    let base = server_dir(&state.paths, &id);
    let dir = match sub.as_deref() {
        Some(s) if !s.is_empty() => crate::util::safe_join(&base, s).ok_or_else(|| AppError::Invalid("Pfad".into()))?,
        _ => base,
    };
    std::fs::create_dir_all(&dir)?;
    crate::util::open_in_explorer(&dir)
}

#[tauri::command]
pub async fn server_tunnel_reset(state: State<'_, AppState>, id: String) -> AppResult<()> {
    let s = state.servers.get(&id)?;
    match s.connection {
        server::ServerConnection::Relay => {
            if !server::relay::rotate(&id) {
                return Err(AppError::Invalid("Der Relay ist nicht verbunden (Server starten).".into()));
            }
        }
        server::ServerConnection::Playit => {
            server::playit::reset(&state, &id)?;
            server::run::restart_tunnel_if_running(&state, &id);
        }
        server::ServerConnection::Local => {}
    }
    Ok(())
}

/// Antwort auf `servers://close-requested`.
#[tauri::command]
pub async fn servers_quit(state: State<'_, AppState>, stop: bool) -> AppResult<()> {
    state.server_mgr.set_quitting();
    if stop {
        state.server_mgr.stop_all().await;
    }
    state.app.exit(0);
    Ok(())
}

// ------------------------------------------------------------------ Plugin-Software (Paper/Purpur/Folia)

#[tauri::command]
pub async fn server_platform_versions(state: State<'_, AppState>, kind: server::platform::PlatformKind) -> AppResult<Vec<server::platform::PlatformVersion>> {
    server::platform::versions(&state, kind).await
}

#[tauri::command]
pub async fn server_platform_builds(
    state: State<'_, AppState>,
    kind: server::platform::PlatformKind,
    mc: String,
) -> AppResult<Vec<server::platform::PlatformBuild>> {
    server::platform::builds(&state, kind, &mc).await
}

/// Anderen Build der Server-Software einspielen (Update/Downgrade). `build = None` -> neuester stabiler.
#[tauri::command]
pub async fn server_platform_set_build(state: State<'_, AppState>, id: String, build: Option<String>) -> AppResult<String> {
    let s = state.servers.get(&id)?;
    if s.platform.is_none() {
        return Err(AppError::Invalid("Dieser Server nutzt keine Plugin-Software.".into()));
    }
    if state.server_mgr.is_active(&id) {
        return Err(AppError::Invalid("Bitte den Server zuerst stoppen.".into()));
    }
    let builds = server::platform::builds(&state, s.platform.as_ref().map(|p| p.kind).unwrap_or(server::platform::PlatformKind::Paper), &s.mc_version).await?;
    let b = server::platform::pick_build(&builds, build.as_deref()).ok_or_else(|| AppError::Invalid("Build nicht gefunden".into()))?.id.clone();
    let s = state.servers.modify(&id, |x| {
        if let Some(p) = x.platform.as_mut() {
            p.build = Some(b);
        }
    })?;
    Ok(spawn_install(&state, &s, false, None))
}

// ------------------------------------------------------------------ Plugins / Mods des Servers

use crate::server::plugins::{self, AddonList, AddonSearch, AddonSource, AddonUpdate};

#[tauri::command]
pub async fn server_addons(state: State<'_, AppState>, id: String) -> AppResult<AddonList> {
    let s = state.servers.get(&id)?;
    plugins::list(&state, &s).await
}

#[tauri::command]
pub async fn server_addon_search(
    state: State<'_, AppState>,
    id: String,
    source: AddonSource,
    query: String,
    sort: Option<String>,
    offset: Option<u32>,
) -> AppResult<AddonSearch> {
    let s = state.servers.get(&id)?;
    plugins::search(&state, &s, source, &query, sort.as_deref().unwrap_or("relevance"), offset.unwrap_or(0)).await
}

/// Projektdetails für das Overlay: Hangar über die Hangar-API (Modrinth nutzt `content_project`).
#[tauri::command]
pub async fn server_addon_project(state: State<'_, AppState>, project: String) -> AppResult<plugins::AddonProject> {
    plugins::hangar_project(&state, &project).await
}

#[tauri::command]
pub async fn server_addon_install(state: State<'_, AppState>, id: String, source: AddonSource, project: String) -> AppResult<Vec<String>> {
    let s = state.servers.get(&id)?;
    plugins::install(&state, &s, source, &project).await
}

#[tauri::command]
pub async fn server_addon_updates(state: State<'_, AppState>, id: String) -> AppResult<Vec<AddonUpdate>> {
    let s = state.servers.get(&id)?;
    plugins::updates(&state, &s).await
}

#[tauri::command]
pub async fn server_addon_update(state: State<'_, AppState>, id: String, files: Option<Vec<String>>) -> AppResult<usize> {
    let s = state.servers.get(&id)?;
    plugins::apply_updates(&state, &s, files).await
}

#[tauri::command]
pub async fn server_addon_set_enabled(state: State<'_, AppState>, id: String, file: String, enabled: bool) -> AppResult<String> {
    let s = state.servers.get(&id)?;
    plugins::set_enabled(&state, &s, &file, enabled)
}

#[tauri::command]
pub async fn server_addon_remove(state: State<'_, AppState>, id: String, file: String) -> AppResult<()> {
    let s = state.servers.get(&id)?;
    plugins::remove(&state, &s, &file)
}

/// Sprachchat/Bedrock-Status eines Servers (Vertrag 04/28).
#[tauri::command]
pub async fn server_extras_get(state: State<'_, AppState>, id: String) -> AppResult<crate::server::extras::ExtrasInfo> {
    let s = state.servers.get(&id)?;
    Ok(crate::server::extras::info(&state, &s).await)
}

/// Sprachchat (Simple Voice Chat) bzw. Bedrock (Geyser + Floodgate) ein-/ausschalten: installiert bzw. deaktiviert die
/// Erweiterungen über Modrinth. Nur bei gestopptem Server.
#[tauri::command]
pub async fn server_extras_set(state: State<'_, AppState>, id: String, voice: Option<bool>, bedrock: Option<bool>) -> AppResult<crate::server::extras::ExtrasInfo> {
    crate::server::extras::set(&state, &id, voice, bedrock).await
}
