//! Globale Launcher-Einstellungen (`settings.json`).
mod discord;
mod syslang;
pub use syslang::LANGUAGES;
pub mod theme;
use crate::error::AppResult;
use serde::{Deserialize, Serialize};
use std::path::Path;

mod model;
mod appearance;
mod sanitize;
mod services;
mod defaults;
mod io;

pub use model::*;
pub use appearance::*;
pub use services::*;
pub use defaults::*;

#[cfg(test)]
mod privacy_tests {
    use super::*;

    #[test]
    fn new_installs_send_nothing_without_consent() {
        let s = Settings::default();
        assert!(!s.vibe.enabled);
        assert!(!s.minecraftcapes);
    }

    #[test]
    fn existing_files_keep_previous_behaviour() {
        let s: Settings = serde_json::from_str(r#"{"language":"de"}"#).unwrap();
        assert!(s.vibe.enabled);
        assert!(s.minecraftcapes);
        let s: Settings = serde_json::from_str(r#"{"vibe":{"enabled":false},"minecraftcapes":false}"#).unwrap();
        assert!(!s.vibe.enabled);
        assert!(!s.minecraftcapes);
    }
}

#[cfg(test)]
mod tests;
