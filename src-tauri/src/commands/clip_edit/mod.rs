//! Clip-Editor (Vertrag 14, CLIPS.md §15): Schnitt `trim` nicht-destruktiv speichern und als neuen Clip exportieren.
//! Export ohne Neukodierung (`-c copy`) mit dem FFmpeg, das der Vibey Client in die Instanz geladen hat
//! (`vibeyclient/ffmpeg/bin`), sonst FFmpeg aus dem PATH. Der Schnitt beginnt am letzten Keyframe vor dem Wunschstart.
use super::clips::{self, checked_clip, int_field, parse_clip, str_field, valid_id, Clip, Parsed, TrimRange, SCHEMA};
use crate::error::{AppError, AppResult};
use crate::state::AppState;
use serde::Serialize;
use serde_json::{Map, Value};
use std::path::{Path, PathBuf};
use tauri::State;

mod meta;
mod ffmpeg;
mod api;

pub use meta::*;
pub use ffmpeg::*;
pub use api::*;

#[cfg(test)]
mod tests;
