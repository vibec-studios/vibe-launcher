//! Dateien, die manuell heruntergeladen werden müssen (`instances/<id>/missing.json`).
//!
//! CurseForge erlaubt Autoren, Downloads über Drittanbieter-Launcher zu sperren (`allowModDistribution == false`,
//! `downloadUrl == null`). Solche Dateien landen hier als „erwartet“; das Frontend zeigt einen Hinweis mit Link
//! zur Dateiseite. Lädt der Nutzer die Datei im Browser, findet Vibe sie im Download-Ordner des Systems
//! (auch umbenannt wie `name (1).jar`), prüft sie per SHA-1 bzw. CurseForge-Fingerprint und verschiebt sie
//! in den Instanzordner. **Nur Dateien mit passendem Hash werden verschoben.** Nach „Auf CurseForge
//! herunterladen“ wird der Ordner einige Minuten lang beobachtet (`watch`).

use super::index::{self, ContentIndex, IndexEntry};
use super::{curseforge as cf, ContentKind, ManualArrived, MissingDownload, MissingScan, Source};
use crate::error::AppResult;
use crate::paths::Paths;
use crate::state::AppState;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::Ordering;
use std::time::{Duration, Instant, SystemTime};

mod entries;
mod detect;
mod flow;
#[cfg(test)]
mod tests;

pub use entries::*;
pub use detect::*;
pub use flow::*;

/// Wie lange der Download-Ordner nach „Auf CurseForge herunterladen“ beobachtet wird.
pub const WATCH_FOR: Duration = Duration::from_secs(10 * 60);
const TICK: Duration = Duration::from_secs(2);
