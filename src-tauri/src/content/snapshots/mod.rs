//! Instanz-Snapshots: Mods, Configs, Packs und Optionen einer Instanz (keine Welten).
//!
//! ```text
//! <data>/backups/objects/<ab>/<sha1>               Inhalte, nach SHA-1 adressiert (dedupliziert)
//! <data>/backups/snapshots/<instanz>/<id>.json     Manifest: Dateien {rel_path, sha1, size} + Metadaten
//! <data>/backups/snapshots/<instanz>/hashes.cache  SHA-1-Cache für .jar/.zip (Größe + Änderungszeit)
//! ```
//!
//! `.jar`/`.zip` werden nie an Ort und Stelle verändert (Updates schreiben neue Dateien) – sie werden
//! deshalb per Hardlink abgelegt bzw. wiederhergestellt. Alles andere (Configs!) wird kopiert. Klappt
//! ein Hardlink nicht (anderes Laufwerk), wird ebenfalls kopiert. Beim Löschen eines Snapshots werden
//! Objekte entfernt, auf die kein Manifest mehr verweist.
//!
//! Teil-Snapshots: Ein Snapshot kann nur einige [`SCOPES`] enthalten (z. B. nur Mods vor „Probleme beheben“).
//! Das Manifest merkt sich die Bereiche (`scopes`); beim Wiederherstellen werden ausschließlich diese Bereiche
//! angefasst – ein Snapshot ohne Resourcepacks lässt den Resourcepacks-Ordner also in Ruhe. `content.json` wird
//! dabei nur für die enthaltenen Ordner zurückgesetzt (Einträge anderer Ordner bleiben, wie sie sind).

use crate::error::{AppError, AppResult};
use super::{migration::{self, GameVersion}, missing};
use crate::paths::Paths;
use crate::state::AppState;
use crate::tasks::SubProgress;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};

mod scope;
mod types;
mod progress;
mod paths;
mod objects;
mod manifests;
mod sync;
mod api;
#[cfg(test)]
mod tests;

pub use scope::*;
pub use types::*;
pub(crate) use progress::*;
pub(crate) use paths::*;
use objects::*;
use manifests::*;
pub(crate) use manifests::{drop_instance, referenced};
pub(crate) use sync::*;
pub use api::*;
