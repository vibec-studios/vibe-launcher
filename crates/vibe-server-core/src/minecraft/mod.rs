//! Spiel-/Server-Grundlagen: Versionen, Java-Runtimes, Mod-Loader, Log4Shell, Konsolen-Logs.
use serde::{Deserialize, Serialize};

pub mod forge;
pub mod java;
pub mod loaders;
pub mod log4shell;
pub mod logparse;
pub mod meta;
pub mod process;
pub mod adopt;

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
