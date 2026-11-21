//! Inhalte: Modrinth- und CurseForge-Integration (Suche, Details, Versionen, Installation mit
//! Abhängigkeiten, Updates), Verwaltung installierter Mods/Packs/Shader, Welten,
//! Import (mrpack, CurseForge-ZIP, vlpack, Prism/MultiMC) und Export.
//!
//! OWNER: Content-Agent. Öffentliche Typen/Signaturen sind Teil des Vertrags (docs/CONTRACT.md).
use crate::instance::{Loader, LoaderKind};
use crate::paths::Paths;
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tauri::AppHandle;

pub use vibe_server_core::content::{ContentKind, GalleryImage, ProjectLinks, Side, Source, StoreKey};
pub mod curseforge;
pub mod datapacks;
pub mod export;
pub mod external;
pub mod gamedata;
pub mod gdlauncher;
pub mod extmods;
pub mod extsettings;
pub use vibe_server_core::content::http;
pub mod import;
pub mod importreport;
pub use vibe_server_core::content::index;
pub mod install;
pub mod local;
pub use vibe_server_core::content::meta;
pub mod missing;
pub mod modrinth;
pub mod norisk;
pub use vibe_server_core::content::murmur;
pub mod nbt;
pub mod provider;
pub mod store;
pub mod snapshots;
pub mod srctree;
pub mod vanilla;
pub mod deps;
pub mod autofix;
pub mod loaderfix;
pub mod refresh;
pub mod sides;
pub mod modsets;
pub mod sets;
pub mod sets_apply;
pub mod perf;
pub mod quick_mod;
pub mod modpack;
pub mod modpack_from;
pub mod packwiz;
pub mod mroverrides;
pub mod autoupdate;
pub mod migration;
pub mod worlds;
pub mod world_preview;
pub mod worldbackup;
pub mod organize;
mod state;
mod types;

pub use state::*;
pub use types::*;
