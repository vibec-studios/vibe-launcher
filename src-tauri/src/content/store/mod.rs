//! Eigene Stores im Format „Vibe Store v1“ (docs/STORE.md): eine JSON-Datei per URL.
//!
//! Die Datei wird mit ETag/If-Modified-Since geladen, ~10 Minuten im Speicher und zusätzlich unter
//! `cache/stores/<id>.json` gehalten (Offline-Fallback). Suche/Filter laufen clientseitig über den Cache.

use super::provider::Brief;
use super::*;
use crate::error::{AppError, AppResult};
use crate::settings::StoreConfig;
use crate::state::AppState;
use serde::Deserialize;
use std::path::PathBuf;

mod format;
mod cache;
mod mapping;
mod api;
mod manage;
#[cfg(test)]
mod tests;

pub use format::*;
pub use cache::*;
pub use mapping::*;
pub use api::*;
pub use manage::*;

pub const DEFAULT_ID: &str = "vibe-craft-studios";
pub const DEFAULT_NAME: &str = "Vibe Craft Studios";
/// Offizieller Store (docs/DOMAINS.md); die alte Adresse auf GitHub Pages wird beim Laden der Einstellungen umgestellt.
pub const DEFAULT_URL: &str = crate::domains::STORE_URL;
const TTL: Duration = Duration::from_secs(10 * 60);

pub fn default_stores() -> Vec<StoreConfig> {
    vec![StoreConfig { id: DEFAULT_ID.into(), name: DEFAULT_NAME.into(), url: DEFAULT_URL.into(), enabled: true, icon: None }]
}

/// Konfigurierte Stores; der Standard-Store ist immer enthalten.
pub fn configured(settings: &crate::settings::Settings) -> Vec<StoreConfig> {
    let mut v = settings.stores.clone();
    if !v.iter().any(|s| s.id == DEFAULT_ID) {
        v.insert(0, default_stores().remove(0));
    }
    v
}

fn config(state: &AppState, id: &str) -> AppResult<StoreConfig> {
    configured(&state.settings()).into_iter().find(|s| s.id == id).ok_or_else(|| AppError::NotFound(format!("Store {id}")))
}
