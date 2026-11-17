//! Lokale Minecraft-Server: Modell + Speicher, Installation, Prozesse/Konsole, server.properties,
//! Spielerlisten, Backups, Verbindungen (LAN, Vibe-Relay, playit.gg).
//!
//! OWNER: Game-Agent. Ordner: `<daten>/servers/<id>/` (Arbeitsordner des Servers) mit `vibe-server.json`.
use crate::error::{AppError, AppResult};
use crate::instance::{InstallState, Loader};
use crate::paths::Paths;
use crate::util::{now_ms, write_json_atomic};
use parking_lot::RwLock;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use tauri::AppHandle;

pub mod backup;
pub mod install;
pub mod players;
pub mod playit;
pub mod props;
pub mod relay;
pub mod run;
pub mod sides;

pub use run::ServerManager;

pub const EV_CHANGED: &str = "servers://changed";
pub const EV_REMOVED: &str = "servers://removed";
pub const EV_STATUS: &str = "server://status";
pub const EV_LOG: &str = "server://log";
pub const EV_CLOSE_REQUESTED: &str = "servers://close-requested";

pub const DEFAULT_MEMORY_MB: u32 = 2048;
pub const DEFAULT_RELAY: &str = "vibey.henny.dev:25565";
const META_FILE: &str = "vibe-server.json";

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum ServerConnection {
    #[default]
    Local,
    Relay,
    Playit,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Server {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub icon: Option<String>,
    #[serde(default)]
    pub accent: Option<String>,
    pub mc_version: String,
    pub loader: Loader,
    #[serde(default)]
    pub memory_mb: Option<u32>,
    #[serde(default)]
    pub java_path: Option<String>,
    #[serde(default)]
    pub jvm_args: Option<String>,
    pub port: u16,
    #[serde(default)]
    pub auto_start: bool,
    #[serde(default)]
    pub auto_restart: bool,
    #[serde(default)]
    pub connection: ServerConnection,
    #[serde(default)]
    pub relay_address: Option<String>,
    #[serde(default)]
    pub eula: bool,
    #[serde(default)]
    pub install_state: InstallState,
    pub created_at: i64,
    #[serde(default)]
    pub last_started: Option<i64>,
    #[serde(default)]
    pub source_instance: Option<String>,
    /// Relay-Slot (≥ 1; Slot 0 gehört der Spielwelt der Mod)
    #[serde(default)]
    pub relay_slot: u32,
    /// Start-Befehl nach der Installation (intern)
    #[serde(default)]
    pub launch: Option<install::LaunchSpec>,
}

impl Server {
    pub fn memory(&self) -> u32 {
        self.memory_mb.unwrap_or(DEFAULT_MEMORY_MB).max(512)
    }
    pub fn relay(&self) -> String {
        self.relay_address.clone().filter(|s| !s.trim().is_empty()).unwrap_or_else(|| {
            std::env::var("VIBE_RELAY").ok().filter(|s| !s.trim().is_empty()).unwrap_or_else(|| DEFAULT_RELAY.to_string())
        })
    }
}

#[derive(Debug, Clone, Deserialize)]
pub struct ServerCreate {
    pub name: String,
    pub mc_version: String,
    pub loader: Loader,
    #[serde(default)]
    pub from_instance: Option<String>,
    #[serde(default)]
    pub mods: Option<Vec<String>>,
    #[serde(default)]
    pub copy_configs: Option<bool>,
    #[serde(default)]
    pub world: Option<String>,
    #[serde(default)]
    pub port: Option<u16>,
    #[serde(default)]
    pub memory_mb: Option<u32>,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(default)]
pub struct ServerPatch {
    pub name: Option<String>,
    pub accent: Option<Option<String>>,
    pub memory_mb: Option<Option<u32>>,
    pub java_path: Option<Option<String>>,
    pub jvm_args: Option<Option<String>>,
    pub port: Option<u16>,
    pub auto_start: Option<bool>,
    pub auto_restart: Option<bool>,
    pub connection: Option<ServerConnection>,
    pub relay_address: Option<Option<String>>,
}

pub fn servers_root(paths: &Paths) -> PathBuf {
    paths.root.join("servers")
}

pub fn server_dir(paths: &Paths, id: &str) -> PathBuf {
    servers_root(paths).join(id)
}

/// Speicher aller Server (`servers/<id>/vibe-server.json`).
pub struct ServerStore {
    paths: Paths,
    app: AppHandle,
    map: RwLock<HashMap<String, Server>>,
}

fn slug(name: &str) -> String {
    let mut s = String::new();
    for c in name.to_lowercase().chars() {
        let rep = match c {
            'ä' => "ae".to_string(),
            'ö' => "oe".to_string(),
            'ü' => "ue".to_string(),
            'ß' => "ss".to_string(),
            c if c.is_ascii_alphanumeric() || c == '.' || c == '_' => c.to_string(),
            _ => "-".to_string(),
        };
        if rep == "-" && (s.is_empty() || s.ends_with('-')) {
            continue;
        }
        s.push_str(&rep);
    }
    let s = s.trim_matches(['-', '.']).chars().take(40).collect::<String>();
    if s.is_empty() { "server".into() } else { s }
}

impl ServerStore {
    pub fn load(paths: Paths, app: AppHandle) -> Arc<Self> {
        let mut map = HashMap::new();
        if let Ok(rd) = std::fs::read_dir(servers_root(&paths)) {
            for e in rd.flatten() {
                let p = e.path().join(META_FILE);
                if let Ok(b) = std::fs::read(&p) {
                    match serde_json::from_slice::<Server>(&b) {
                        Ok(mut s) => {
                            s.id = e.file_name().to_string_lossy().to_string();
                            if s.install_state == InstallState::Installing {
                                s.install_state = InstallState::NotInstalled;
                            }
                            map.insert(s.id.clone(), s);
                        }
                        Err(err) => tracing::warn!("Server {:?} unlesbar: {err}", p),
                    }
                }
            }
        }
        Arc::new(ServerStore { paths, app, map: RwLock::new(map) })
    }

    pub fn list(&self) -> Vec<Server> {
        let mut v: Vec<Server> = self.map.read().values().cloned().collect();
        v.sort_by_key(|s| std::cmp::Reverse(s.created_at));
        v
    }

    pub fn get(&self, id: &str) -> AppResult<Server> {
        self.map.read().get(id).cloned().ok_or_else(|| AppError::NotFound(format!("Server {id}")))
    }

    fn persist(&self, s: &Server) -> AppResult<()> {
        write_json_atomic(&server_dir(&self.paths, &s.id).join(META_FILE), s)
    }

    fn emit(&self, s: &Server) {
        crate::events::emit(&self.app, EV_CHANGED, s);
    }

    /// Freier Port ab 25565, der von keinem anderen Server belegt ist.
    pub fn free_port(&self, exclude: Option<&str>) -> u16 {
        let used: Vec<u16> = self.map.read().values().filter(|s| Some(s.id.as_str()) != exclude).map(|s| s.port).collect();
        let mut p = 25565u16;
        while used.contains(&p) || !run::port_free(p) {
            p += 1;
            if p > 25665 {
                return 25565;
            }
        }
        p
    }

    fn free_slot(&self) -> u32 {
        let used: Vec<u32> = self.map.read().values().map(|s| s.relay_slot).collect();
        (1..).find(|n| !used.contains(n)).unwrap_or(1)
    }

    pub fn create(&self, req: &ServerCreate) -> AppResult<Server> {
        let name = req.name.trim();
        if name.is_empty() {
            return Err(AppError::Invalid("Name darf nicht leer sein".into()));
        }
        if req.mc_version.trim().is_empty() {
            return Err(AppError::Invalid("Minecraft-Version fehlt".into()));
        }
        let base = slug(name);
        let id = {
            let map = self.map.read();
            let mut id = base.clone();
            let mut n = 2;
            while map.contains_key(&id) || server_dir(&self.paths, &id).exists() {
                id = format!("{base}-{n}");
                n += 1;
            }
            id
        };
        let port = req.port.filter(|p| *p > 0).unwrap_or_else(|| self.free_port(None));
        let s = Server {
            id: id.clone(),
            name: name.to_string(),
            icon: None,
            accent: None,
            mc_version: req.mc_version.trim().to_string(),
            loader: req.loader.clone(),
            memory_mb: req.memory_mb,
            java_path: None,
            jvm_args: None,
            port,
            auto_start: false,
            auto_restart: true,
            connection: ServerConnection::Local,
            relay_address: None,
            eula: false,
            install_state: InstallState::NotInstalled,
            created_at: now_ms(),
            last_started: None,
            source_instance: req.from_instance.clone(),
            relay_slot: self.free_slot(),
            launch: None,
        };
        std::fs::create_dir_all(server_dir(&self.paths, &id))?;
        self.persist(&s)?;
        self.map.write().insert(id, s.clone());
        self.emit(&s);
        Ok(s)
    }

    pub fn modify<F: FnOnce(&mut Server)>(&self, id: &str, f: F) -> AppResult<Server> {
        let s = {
            let mut map = self.map.write();
            let s = map.get_mut(id).ok_or_else(|| AppError::NotFound(format!("Server {id}")))?;
            f(s);
            s.clone()
        };
        self.persist(&s)?;
        self.emit(&s);
        Ok(s)
    }

    pub fn patch(&self, id: &str, p: ServerPatch) -> AppResult<Server> {
        if let Some(n) = &p.name {
            if n.trim().is_empty() {
                return Err(AppError::Invalid("Name darf nicht leer sein".into()));
            }
        }
        if let Some(port) = p.port {
            if port == 0 {
                return Err(AppError::Invalid("Port muss zwischen 1 und 65535 liegen".into()));
            }
            let clash = self.map.read().values().any(|s| s.id != id && s.port == port);
            if clash {
                return Err(AppError::Invalid(format!("Port {port} wird schon von einem anderen Server verwendet")));
            }
        }
        self.modify(id, |s| {
            if let Some(v) = p.name { s.name = v.trim().to_string(); }
            if let Some(v) = p.accent { s.accent = v; }
            if let Some(v) = p.memory_mb { s.memory_mb = v.map(|m| m.clamp(512, 1024 * 256)); }
            if let Some(v) = p.java_path { s.java_path = v.filter(|x| !x.trim().is_empty()); }
            if let Some(v) = p.jvm_args { s.jvm_args = v.filter(|x| !x.trim().is_empty()); }
            if let Some(v) = p.port { s.port = v; }
            if let Some(v) = p.auto_start { s.auto_start = v; }
            if let Some(v) = p.auto_restart { s.auto_restart = v; }
            if let Some(v) = p.connection { s.connection = v; }
            if let Some(v) = p.relay_address { s.relay_address = v.map(|x| x.trim().to_string()).filter(|x| !x.is_empty()); }
        })
    }

    pub fn delete(&self, id: &str) -> AppResult<()> {
        self.map.write().remove(id);
        let dir = server_dir(&self.paths, id);
        if dir.exists() {
            std::fs::remove_dir_all(&dir).map_err(|e| AppError::msg(format!("Server-Ordner konnte nicht gelöscht werden (Datei in Benutzung?): {e}")))?;
        }
        crate::events::emit(&self.app, EV_REMOVED, &serde_json::json!({ "id": id }));
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn slugs() {
        assert_eq!(super::slug("Mein Server!"), "mein-server");
        assert_eq!(super::slug("Größe"), "groesse");
        assert_eq!(super::slug("///"), "server");
    }
}
