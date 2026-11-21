//! Vibey Client pro Instanz: Jar in `mods/` legen, Abhängigkeiten mitinstallieren, vor dem Start still
//! aktualisieren, beim Ausschalten entfernen.
//!
//! Das Jar ist eine vom Launcher **verwaltete** Datei: Zustand in `instances/<id>/vibey-client.json`
//! (Version, Dateiname, SHA-256). Deaktiviert der Nutzer die Mod in der Inhalte-Liste (`.disabled`),
//! bleibt sie auch nach Updates deaktiviert.
use super::{ClientFile, ClientRelease};
use crate::content::index::ContentIndex;
use crate::content::{install as cinstall, local, ContentKind, Source};
use crate::error::{AppError, AppResult};
use crate::instance::{CreateInstance, Instance, Loader, LoaderKind};
use crate::minecraft::LogLevel;
use crate::state::AppState;
use crate::tasks::TaskHandle;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::time::Duration;

mod state;
mod sync;
mod toggle;
mod instances;

pub use state::*;
pub use sync::*;
pub use toggle::*;
pub use instances::*;

#[cfg(test)]
mod tests;
