//! Startbefehl bauen (Klassenpfad, Platzhalter, Speicher, JVM-/Spiel-Argumente) und Spiel starten.
use super::install::Prepared;
use super::meta::{eval_args, Env};
use super::LogLevel;
use crate::auth::LaunchAccount;
use crate::error::{AppError, AppResult};
use crate::instance::Instance;
use crate::settings::Settings;
use crate::state::AppState;
use crate::tasks::TaskHandle;
use std::collections::HashMap;
use std::path::PathBuf;

mod build;
mod run;

pub use build::*;
pub use run::*;

pub const LAUNCHER_NAME: &str = "vibe-launcher";

pub struct LaunchPlan {
    pub program: PathBuf,
    pub args: Vec<String>,
    pub env: HashMap<String, String>,
    pub cwd: PathBuf,
    /// Für das Log: ohne Token, Klassenpfad gekürzt
    pub display: String,
}

pub use vibe_server_core::util::split_args;

#[cfg(test)]
mod tests;
