//! Abhängigkeits-Check installierter Mods: fehlende Pflicht-Abhängigkeiten, falsche Versionen, Konflikte
//! (`breaks`/`incompatible`), falscher Loader / falsche Minecraft-Version, doppelte Mods. Liegt eine fehlende
//! Abhängigkeit nur deaktiviert (`.disabled`) in `mods/`, heißt die Lösung „aktivieren“ statt „installieren“.
//!
//! Versionsbereiche: Fabric/Quilt-Ausdrücke (`>=1.2 <2`, `~1.20.1`, `^1.0`, `1.20.x`, `*`, `a || b`) und
//! Maven-Bereiche aus mods.toml (`[1.20.1,1.21)`, `[47,)`). Nicht auswertbare Angaben gelten als erfüllt.

use super::index::{ContentIndex, LocalMeta};
use super::local::Scanned;
use super::{modrinth as mr, ContentKind, Source};
use crate::error::AppResult;
use crate::instance::{Instance, LoaderKind};
use crate::state::AppState;
use serde::Serialize;
use std::cmp::Ordering;
use std::collections::HashMap;

mod version;
mod types;
mod loader;
mod check;
mod analyze;
#[cfg(test)]
mod tests;

pub use version::*;
pub use types::*;
pub use loader::*;
pub use check::*;
pub use analyze::*;
