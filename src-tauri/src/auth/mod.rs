//! Accounts: nur Microsoft (Device-Code-Flow: MSA -> Xbox Live -> XSTS -> Minecraft Services).
//!
//! OWNER: Auth-Agent. Öffentliche Typen/Signaturen sind Teil des Vertrags (docs/CONTRACT.md).
//!
//! Speicherung: `accounts.json` enthält nur Metadaten (keine Tokens). MSA-Refresh-Token und
//! Minecraft-Access-Token liegen als JSON im OS-Schlüsselbund (siehe [`secrets`]).
#[cfg(test)]
mod fake_server;
pub mod msa;
pub mod offline;
pub mod pkce;
pub mod portable;
pub mod secrets;
pub mod skin_import;
pub mod skins;
pub mod webview;

use crate::error::{AppError, AppResult};
use crate::events;
use crate::paths::Paths;
use crate::util::now_ms;
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tauri::AppHandle;
use tokio_util::sync::CancellationToken;

mod types;
mod stored;
mod store;
mod login;
mod session;
mod helpers;

pub use types::*;
pub use stored::*;
use helpers::*;

#[cfg(test)]
mod tests;
