//! CurseForge Core API (https://docs.curseforge.com/rest-api/). Benötigt `x-api-key`.

use super::http;
use super::*;
use crate::error::{AppError, AppResult};
use crate::state::AppState;
use serde::Deserialize;
use serde_json::json;

mod raw;
mod mapping;
mod convert;
mod api;
#[cfg(test)]
mod tests;

pub use raw::*;
pub use mapping::*;
pub use convert::*;
pub use api::*;

pub const API: &str = "https://api.curseforge.com/v1";
pub const GAME_ID: u32 = 432;
const S: &str = "CurseForge";

pub const CLASS_MODS: u32 = 6;
pub const CLASS_MODPACKS: u32 = 4471;
pub const CLASS_RESOURCEPACKS: u32 = 12;
pub const CLASS_SHADERS: u32 = 6552;
pub const CLASS_DATAPACKS: u32 = 6945;

// modLoaderType
pub const ML_FORGE: u32 = 1;
pub const ML_FABRIC: u32 = 4;
pub const ML_QUILT: u32 = 5;
pub const ML_NEOFORGE: u32 = 6;
