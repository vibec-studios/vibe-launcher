//! Import von Modpacks als neue Instanz: `.mrpack`, CurseForge-ZIP, `.vlpack`, Prism-/MultiMC-Export.
//! Außerdem `modpack_install` (Modpack von Modrinth/CurseForge laden und importieren).
//!
//! Das Spiel selbst (Vanilla/Loader/Java) wird hier **nicht** installiert (siehe docs/CONTRACT.md).

use super::index::{self, ContentIndex, IndexEntry};
use super::missing::{self, MissingEntry};
use super::{curseforge as cf, modrinth as mr, provider, *};
use crate::error::{AppError, AppResult};
use crate::instance::{Instance, InstallState, Loader, PackSource, PackSourceKind};
use crate::net::DownloadItem;
use crate::state::AppState;
use crate::tasks::{SubProgress, TaskHandle};
use crate::util::safe_join;
use serde::Deserialize;
use std::io::Read;
use std::path::{Path, PathBuf};

mod plan;
mod formats;
mod parse;
mod prism;
mod analyze;
mod overrides;
mod instance;
mod run;
mod modpack_install;
#[cfg(test)]
mod tests;

pub use plan::*;
pub use formats::*;
pub use parse::*;
pub use prism::*;
pub use analyze::*;
pub use overrides::*;
pub(crate) use instance::*;
pub use run::*;
pub use modpack_install::*;
