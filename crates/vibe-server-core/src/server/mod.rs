//! Lokale Minecraft-Server: Modell + Speicher, Installation, Prozesse/Konsole, server.properties,
//! Spielerlisten, Backups, Verbindungen (LAN, Vibe-Relay, playit.gg).
//!
//! OWNER: Game-Agent. Ordner: `<daten>/servers/<id>/` (Arbeitsordner des Servers) mit `vibe-server.json`.
use crate::error::{AppError, AppResult};
use crate::model::{InstallState, Loader};
use crate::paths::Paths;
use crate::util::{now_ms, write_json_atomic};
use parking_lot::RwLock;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use crate::events::Sink;

pub mod backup;
pub mod install;
pub mod platform;
pub mod plugins;
pub mod players;
pub mod playit;
pub mod props;
pub mod relay;
pub mod run;
pub mod sides;
pub mod extras;
pub mod udp;
pub mod ops;
pub mod modpack;

pub use run::ServerManager;

mod store;
pub use store::*;

pub const EV_CHANGED: &str = "servers://changed";
pub const EV_REMOVED: &str = "servers://removed";
pub const EV_STATUS: &str = "server://status";
pub const EV_LOG: &str = "server://log";
pub const EV_CLOSE_REQUESTED: &str = "servers://close-requested";

pub const DEFAULT_MEMORY_MB: u32 = 2048;
/// Offizieller Relay-Host (seit dem Domain-Umzug `relay.axolite.cc`, gleicher Port; siehe `crate::domains`).
pub const DEFAULT_RELAY: &str = crate::domains::RELAY;
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
    /// Plugin-Server-Software (Paper/Purpur/Folia). Gesetzt -> `loader` ist Vanilla und wird ignoriert.
    #[serde(default)]
    pub platform: Option<platform::Platform>,
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
    /// Sprachchat (Simple Voice Chat) über den Relay anbieten (Vertrag 04)
    #[serde(default)]
    pub voice: bool,
    /// Bedrock-Spieler (Geyser + Floodgate) über den Relay erlauben (Vertrag 28)
    #[serde(default)]
    pub bedrock: bool,
}

impl Server {
    /// Ordner für Erweiterungen (`plugins` bzw. `mods`); Vanilla hat keinen.
    pub fn addon_dir(&self) -> Option<&'static str> {
        if self.platform.is_some() {
            Some("plugins")
        } else if self.loader.kind != crate::model::LoaderKind::Vanilla {
            Some("mods")
        } else {
            None
        }
    }
    pub fn memory(&self) -> u32 {
        self.memory_mb.unwrap_or(DEFAULT_MEMORY_MB).max(512)
    }
    /// Relay-Adresse: immer der offizielle Vibey-Relay (eine früher je Server gespeicherte `relay_address` wird beim
    /// Einlesen verworfen). Nur Debug-Builds dürfen per Env `VIBE_RELAY` auf einen lokalen Relay umleiten.
    pub fn relay(&self) -> String {
        relay_address(crate::util::debug_override("VIBE_RELAY"))
    }
}

fn relay_address(over: Option<String>) -> String {
    // Alter Standard-Host -> neuer; eigene Adressen bleiben
    over.map(|o| crate::domains::migrate_relay(&o)).unwrap_or_else(|| DEFAULT_RELAY.to_string())
}

#[derive(Debug, Clone, Deserialize)]
pub struct ServerCreate {
    pub name: String,
    pub mc_version: String,
    pub loader: Loader,
    #[serde(default)]
    pub platform: Option<platform::Platform>,
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
}

pub fn servers_root(paths: &Paths) -> PathBuf {
    paths.root.join("servers")
}

pub fn server_dir(paths: &Paths, id: &str) -> PathBuf {
    servers_root(paths).join(id)
}

#[cfg(test)]
mod tests;
