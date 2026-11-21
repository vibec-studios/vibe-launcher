//! Installierte Inhalte: Ordner scannen (mit Metadaten-Cache), Hash-Zuordnung zu Modrinth/CurseForge,
//! Aktivieren/Deaktivieren, Entfernen, Hinzufügen.

use super::index::{self, ContentIndex, IndexEntry, LocalMeta, UnknownHash};
use super::{curseforge as cf, modrinth as mr, *};
use crate::error::{AppError, AppResult};
use crate::state::AppState;
use futures::StreamExt;
use std::path::{Path, PathBuf};
use std::time::Duration;

mod scan;
mod identify;
mod ops;
#[cfg(test)]
mod tests;

pub use scan::*;
pub use identify::*;
pub use ops::*;

/// Erneute Hash-Abfrage für unbekannte Dateien frühestens nach 3 Tagen.
const UNKNOWN_RECHECK_MS: i64 = 3 * 24 * 3600 * 1000;
const IDENTIFY_BACKOFF: Duration = Duration::from_secs(60);
