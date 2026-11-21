//! Minecraft Bedrock als eigener Instanztyp: Erkennung, getrennte Profile (Tausch der `com.mojang`-Ordner),
//! Add-ons (CurseForge + Dateien), Welten, Start über das installierte Spiel.
//!
//! Verfahren und Grenzen: docs/BEDROCK.md. Kein Code aus anderen (GPL/AGPL-)Launchern übernommen.
//!
//! Sicherheitsnetz für die Entwicklung: Debug-Builds fassen echte Bedrock-Daten nur an, wenn
//! `VIBE_BEDROCK_REAL=1` gesetzt ist. Mit `VIBE_BEDROCK_ROOT=<ordner>` liegen alle Bedrock-Pfade unter
//! diesem Ordner (wie `%AppData%`), und „Spielen“ startet das echte Spiel nicht, sondern simuliert eine
//! Sitzung (`VIBE_BEDROCK_SIM_SECS`, Standard 20 s).
use crate::error::{AppError, AppResult};
use crate::instance::{BedrockChannel, BedrockProfile, Instance};
use crate::paths::Paths;
use serde::Serialize;
use std::path::{Path, PathBuf};

pub mod cf;
pub mod detect;
pub mod game;
pub mod issues;
pub mod manifest;
pub mod packs;
pub mod swap;
pub mod worlds;

mod locations;
mod folders;

pub use locations::*;
pub use folders::*;

/// Gemeinsamer Ordner für Packs im GDK-Layout (`Users/Shared/games/com.mojang`).
pub const SHARED_USER: &str = "Shared";

/// Aufbau der echten Spieldaten.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Layout {
    /// Ab 1.21.120: `<base>/Users/<id>/games/com.mojang` (Welten, Einstellungen) +
    /// `<base>/Users/Shared/games/com.mojang` (Packs)
    Gdk,
    /// Alte Store-App: alles in `<base>/games/com.mojang`
    Uwp,
}

impl Layout {
    /// Vorhandene `com.mojang`-Ordner („Slots“) unter `base`, relativ und mit `/` getrennt, sortiert.
    pub fn slots(&self, base: &Path) -> Vec<String> {
        let mut out = Vec::new();
        match self {
            Layout::Uwp => {
                if base.join("games").join("com.mojang").is_dir() {
                    out.push("games/com.mojang".to_string());
                }
            }
            Layout::Gdk => {
                if let Ok(rd) = std::fs::read_dir(base.join("Users")) {
                    for e in rd.flatten() {
                        let name = e.file_name().to_string_lossy().to_string();
                        if !valid_user_dir(&name) {
                            continue;
                        }
                        if e.path().join("games").join("com.mojang").is_dir() {
                            out.push(format!("Users/{name}/games/com.mojang"));
                        }
                    }
                }
            }
        }
        out.sort();
        out
    }

    /// Slot mit den Packs (`resource_packs`, `behavior_packs` …).
    pub fn packs_slot(&self) -> String {
        match self {
            Layout::Gdk => format!("Users/{SHARED_USER}/games/com.mojang"),
            Layout::Uwp => "games/com.mojang".into(),
        }
    }

    /// Slots, die Welten enthalten können (GDK: alle Spieler außer `Shared`).
    pub fn world_slots(&self, base: &Path) -> Vec<String> {
        match self {
            Layout::Uwp => self.slots(base),
            Layout::Gdk => self.slots(base).into_iter().filter(|s| s != &self.packs_slot()).collect(),
        }
    }
}

/// Nur harmlose Ordnernamen unter `Users/` (Zahlen-IDs, `Shared`).
fn valid_user_dir(name: &str) -> bool {
    !name.is_empty() && name.len() <= 64 && name.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_') && !name.starts_with('.')
}

/// Relativer Slot-Pfad -> absoluter Pfad unter `base`.
pub fn slot_path(base: &Path, slot: &str) -> PathBuf {
    let mut p = base.to_path_buf();
    for c in slot.split('/') {
        p.push(c);
    }
    p
}

// ------------------------------------------------------------------ Gemeinsame Abläufe (unter Sperre)

/// Etwas mit den Daten einer Bedrock-Instanz tun, während garantiert nicht getauscht wird.
pub fn with_data<T>(paths: &Paths, inst: &Instance, f: impl FnOnce(&DataLoc) -> AppResult<T>) -> AppResult<T> {
    let _g = game::DATA_LOCK.lock();
    let loc = data_loc(paths, inst)?;
    f(&loc)
}

/// Schreibender Zugriff, der bei laufendem Spiel nicht in den echten Ordner darf (Welten löschen/ersetzen).
pub fn with_data_idle<T>(paths: &Paths, inst: &Instance, f: impl FnOnce(&DataLoc) -> AppResult<T>) -> AppResult<T> {
    let ch = options(inst)?.channel;
    with_data(paths, inst, |loc| {
        if loc.live && game::game_running(ch) {
            return Err(AppError::Invalid(swap::RUNNING_MSG.into()));
        }
        f(loc)
    })
}

/// Höchstgröße einer importierten Datei.
pub const MAX_IMPORT: u64 = 4 * 1024 * 1024 * 1024;

/// `.mcpack`/`.mcaddon`/`.mcworld`/`.mctemplate`/`.zip` in eine Instanz übernehmen.
pub async fn import_file(state: &crate::state::AppState, instance_id: &str, path: &Path, source: Option<packs::PackSource>) -> AppResult<packs::ImportResult> {
    let inst = state.instances.get(instance_id)?;
    options(&inst)?;
    let paths = state.paths.clone();
    let path = path.to_path_buf();
    tokio::task::spawn_blocking(move || {
        let meta = std::fs::metadata(&path)?;
        if !meta.is_file() {
            return Err(AppError::Invalid("Keine Datei".into()));
        }
        if meta.len() > MAX_IMPORT {
            return Err(AppError::Invalid("Die Datei ist zu groß".into()));
        }
        let entries = manifest::read_zip(&std::fs::read(&path)?)?;
        with_data(&paths, &inst, |loc| {
            let wd = worlds::import_dir(loc);
            packs::import_entries(&loc.packs_dir(), wd.as_deref(), &entries, source.as_ref())
        })
    })
    .await?
}

/// Darf an der Instanz gerade etwas Grundlegendes passieren (Löschen, Duplizieren)? Nicht, solange ihr
/// Profil eingetauscht ist.
pub fn guard_idle(paths: &Paths, inst: &Instance) -> AppResult<()> {
    let Some(o) = inst.bedrock else { return Ok(()) };
    if o.profile == BedrockProfile::Isolated {
        if let Ok(t) = target(o.channel) {
            if swapper(paths, &t).active_instance().as_deref() == Some(inst.id.as_str()) {
                return Err(AppError::Invalid("Das Profil dieser Bedrock-Instanz ist gerade eingetauscht. Bitte das Spiel schließen und kurz warten.".into()));
            }
        }
    }
    Ok(())
}

/// Leerer Temp-Ordner für Tests.
#[cfg(test)]
pub fn tempdir(tag: &str) -> PathBuf {
    let p = std::env::temp_dir().join(format!("vl-bedrock-{tag}-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&p).unwrap();
    p
}

#[cfg(test)]
mod tests;
