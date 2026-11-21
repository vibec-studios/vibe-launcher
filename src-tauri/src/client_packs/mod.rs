//! Client-Packs: eine Auswahl von Client-Mods, die man mit einem Klick in eine Instanz installiert.
//!
//! - **Definition** (`PACKS`): ID, Kategorie (offiziell/Community), Quelle (Vibe-Backend, NoRisk-Liste,
//!   Modrinth-Projekte), Ausschluss-Gruppe und Kompatibilitätsregeln (Loader). Neue Packs = ein Eintrag mehr;
//!   Modrinth-Packs brauchen nur die Projekt-IDs.
//! - **Ausschluss**: Packs derselben Gruppe (`client`: Vibey, NoRisk, NoRisk Mini) gehen nur einzeln. Vor dem
//!   Installieren werden die anderen nach Bestätigung (in der Oberfläche) sauber entfernt.
//! - **Zustand**: `instances/<id>/client-packs.json` (Version, Dateien, Modrinth-Projekte je Pack). Der Vibey
//!   Client behält seinen eigenen Zustand (`vibey-client.json`, siehe `vibey_client::install`) und wird hier
//!   nur eingebunden.
//! - **Updates**: Vibey über das Manifest (wie bisher, auch still vor dem Start), NoRisk über den Jar-Namen hinter
//!   dem offiziellen Link (nur auf Klick), Modrinth-Packs über die normalen Inhalts-Updates.
pub mod commands;
pub mod norisk;

use crate::content::index::ContentIndex;
use crate::content::{install as cinstall, local, provider, ContentKind, Source};
use crate::error::{AppError, AppResult};
use crate::instance::{Instance, LoaderKind};
use crate::state::AppState;
use crate::tasks::TaskHandle;
use crate::vibey_client;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

mod defs;
mod store;
mod offer;
mod install;

pub use defs::*;
pub use store::*;
pub use offer::*;
pub use install::*;

#[cfg(test)]
mod tests;
