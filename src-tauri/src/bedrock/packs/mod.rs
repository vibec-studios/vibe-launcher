//! Installierte Packs einer Bedrock-Instanz: Liste, Installation aus Archiven, Entfernen, Export,
//! Aktivieren je Welt (`world_resource_packs.json` / `world_behavior_packs.json`).
use super::manifest::{self, Entry, Found, Manifest, PackKind};
use crate::error::{AppError, AppResult};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

mod list;
mod install;
mod world;

pub use list::*;
pub use install::*;
pub use world::*;

// ------------------------------------------------------------------ Packs je Welt

#[cfg(test)]
mod tests;
