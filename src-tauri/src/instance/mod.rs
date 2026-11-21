//! Instanzen: Modell + Speicher (`instances/<id>/instance.json`).
use crate::error::{AppError, AppResult};
use crate::events;
use crate::paths::Paths;
use crate::util::{now_ms, write_json_atomic};
use parking_lot::RwLock;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tauri::AppHandle;

pub mod icon;

pub use vibe_server_core::model::{InstallState, Loader, LoaderKind};

mod model;
mod store;

pub use model::*;
pub use store::*;

#[cfg(test)]
mod tests;
