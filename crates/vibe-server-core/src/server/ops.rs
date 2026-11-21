//! Gemeinsame Server-Aktionen für Launcher-Befehle und Agent-API.
use super::{server_dir, Server, ServerConnection, ServerCreate, ServerPatch};
use crate::error::{AppError, AppResult};
use crate::Core;
use serde::Serialize;
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize)]
pub struct ServerAddresses {
    pub local: String,
    pub lan: Vec<String>,
}

pub fn task_ref(id: &str) -> Option<String> {
    Some(format!("server:{id}"))
}

pub fn spawn_install(core: &Core, s: &Server, force: bool, create: Option<ServerCreate>) -> String {
    let st = core.clone();
    let id = s.id.clone();
    let title = if force { format!("Server „{}“ wird repariert", s.name) } else { format!("Server „{}“ wird installiert", s.name) };
    core.tasks.spawn("server", title, task_ref(&s.id), move |task| async move {
        if let Some(req) = create {
            task.message("Inhalte werden aus der Instanz übernommen …");
            let st2 = st.clone();
            let id2 = id.clone();
            tokio::task::spawn_blocking(move || super::install::copy_from_instance(&st2, &req, &id2)).await??;
        }
        super::install::install(&st, &id, force, &task.sub(0.0, 1.0)).await
    })
}

pub fn install(core: &Core, id: &str, force: bool) -> AppResult<String> {
    let s = core.servers.get(id)?;
    if core.server_mgr.is_active(id) {
        return Err(AppError::Invalid("Bitte den Server zuerst stoppen.".into()));
    }
    Ok(spawn_install(core, &s, force, None))
}

pub fn accept_eula(core: &Core, id: &str, by: &str) -> AppResult<Server> {
    let dir = server_dir(&core.paths, id);
    std::fs::create_dir_all(&dir)?;
    std::fs::write(dir.join("eula.txt"), format!("# Akzeptiert im {by} (https://aka.ms/MinecraftEULA)\neula=true\n"))?;
    core.servers.modify(id, |s| s.eula = true)
}

pub fn lan_ip() -> Option<std::net::IpAddr> {
    let s = std::net::UdpSocket::bind("0.0.0.0:0").ok()?;
    s.connect("8.8.8.8:80").ok()?;
    let ip = s.local_addr().ok()?.ip();
    (!ip.is_loopback() && !ip.is_unspecified()).then_some(ip)
}

pub fn addresses(core: &Core, id: &str) -> AppResult<ServerAddresses> {
    let s = core.servers.get(id)?;
    let port = s.port;
    let fmt = |host: String| if port == 25565 { host } else { format!("{host}:{port}") };
    Ok(ServerAddresses { local: fmt("localhost".into()), lan: lan_ip().map(|ip| vec![fmt(ip.to_string())]).unwrap_or_default() })
}

pub fn properties(core: &Core, id: &str) -> AppResult<Vec<(String, String)>> {
    core.servers.get(id)?;
    Ok(super::props::read(&server_dir(&core.paths, id).join("server.properties")))
}

pub fn set_properties(core: &Core, id: &str, values: HashMap<String, String>) -> AppResult<Vec<(String, String)>> {
    let s = core.servers.get(id)?;
    let path = server_dir(&core.paths, id).join("server.properties");
    let mut vals: Vec<(String, String)> = values.into_iter().map(|(k, v)| (k.trim().to_string(), v)).filter(|(k, _)| !k.is_empty()).collect();
    vals.sort();
    if let Some((_, p)) = vals.iter().find(|(k, _)| k == "server-port") {
        let port: u16 = p.trim().parse().map_err(|_| AppError::Invalid("Ungültiger Port".into()))?;
        if port != s.port {
            core.servers.patch(id, ServerPatch { port: Some(port), ..Default::default() })?;
        }
    }
    super::props::set(&path, &vals)?;
    if vals.iter().any(|(k, _)| k == "white-list") {
        super::relay::push_access(core, id);
    }
    Ok(super::props::read(&path))
}

pub fn properties_raw(core: &Core, id: &str) -> AppResult<String> {
    core.servers.get(id)?;
    Ok(std::fs::read_to_string(server_dir(&core.paths, id).join("server.properties")).unwrap_or_default())
}

pub fn set_properties_raw(core: &Core, id: &str, text: &str) -> AppResult<()> {
    let s = core.servers.get(id)?;
    let path = server_dir(&core.paths, id).join("server.properties");
    std::fs::write(&path, text.replace("\r\n", "\n"))?;
    if let Some(port) = super::props::get(&path, "server-port").and_then(|p| p.trim().parse::<u16>().ok()) {
        if port != s.port {
            core.servers.patch(id, ServerPatch { port: Some(port), ..Default::default() })?;
        }
    }
    Ok(())
}

pub fn backup_create(core: &Core, id: &str, world: Option<String>) -> AppResult<String> {
    let s = core.servers.get(id)?;
    let st = core.clone();
    let id = id.to_string();
    Ok(core.tasks.spawn("server", format!("Backup von „{}“", s.name), task_ref(&id), move |task| async move {
        super::backup::create(&st, &id, world, &task.sub(0.0, 1.0)).await
    }))
}

pub fn backup_restore(core: &Core, id: &str, name: &str) -> AppResult<String> {
    let s = core.servers.get(id)?;
    if core.server_mgr.is_active(id) {
        return Err(AppError::Invalid("Bitte den Server vor dem Wiederherstellen stoppen.".into()));
    }
    let st = core.clone();
    let (id, name) = (id.to_string(), name.to_string());
    Ok(core.tasks.spawn("server", format!("Backup wird wiederhergestellt („{}“)", s.name), task_ref(&id), move |task| async move {
        super::backup::restore(&st, &id, &name, &task.sub(0.0, 1.0)).await
    }))
}

pub fn tunnel_reset(core: &Core, id: &str) -> AppResult<()> {
    let s = core.servers.get(id)?;
    match s.connection {
        ServerConnection::Relay => {
            if !super::relay::rotate(id) {
                return Err(AppError::Invalid("Der Relay ist nicht verbunden (Server starten).".into()));
            }
        }
        ServerConnection::Playit => {
            super::playit::reset(core, id)?;
            super::run::restart_tunnel_if_running(core, id);
        }
        ServerConnection::Local => {}
    }
    Ok(())
}

pub fn patch(core: &Core, id: &str, patch: ServerPatch) -> AppResult<Server> {
    let before = core.servers.get(id)?;
    let s = core.servers.patch(id, patch)?;
    if s.port != before.port {
        let dir = server_dir(&core.paths, id);
        super::props::set(&dir.join("server.properties"), &[("server-port".into(), s.port.to_string())])?;
    }
    if s.connection != before.connection {
        super::run::restart_tunnel_if_running(core, id);
    }
    Ok(s)
}

pub async fn delete(core: &Core, id: &str) -> AppResult<()> {
    if core.server_mgr.is_active(id) {
        return Err(AppError::Invalid("Bitte den Server zuerst stoppen.".into()));
    }
    let store = core.servers.clone();
    let id = id.to_string();
    tokio::task::spawn_blocking(move || store.delete(&id)).await?
}

pub async fn set_platform_build(core: &Core, id: &str, build: Option<String>) -> AppResult<String> {
    let s = core.servers.get(id)?;
    if s.platform.is_none() {
        return Err(AppError::Invalid("Dieser Server nutzt keine Plugin-Software.".into()));
    }
    if core.server_mgr.is_active(id) {
        return Err(AppError::Invalid("Bitte den Server zuerst stoppen.".into()));
    }
    let builds = super::platform::builds(core, s.platform.as_ref().map(|p| p.kind).unwrap_or(super::platform::PlatformKind::Paper), &s.mc_version).await?;
    let b = super::platform::pick_build(&builds, build.as_deref()).ok_or_else(|| AppError::Invalid("Build nicht gefunden".into()))?.id.clone();
    let s = core.servers.modify(id, |x| {
        if let Some(p) = x.platform.as_mut() {
            p.build = Some(b);
        }
    })?;
    Ok(spawn_install(core, &s, false, None))
}
