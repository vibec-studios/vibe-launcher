//! Mod-Sets (Wunschlisten): globale, benannte Listen von Projekten (Modrinth/CurseForge, je mit Art:
//! Mod, Resourcepack, Shader, Datapack), die sich auf jede Instanz anwenden lassen. Gespeichert in
//! `<data>/mod_sets.json`. Anders als die Profile einer Instanz (`content/modsets.rs`, Ein/Aus-Zustände von
//! Dateien) beschreibt ein Set *Projekte* – welche Datei passt, wird erst beim Anwenden für Minecraft-Version
//! und Loader der Instanz bestimmt (`content/sets_apply.rs`).
//!
//! Außerdem hier: Teilen (Datei/Code), Einlesen einer Liste von Links/Namen und das Übernehmen eines alten
//! Profils als Set.

use super::index::ContentIndex;
use super::{curseforge as cf, modrinth as mr, provider, ContentKind, ProjectType, SearchQuery, SortOrder, Source};
use crate::error::{AppError, AppResult};
use crate::paths::Paths;
use crate::state::AppState;
use base64::Engine;
use futures::StreamExt;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::io::{Read, Write};
use std::path::PathBuf;

mod model;
mod store;
mod share;
mod lines;
mod text_import;
mod candidates;
#[cfg(test)]
mod tests;

pub use model::*;
pub use store::*;
pub use share::*;
pub use lines::*;
pub use text_import::*;
pub use candidates::*;
