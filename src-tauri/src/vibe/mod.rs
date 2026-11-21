//! Vibe-Online-Dienste (Freunde, Chats, Presence, Einladungen, geteilte Modpacks).
//!
//! Der eigentliche Client ist das TypeScript-SDK (`src/lib/vibe/`). Rust übernimmt hier nur, was die
//! Webview nicht darf oder nicht soll:
//! - **Mojang-Join** für den Login (das Minecraft-Token verlässt Rust nie),
//! - **Vibe-Tokens** im OS-Schlüsselbund (je Minecraft-Account und Backend-Adresse),
//! - **HTTP und WebSocket** zum Backend (CSP der Webview, kein CORS) –
//!   und damit die harte Sperre: Ist `settings.vibe.enabled` aus, gibt es keine Verbindung.
//! - **Modpacks teilen/importieren** (Export, Multipart-Upload, Overrides mit Zip-Slip-Prüfung).
pub mod announcements;
pub mod pack_fetch;
pub mod media;
pub mod packs;
pub mod ws;

use crate::auth::secrets::SecretStore;
use crate::error::{AppError, AppResult};
use crate::state::AppState;
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::OnceLock;
use std::time::Duration;

mod config;
mod tokens;
mod join;
mod http;

pub use config::*;
pub use tokens::*;
pub use join::*;
pub use http::*;

#[cfg(test)]
mod tests;
