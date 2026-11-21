//! Synchronisieren zwischen Instanzen. Je Instanz einzeln an/aus und je Bereich wählbar:
//!
//! - **Optionen** (`options.txt`: Steuerung inkl. Mod-Tastenbelegungen, Sound, Grafik inkl. OptiFine-`optionsof.txt`,
//!   Sprache, Zugänglichkeit): globales „Master-Profil“ (`options-sync.json`), vor jedem Start in die Instanz
//!   geschrieben und nach dem Beenden aus ihr übernommen. Nur bekannte Schlüssel; Tastenbelegungen nur bei passendem
//!   Format (ab 1.13 „key.…“).
//! - **Resourcepacks**: gemeinsamer Ordner ([`syncdir`]) + Auswahl/Reihenfolge der aktiven Packs (`resourcePacks`).
//!   Damit für eine Version inkompatible Packs nicht herausfallen, kommen gewählte Packs zusätzlich nach
//!   `incompatibleResourcePacks` – Minecraft lädt sie dann und markiert sie nur. Was das Spiel selbst aus der Liste
//!   wirft (Pack fehlt in dieser Instanz, z. B. ein Pack aus einem Mod), gilt nicht als „abgewählt“.
//! - **Shader**: gemeinsamer Ordner + gewählter Shader (`optionsshaders.txt`, `config/iris.properties`,
//!   `config/oculus.properties` – nur vorhandene Dateien werden angepasst).
//! - **Server-Liste**: `servers.dat` wird zusammengeführt ([`syncservers`]).
//! - **Screenshots**: werden nach dem Spielen zusätzlich in einem gemeinsamen Ordner gesammelt.
//!
//! Abgeglichen wird nur die Instanz, die gerade startet bzw. beendet wurde – laufende Instanzen bleiben unberührt.
//! Ablage: `<data>/sync/{resourcepacks,shaderpacks,screenshots,servers.dat,trash}`, Abgleichstand je Instanz in
//! `<data>/sync/state/<id>.json`. Abschalten verwirft nur den Abgleichstand; alle Dateien bleiben in der Instanz.
use super::{syncdir, syncservers};
use crate::error::AppResult;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet, HashSet};
use std::path::{Path, PathBuf};
mod personal;

mod keys;
mod config;
mod state;
mod merge;
mod options;
mod packs;
mod shader;
mod apply;
mod flow;

pub use keys::*;
pub use config::*;
pub use state::*;
pub use merge::*;
pub use options::*;
use packs::*;
use shader::*;
pub use apply::*;
pub use flow::*;

/// Bereiche aus `options.txt`.
pub const CATEGORIES: [&str; 6] = ["controls", "keybinds", "sound", "video", "language", "accessibility"];
/// Weitere Bereiche (Ordner, Server-Liste).
pub const AREAS: [&str; 6] = ["resourcepacks", "shaderpacks", "servers", "screenshots", "hotbars", "command_history"];
/// Bereiche mit gemeinsamem Ordner, der in beide Richtungen abgeglichen wird.
const DIR_AREAS: [&str; 2] = ["resourcepacks", "shaderpacks"];

#[cfg(test)]
mod tests;
