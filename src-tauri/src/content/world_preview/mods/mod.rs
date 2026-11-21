use super::colors::Color;
use super::{contained, read_limited};
use crate::error::{AppError, AppResult};
use image::{Rgba, RgbaImage};
use serde::Serialize;
use std::collections::HashSet;
use std::fs::{self, File};
use std::path::{Path, PathBuf};
use std::time::SystemTime;
use tokio_util::sync::CancellationToken;

pub use sources::{list as list_sources, MapSource};
pub use tiles::LODS;
pub use waypoints::Waypoint;

mod journeymap;
mod names;
mod sources;
mod stream;
mod tiles;
mod tint;
mod waypoints;
mod xaero;
mod canvas;
mod scan;
mod layers;
mod query;
#[cfg(test)]
mod tests;

pub use canvas::*;
pub use scan::*;
pub use layers::*;
pub use query::*;

pub const REGION: u32 = 512;
const MAX_REGIONS: usize = 40_000;
const MAX_WAYPOINT_FILE: usize = 2 * 1024 * 1024;
const MAX_WAYPOINT_FILES: usize = 32;
