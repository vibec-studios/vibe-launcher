//! Clips des Vibey Clients (`instances/<id>/minecraft/vibeyclient/clips/`): Liste, Bearbeiten (nur `kept`, `title`,
//! `tags`), Löschen auf Wunsch, Ordner öffnen und ein leichtes Ordner-Polling, solange die Clips-Seite offen ist.
//! Vertrag: Vibey Client `docs/CLIPS.md` §10 (schema 1). Der Launcher löscht nie selbst, lädt nichts hoch und füllt
//! ein fehlendes `server` nie aus `session.json` auf (§10.4).
use crate::error::{AppError, AppResult};
use crate::state::AppState;
use regex::Regex;
use serde::Serialize;
use serde_json::{Map, Value};
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicI64, Ordering};
use std::sync::OnceLock;
use std::time::Duration;
use tauri::{AppHandle, Manager, State};

mod model;
mod paths;
mod read;
mod edit;
mod api;
mod watch;

pub use model::*;
pub use paths::*;
pub(crate) use read::*;
pub use edit::*;
pub use api::*;
pub use watch::*;

#[cfg(test)]
mod tests;
