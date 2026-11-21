//! Einstellungen der Instanz aus einem anderen Launcher (RAM, Java, JVM-Argumente, Umgebungsvariablen,
//! Fenster, Start-Befehle, Notizen, Gruppe) – auslesen, mit der Vibe-Instanz vergleichen und übernehmen.
//! Quellen je Launcher: docs/IMPORT-SETTINGS.md.
//!
//! - Beim Import übernimmt `external::run_import` die gewählten Bereiche (`KEYS`, Standard: alle außer
//!   Start-Befehlen – die laufen auf dem Rechner und werden nur nach ausdrücklicher Wahl übernommen).
//! - Nachträglich: [`pending`] (alle importierten Instanzen mit Unterschieden in Einstellungen oder Daten),
//!   [`offer`] (eine Instanz), [`apply_offer`] (gewählte Werte setzen; Daten nach [`super::gamedata`]: fehlende
//!   nur hinzufügen, Überschreiben nur pro Eintrag ausdrücklich, vorher Snapshot bzw. Welt-Backup).
//! - Fremde Ordner werden nur gelesen. Accounts/Tokens werden nie angefasst.

use super::external::{self, Found};
use super::gamedata::{self, DataEntry, DataPick};
use super::LauncherKind;
use crate::error::{AppError, AppResult};
use crate::instance::{Instance, PackSource};
use crate::settings::Settings;
use crate::state::AppState;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{BTreeMap, HashMap, HashSet};
use std::path::Path;

mod compare;
mod java;
mod helpers;
mod prism;
mod modrinth;
mod launchers;
mod offer;
#[cfg(test)]
mod tests;

pub use compare::*;
pub use java::*;
pub use helpers::*;
pub use prism::*;
pub use modrinth::*;
pub use launchers::*;
pub use offer::*;

/// Bereiche, die beim Import (und nachträglich) gewählt werden können.
pub const KEYS: [&str; 8] = ["memory", "java", "jvm_args", "env", "window", "hooks", "notes", "group"];
/// Nur nachträglich (beim Import immer übernommen): Spielzeit, Icon, Modpack-Herkunft, fehlende Mods (NoRisk).
pub const EXTRA_KEYS: [&str; 4] = ["playtime", "icon", "pack", "mods"];

/// Start-Befehle laufen auf dem Rechner: nie automatisch übernehmen.
pub fn default_on(key: &str) -> bool {
    key != "hooks"
}

/// Standard-Auswahl beim Import.
pub fn default_keys() -> Vec<String> {
    KEYS.iter().filter(|k| default_on(k)).map(|k| k.to_string()).collect()
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct ExtSettings {
    pub min_memory_mb: Option<u32>,
    pub max_memory_mb: Option<u32>,
    /// Fester Java-Pfad der Instanz (globale Java-Wahl des fremden Launchers wird nicht übernommen)
    pub java_path: Option<String>,
    /// Java-Version laut fremdem Launcher bzw. Prüfung (nur Anzeige)
    pub java_version: Option<String>,
    pub jvm_args: Option<String>,
    pub env: BTreeMap<String, String>,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub fullscreen: Option<bool>,
    pub pre_launch: Option<String>,
    pub post_exit: Option<String>,
    pub wrapper: Option<String>,
    pub notes: Option<String>,
    pub group: Option<String>,
    /// Bereiche, deren Werte aus den Standard-Einstellungen des fremden Launchers stammen (Instanz erbt sie)
    pub inherited: Vec<String>,
}

fn clean(s: Option<String>) -> Option<String> {
    s.map(|s| s.trim().to_string()).filter(|s| !s.is_empty())
}

impl ExtSettings {
    /// Gibt es für diesen Bereich einen Wert?
    pub fn has(&self, key: &str) -> bool {
        match key {
            "memory" => self.min_memory_mb.is_some() || self.max_memory_mb.is_some(),
            "java" => self.java_path.is_some(),
            "jvm_args" => self.jvm_args.is_some(),
            "env" => !self.env.is_empty(),
            "window" => self.width.is_some() || self.height.is_some() || self.fullscreen.is_some(),
            "hooks" => self.pre_launch.is_some() || self.post_exit.is_some() || self.wrapper.is_some(),
            "notes" => self.notes.is_some(),
            "group" => self.group.is_some(),
            _ => false,
        }
    }

    pub fn is_empty(&self) -> bool {
        !KEYS.iter().any(|k| self.has(k))
    }

    fn inherit(&mut self, key: &str) {
        if !self.inherited.iter().any(|k| k == key) {
            self.inherited.push(key.to_string());
        }
    }

    /// Unsinnige Werte verwerfen, Texte trimmen.
    pub fn sanitize(mut self) -> Self {
        self.max_memory_mb = self.max_memory_mb.filter(|m| (256..=1024 * 1024).contains(m));
        self.min_memory_mb = self.min_memory_mb.filter(|m| *m >= 128 && self.max_memory_mb.map_or(true, |max| *m <= max));
        self.width = self.width.filter(|w| (100..=16384).contains(w));
        self.height = self.height.filter(|h| (100..=16384).contains(h));
        if self.width.is_none() || self.height.is_none() {
            self.width = None;
            self.height = None;
        }
        self.java_path = clean(self.java_path);
        self.java_version = clean(self.java_version);
        self.jvm_args = clean(self.jvm_args);
        self.pre_launch = clean(self.pre_launch);
        self.post_exit = clean(self.post_exit);
        self.wrapper = clean(self.wrapper);
        self.notes = self.notes.filter(|n| !n.trim().is_empty());
        self.group = clean(self.group);
        self.env = std::mem::take(&mut self.env).into_iter().map(|(k, v)| (k.trim().to_string(), v)).filter(|(k, _)| !k.is_empty() && !k.contains('=')).collect();
        let keep: Vec<String> = self.inherited.iter().filter(|k| self.has(k)).cloned().collect();
        self.inherited = keep;
        self
    }

    /// Geerbte Werte, die ohnehin den Vibe-Standards entsprechen, nicht je Instanz festschreiben.
    pub fn effective(mut self, vibe: &Settings) -> Self {
        let inh = |k: &str| self.inherited.iter().any(|x| x == k);
        if inh("memory") {
            if self.max_memory_mb == Some(vibe.max_memory_mb) {
                self.max_memory_mb = None;
            }
            if self.min_memory_mb == Some(vibe.min_memory_mb) {
                self.min_memory_mb = None;
            }
        }
        if inh("window") {
            if self.width == Some(vibe.game_width) && self.height == Some(vibe.game_height) {
                self.width = None;
                self.height = None;
            }
            if self.fullscreen == Some(vibe.fullscreen) {
                self.fullscreen = None;
            }
        }
        if inh("jvm_args") && self.jvm_args.as_deref().map(str::trim) == Some(vibe.jvm_args.trim()) {
            self.jvm_args = None;
        }
        if inh("hooks") && self.wrapper.is_some() && self.wrapper == clean(vibe.wrapper_command.clone()) {
            self.wrapper = None;
        }
        self.sanitize()
    }
}
