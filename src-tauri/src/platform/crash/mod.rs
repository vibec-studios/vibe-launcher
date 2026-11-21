//! Crash-Analyse: regelbasiertes Auswerten von Crash-Reports und Logs.
//! Ergebnis sind „Diagnosen“ mit Schuldigem (Mod), Klartext-Erklärung (Frontend), Fundstelle und Fix-Vorschlag.
//!
//! Die Muster stehen als Daten in `patterns.toml` (Regex + Auswertung), bekannte unverträgliche Mod-Paare in
//! `conflicts.toml`. Beispiel-Logs (anonymisiert) liegen unter `testdata/` und sind die Tests der Regeln.
//! Ausgewertet wird nur das letzte Startprotokoll (Crash-Report der Sitzung, `latest.log`, Konsolenausgabe);
//! große Dateien werden gestreamt (`logs.rs`).
mod logs;

pub use logs::LogText;

use regex::{Captures, Regex};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap, HashSet};
use std::path::Path;
use std::sync::OnceLock;

mod types;
mod mods;
mod rules;
mod context;
mod matchers;
mod handle;
mod pairs;
mod analyze;
mod sources;

pub use types::*;
pub use mods::*;
use rules::*;
pub use context::*;
use matchers::*;
use handle::*;
pub use pairs::*;
pub use analyze::*;
pub use sources::*;

#[cfg(test)]
mod tests;
