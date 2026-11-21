//! Modrinth API v2 (https://docs.modrinth.com/api/). Kein Key nötig; User-Agent setzt `Net`.

use super::http;
use super::*;
use crate::error::AppResult;
use crate::state::AppState;
use serde::Deserialize;
pub use vibe_server_core::content::modrinth::*;

mod raw;
mod mapping;
mod api;
#[cfg(test)]
mod tests;

use raw::*;
pub use mapping::*;
pub use api::*;
