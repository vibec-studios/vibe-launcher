//! Spieldaten aus anderen Launchern: **eine** Regel für alle Launcher, was zum Spiel gehört (Import und
//! Nachimport), Vergleich Quelle ↔ Vibe-Instanz und Nachkopieren fehlender bzw. ausdrücklich gewählter Daten.
//!
//! - Mit kommt alles im Spielordner – Configs, Welten, Packs, Optionen, Daten anderer Mods (`xaero/`,
//!   `journeymap/`, `schematics/` …) – außer: Laufzeitreste ([`RUNTIME`]: Logs, Caches, Absturzberichte),
//!   Interna des Vanilla-Launchers ([`VANILLA_LAUNCHER`], falls ein ganzer `.minecraft` gewählt wurde),
//!   Interna des jeweiligen Launchers ([`launcher_skip`]) und – nur beim Nachimport – Mods (laufen über die
//!   Content-Logik).
//! - **Konten/Tokens** ([`is_secret`]) werden auf jeder Ebene übersprungen – nur der Name wird geprüft, die
//!   Datei wird nie geöffnet.
//! - Nachimport: [`scan`] vergleicht nur per Metadaten (Größe, Zeitstempel; Inhalt nur bei kleinen Dateien mit
//!   gleicher Größe). Standard ist „nur Fehlendes hinzufügen“; überschrieben wird nur pro Eintrag ausdrücklich.
//!   Welten werden einzeln angeboten und nie dateiweise gemischt (ganz hinzufügen oder ganz ersetzen).
//! - Fremde Ordner werden nur gelesen.

use super::srctree::{self, Overlay};
use super::LauncherKind;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::path::{Path, PathBuf};

mod rules;
mod types;
mod scan;
mod copy;
#[cfg(test)]
mod tests;

pub use rules::*;
pub use types::*;
pub use scan::*;
pub use copy::*;
