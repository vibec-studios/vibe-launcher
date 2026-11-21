//! Skin-Wechsel im Spiel (Vertrag 34, Vibey Client `docs/SKINS.md`): `.vibe/skins.json` + PNG-Kopien schreiben,
//! `.vibe/skin-request.json` jede Sekunde prüfen (nur solange eine Vibey-Instanz läuft), den Wechsel über die
//! Mojang-Skin-API ausführen und `.vibe/skin-result.json` schreiben.
use crate::auth::skins::{BridgeSkin, SkinVariant, SKINS_CHANGED};
use crate::error::{AppError, AppResult};
use crate::minecraft::RunState;
use crate::state::AppState;
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha1::{Digest, Sha1};
use std::collections::{HashMap, HashSet};
use std::path::Path;
use std::sync::OnceLock;
use std::time::Duration;
use tauri::{AppHandle, Listener, Manager};

mod files;
mod request;
mod runtime;

pub use files::*;
pub use request::*;
pub use runtime::*;

const SKINS_FILE: &str = "skins.json";
const REQUEST_FILE: &str = "skin-request.json";
const RESULT_FILE: &str = "skin-result.json";
const MAX_SKINS: usize = 500;
const REQUEST_MAX_AGE: i64 = 60;
const NAME_MAX: usize = 48;

#[cfg(test)]
mod tests;
