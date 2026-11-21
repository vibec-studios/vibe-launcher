//! Skins & Capes: Profil über Minecraft Services (Skin setzen/zurücksetzen, Cape wählen) und eine
//! lokale Skin-Bibliothek (`skins/<id>.png` + `skins.json` im Datenordner).
//!
//! OWNER: Auth-Agent. Bilder gehen als `data:`-URL ans Frontend (klein, kein CORS-Problem im 3D-Viewer).
use crate::error::{AppError, AppResult};
use crate::util::now_ms;
use base64::Engine;
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha1::{Digest, Sha1};
use std::path::{Path, PathBuf};

mod model;
mod raw;
mod png;
mod services;
mod lookup;
mod library;

pub use model::*;
pub use raw::*;
pub use png::*;
pub use services::*;
pub use lookup::*;
pub use library::*;

const PROFILE: &str = "https://api.minecraftservices.com/minecraft/profile";
/// Payload: `{ scope: "library" }` oder `{ scope: "profile", account_id }`
pub const SKINS_CHANGED: &str = "skins://changed";
const MAX_PNG: usize = 512 * 1024;

#[cfg(test)]
mod tests;
