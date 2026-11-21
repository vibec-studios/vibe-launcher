//! Mod-Sets anwenden: jedes Projekt eines Sets für Minecraft-Version und Loader einer Instanz auflösen
//! (neueste passende, bevorzugt stabile Version, inkl. Pflicht-Abhängigkeiten), Vorschau mit Gründen für
//! „nicht verfügbar“ und Alternativen, Installation als Aufgabe (vorher Sicherung), Merken je Instanz, welche Sets
//! angewendet wurden (Hinweis auf neue Projekte), und eine Kompatibilitätsübersicht je Set.
//!
//! Es wird nie etwas entfernt: Konflikte mit vorhandenen Mods werden nur angezeigt.

use super::index::ContentIndex;
use super::install::{self, Planned};
use super::sets::{self, norm, SetEntry};
use super::{curseforge as cf, modrinth as mr, provider, *};
use crate::error::{AppError, AppResult};
use crate::instance::Instance;
use crate::state::AppState;
use crate::tasks::TaskHandle;
use futures::StreamExt;
use serde::{Deserialize, Serialize};
use std::cmp::Ordering;
use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};
use std::path::PathBuf;

mod mc;
mod resolve;
mod types;
mod preview;
mod check;
mod applied;
mod run;
mod compat;
#[cfg(test)]
mod tests;

pub use mc::*;
pub use resolve::*;
pub use types::*;
pub use preview::*;
pub use check::*;
pub use applied::*;
pub use run::*;
pub use compat::*;
