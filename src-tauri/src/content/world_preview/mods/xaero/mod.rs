use super::stream::{Eof, Reader};
use super::tint::{self, Block, Climate, Tint, GRASS, WATER};
use super::Canvas;
use crate::content::world_preview::colors::Color;

mod decode;
mod pixel;

pub use decode::*;
use pixel::*;

const NOT_GRASS: u32 = 1;
const OVERLAYS: u32 = 1 << 1;
const VERTICAL_SLOPE: u32 = 1 << 4;
const HEIGHT_BYTE: u32 = 1 << 6;
const BIOME: u32 = 1 << 20;
const STATE_NEW: u32 = 1 << 21;
const BIOME_NEW: u32 = 1 << 22;
const BIOME_NUMERIC: u32 = 1 << 23;
const TOP_HEIGHT: u32 = 1 << 24;
const OVERLAY_NOT_WATER: u32 = 1;
const OVERLAY_OPACITY: u32 = 1 << 3;
const OVERLAY_STATE_NEW: u32 = 1 << 10;
pub const MAX_MAJOR: u16 = 8;
pub const MAX_MINOR: i32 = 8;
