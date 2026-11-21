//! Ordner-Sync für Resourcepacks und Shaderpacks: ein gemeinsamer Ordner (`<data>/sync/<bereich>`), mit dem jede
//! synchronisierte Instanz vor dem Start und nach dem Beenden abgeglichen wird (3-Wege-Abgleich).
//!
//! Warum Kopien/Hardlinks statt Junctions/Symlinks: Die Instanzordner bleiben ganz normale Ordner. Snapshots,
//! Export, Löschen einer Instanz, Virenscanner und andere Programme sehen nie einen Verweis in einen fremden Ordner,
//! Abschalten verliert nichts (die Dateien liegen ja schon in der Instanz) und eine laufende Instanz wird nie
//! angefasst – abgeglichen wird nur die Instanz, die gerade startet bzw. beendet wurde. Große Dateien werden als
//! Hardlink abgelegt (gleiche Partition, kein Admin nötig, kein doppelter Speicher), kleine kopiert; klappt ein
//! Hardlink nicht, wird kopiert.
//!
//! Einheit ist ein Eintrag der obersten Ebene (Pack als `.zip` oder als Ordner, Shader-Einstellungen `.txt`).
//! `Base` merkt sich je Eintrag, wie er nach dem letzten Abgleich auf beiden Seiten aussah (Größe, Änderungszeit,
//! Dateianzahl, Namen). Daraus folgt, wer was geändert hat:
//! - nur eine Seite geändert -> auf die andere übertragen (auch Löschen; im gemeinsamen Ordner landet Gelöschtes
//!   im Papierkorb `<data>/sync/trash`, 30 Tage)
//! - beide geändert, gleicher Inhalt -> nichts zu tun
//! - eine Seite gelöscht, andere geändert -> die Änderung gewinnt (nichts geht verloren)
//! - beide geändert, unterschiedlicher Inhalt (Konflikt) -> der gemeinsame Stand behält den Namen, die Fassung der
//!   Instanz wird als „Name (Instanz).zip“ in beide Ordner gelegt und gemeldet.
//!
//! Gesperrte Dateien (z. B. von einer anderen laufenden Instanz geöffnet) werden übersprungen und beim nächsten
//! Abgleich erneut versucht.
use crate::error::AppResult;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};

mod model;
mod fsops;
mod sync;

pub use model::*;
pub use fsops::*;
pub use sync::*;

#[cfg(test)]
mod tests;
