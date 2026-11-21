//! „Spiel mit mir“-Links (Vertrag: docs/PLAY-LINKS.md).
//!
//! - `<spielordner>/.vibe/instance.json` schreibt der Launcher vor jedem Start (§2); gelesen hat sie der eingestellte Vibey Client.
//! - `<spielordner>/.vibe/session.json` schrieb der Client, solange das Spiel lief; der Launcher liest sie weiter für den
//!   Discord-Status und „Einladungslink kopieren“.
//! - `join`: Link laden, passende Instanz finden oder anlegen, danach startet das Frontend per Quick Play.
pub mod join;

use crate::content::index::ContentIndex;
use crate::content::Source;
use crate::error::AppResult;
use crate::instance::{Instance, PackSourceKind};
use crate::state::AppState;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

mod types;
mod file;
mod session;
mod matching;

pub use types::*;
pub use file::*;
pub use session::*;
pub use matching::*;

/// Ab diesem Alter (Sekunden) gilt `session.json` als veraltet.
pub const SESSION_STALE_SECS: i64 = 60;

#[cfg(test)]
mod tests;
