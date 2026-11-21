//! Spiel: Versionen, Vanilla-Installation (Libraries, Natives, Assets), Java-Runtimes,
//! Mod-Loader (Fabric/Quilt/Forge/NeoForge), Start, Prozessverwaltung, Logs, mclo.gs.
//!
//! OWNER: Game-Agent. Öffentliche Typen/Signaturen sind Teil des Vertrags (docs/CONTRACT.md).
use crate::error::AppResult;
use serde::{Deserialize, Serialize};

pub use vibe_server_core::minecraft::forge;
pub mod hooks;
pub mod install;
pub mod java;
pub mod launch;
pub use vibe_server_core::minecraft::loaders;
pub use vibe_server_core::minecraft::log4shell;
pub mod logs;
pub use vibe_server_core::minecraft::meta;
pub mod prelaunch;
pub mod process;
pub mod resources;
pub mod sessions;

pub use vibe_server_core::minecraft::{JavaInstall, LoaderVersion, LogLevel, LogLine, McVersion};



#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RunState {
    /// Wird vorbereitet (Installation/Prüfung läuft)
    Preparing,
    /// Prozess läuft
    Running,
    /// Prozess beendet
    Stopped,
}

/// Payload von `game://state`.
#[derive(Debug, Clone, Serialize)]
pub struct GameState {
    /// Eigene ID der Sitzung (eine Instanz kann mehrfach laufen)
    pub run_id: String,
    pub instance_id: String,
    /// Laufende Nummer unter den gleichzeitigen Sitzungen der Instanz (1, 2, …)
    pub slot: u32,
    pub state: RunState,
    pub pid: Option<u32>,
    pub created_at: i64,
    pub started_at: Option<i64>,
    pub ended_at: Option<i64>,
    pub exit_code: Option<i32>,
    /// Beendet mit Fehlercode / Crash-Report erkannt
    pub crashed: bool,
    /// Pfad zum neuen Crash-Report, falls einer entstanden ist
    pub crash_report: Option<String>,
    pub account_name: Option<String>,
    /// UUID ohne Bindestriche
    pub account_uuid: Option<String>,
    pub world: Option<String>,
    pub server: Option<String>,
}



#[derive(Debug, Clone, Serialize)]
pub struct LogFile {
    /// Relativ zum Spielordner, z. B. "logs/latest.log" oder "crash-reports/crash-....txt"
    pub name: String,
    pub size: u64,
    pub modified: i64,
    /// "log" | "crash"
    pub kind: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct MclogsResult {
    pub id: String,
    pub url: String,
    pub raw: String,
}


pub use install::{install_instance_opts, Prepared};
pub use process::GameManager;

/// Stellt sicher, dass eine Instanz vollständig installiert ist (Vanilla + Loader + Java),
/// setzt `install_state`/`version_id` der Instanz. Wird auch vom Import verwendet.
pub async fn install_instance(state: &crate::state::AppState, instance_id: &str, progress: &crate::tasks::SubProgress) -> AppResult<()> {
    install::install_instance_opts(state, instance_id, progress, false).await.map(|_| ())
}
