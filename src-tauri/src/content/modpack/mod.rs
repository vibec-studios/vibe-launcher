//! Modpack-Updates: neue Pack-Versionen erkennen, Änderungen vorab zeigen und anwenden.
//!
//! Beim Import wird der Installationsstand in `instances/<id>/pack.json` festgehalten (Pack-Dateien und
//! SHA-1 der Overrides). Beim Update werden Pack-Dateien ausgetauscht, vom Nutzer hinzugefügte Inhalte
//! bleiben, und Overrides (Configs) werden nur überschrieben, wenn der Nutzer sie seit der Installation
//! nicht verändert hat – sonst bleibt seine Version (Konflikt-Hinweis).

use super::import::{self, ImportOptions, PackFile, PackPlan};
use super::index::{self, ContentIndex, IndexEntry};
use super::missing::{self, MissingEntry};
use super::{curseforge as cf, modrinth as mr, provider, *};
use crate::error::{AppError, AppResult};
use crate::instance::{Instance, Loader, PackSourceKind};
use crate::net::DownloadItem;
use crate::state::AppState;
use crate::tasks::TaskHandle;
use crate::util::safe_join;
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

mod record;
mod check;
mod target;
mod preview;
mod apply;
#[cfg(test)]
mod tests;

pub use record::*;
pub use check::*;
pub(crate) use target::*;
pub use preview::*;
pub use apply::*;
