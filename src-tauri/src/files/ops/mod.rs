//! Operationen des Datei-Bereichs (alle blockierend – Aufrufer nutzen `spawn_blocking`).
use super::sandbox::{check_name, is_link, plain, Resolved};
use super::*;
use crate::error::{AppError, AppResult};
use std::path::{Path, PathBuf};

mod backups;
mod list;
mod rw;
mod actions;

pub use backups::*;
pub use list::*;
pub use rw::*;
pub use actions::*;

fn invalid(msg: &str) -> AppError {
    AppError::Invalid(msg.to_string())
}

fn join_rel(dir: &str, name: &str) -> String {
    if dir.is_empty() {
        name.to_string()
    } else {
        format!("{dir}/{name}")
    }
}

fn base_name(rel: &str) -> &str {
    rel.rsplit('/').next().unwrap_or(rel)
}
