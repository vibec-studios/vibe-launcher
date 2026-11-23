//! „Probleme beheben“: erkennt die behebbaren Probleme einer Instanz (Abhängigkeits-Check, bekannte
//! Konflikte laut Modrinth, letzte Crash-Analyse), zeigt sie als Plan und führt die gewählten Schritte aus.
//!
//! Ablauf:
//! 1. [`needs`] (rein, getestet): Probleme -> Bedarf (installieren, aktivieren, deaktivieren, Version tauschen …),
//!    dedupliziert und ohne Widersprüche (eine Mod, die deaktiviert/ersetzt wird, braucht keine Abhängigkeiten mehr).
//!    Der Loader (Version passt nicht zu den Mods, Installation unvollständig/beschädigt/fehlgeschlagen) kommt aus
//!    [`loaderfix::loader_needs`] dazu.
//! 2. [`plan`]: Bedarf über Modrinth/CurseForge auflösen (passende Version, Projekt zur Mod-ID, Java, Loader-Version).
//! 3. [`run_apply`]: Snapshot anlegen (Rückgängig), dann deaktivieren/aktivieren, tauschen/installieren, Java/RAM,
//!    zuletzt Loader umstellen bzw. neu installieren (schlägt das fehl, bleibt die alte Loader-Version eingestellt).
//!    Nichts wird ohne Sicherung gelöscht: doppelte und unpassende Mods werden nur deaktiviert (`.disabled`),
//!    ersetzte Dateien liegen im Snapshot. Gesperrte CurseForge-Dateien werden nur verlinkt (manueller Download).
//! 4. [`run_undo`]: Snapshot wiederherstellen, Java/RAM zurücksetzen, vorgemerkte manuelle Downloads austragen.

use super::deps::{self, DepIssue, Fix, IssueKind};
use super::index::{self, ContentIndex};
use super::loaderfix::{self, LoaderNeed};
use super::{install, local, missing, modrinth as mr, snapshots, ContentKind, MissingDownload, ProjectVersion, Source};
use crate::error::{AppError, AppResult};
use crate::instance::{Instance, InstancePatch, JavaOptions, Loader, LoaderKind};
use crate::platform::crash::{self, Action as CrashAction, Diagnosis};
use crate::state::AppState;
use crate::tasks::TaskHandle;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};

mod types;
mod need;
mod need_scan;
mod quick;
mod plan;
mod plan_steps;
mod gate;
mod apply;
mod undo;
#[cfg(test)]
mod tests;

pub use types::*;
pub use need::*;
pub use need_scan::*;
pub use quick::*;
pub use plan::*;
use plan_steps::*;
pub use gate::ModelGate;
use gate::ask_all;
pub use apply::*;
pub use undo::*;

pub const SNAPSHOT_NAME: &str = "Vor „Probleme beheben“";
const REPORT_FILE: &str = "autofix.json";
