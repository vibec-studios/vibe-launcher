//! Spiel: Versionen, Vanilla-Installation (Libraries, Natives, Assets), Java-Runtimes,
//! Mod-Loader (Fabric/Quilt/Forge/NeoForge), Start, Prozessverwaltung, Logs, mclo.gs.
//!
//! OWNER: Game-Agent. Öffentliche Typen/Signaturen sind Teil des Vertrags (docs/CONTRACT.md).
use crate::error::{AppError, AppResult};
use crate::paths::Paths;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tauri::AppHandle;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McVersion {
    pub id: String,
    /// "release" | "snapshot" | "old_beta" | "old_alpha"
    pub kind: String,
    /// ISO-8601
    pub release_time: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LoaderVersion {
    pub version: String,
    pub stable: bool,
}

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
    pub instance_id: String,
    pub state: RunState,
    pub pid: Option<u32>,
    pub started_at: Option<i64>,
    pub exit_code: Option<i32>,
    /// Beendet mit Fehlercode / Crash-Report erkannt
    pub crashed: bool,
    /// Pfad zum neuen Crash-Report, falls einer entstanden ist
    pub crash_report: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum LogLevel {
    Trace,
    Debug,
    Info,
    Warn,
    Error,
    Fatal,
    /// Unstrukturierte Ausgabe (stdout/stderr ohne Log4j-Level)
    Stdout,
    Stderr,
    /// Meldungen des Launchers selbst (Startbefehl, Java-Pfad ...)
    Launcher,
}

#[derive(Debug, Clone, Serialize)]
pub struct LogLine {
    /// Fortlaufende Nummer innerhalb der Sitzung
    pub seq: u64,
    /// "HH:MM:SS" (falls bekannt)
    pub time: Option<String>,
    pub level: LogLevel,
    pub thread: Option<String>,
    pub logger: Option<String>,
    pub text: String,
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

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JavaInstall {
    /// Pfad zu java(w).exe
    pub path: String,
    /// z. B. "21.0.5"
    pub version: String,
    pub major: u32,
    pub vendor: Option<String>,
    /// "x64" | "x86" | "aarch64"
    pub arch: String,
    /// Vom Launcher heruntergeladen
    pub managed: bool,
}

/// Verwaltet laufende Spielprozesse und ihre Log-Puffer.
pub struct GameManager {
    #[allow(dead_code)]
    paths: Paths,
    #[allow(dead_code)]
    app: AppHandle,
}

impl GameManager {
    pub fn new(paths: Paths, app: AppHandle) -> Arc<Self> {
        Arc::new(GameManager { paths, app })
    }

    pub fn states(&self) -> Vec<GameState> {
        vec![]
    }

    pub fn is_running(&self, _instance_id: &str) -> bool {
        false
    }
}

/// Stellt sicher, dass eine Instanz vollständig installiert ist (Vanilla + Loader + Java),
/// setzt `install_state`/`version_id` der Instanz. Wird auch vom Import verwendet.
pub async fn install_instance(_state: &crate::state::AppState, _instance_id: &str, _progress: &crate::tasks::SubProgress) -> AppResult<()> {
    Err(AppError::msg("noch nicht implementiert"))
}
