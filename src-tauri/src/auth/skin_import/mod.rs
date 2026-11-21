//! Skins aus anderen Launchern finden und in die eigene Bibliothek übernehmen. Fremde Dateien werden
//! ausschließlich gelesen, nie verändert.
//!
//! - **Modrinth App**: SQLite `<data>/ModrinthApp/app.db` (Tabellen `custom_minecraft_skins` +
//!   `custom_minecraft_skin_textures`, PNG als BLOB, Variante CLASSIC/SLIM, `cape_id` = Mojang-Cape-UUID).
//!   Die Datenbank läuft im WAL-Modus; damit wir nichts an ihr (auch nicht an `-shm`) verändern, wird sie
//!   samt `-wal`/`-shm` in einen eigenen Temp-Ordner kopiert, dort gelesen und die Kopie sofort gelöscht.
//!   `THESEUS_CONFIG_DIR` verlegt den Ordner (wie in der App).
//! - **NoRisk Client**: `minecraft_skins.json` (`{ skins: [{ id, name, base64_data, variant, added_at }] }`)
//!   unter Windows `%APPDATA%\norisk\NoRiskClientV3`, macOS `~/Library/Application Support/gg.norisk.NoRiskClientV3`,
//!   Linux `~/.local/share/noriskclientv3`.
//! - **Lunar Client**: `~/.lunarclient/settings/game/saved_skins.json` (Objekt Textur-URL -> `{ type, name }`);
//!   enthält nur URLs, die PNGs kommen von textures.minecraft.net. Standard-Steve/Alex werden übersprungen.
use super::skins::{self, SkinVariant};
use crate::error::{AppError, AppResult};
use crate::state::AppState;
use base64::Engine;
use serde::{Deserialize, Serialize};
use sha1::{Digest, Sha1};
use std::collections::HashSet;
use std::path::{Path, PathBuf};

mod model;
mod readers;
mod autostate;
mod import;

pub use model::*;
pub use readers::*;
pub use autostate::*;
pub use import::*;

#[cfg(test)]
mod tests;
