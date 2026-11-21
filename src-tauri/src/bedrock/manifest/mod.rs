//! `manifest.json` von Bedrock-Packs lesen (tolerant: Kommentare, nachgestellte Kommas, Versionen als
//! Liste oder Text) und Archive (`.mcpack`, `.mcaddon`, `.mcworld`, `.mctemplate`) untersuchen.
use crate::error::{AppError, AppResult};
use serde::Serialize;
use std::io::Read;

mod parse;
mod archive;

pub use parse::*;
pub use archive::*;

#[cfg(test)]
pub(crate) mod tests;
