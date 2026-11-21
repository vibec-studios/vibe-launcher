use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(default)]
pub struct AfkSettings {
    pub enabled: bool,
    pub always_ready: bool,
    pub notify: bool,
    pub auto_reconnect: bool,
    pub options_fallback: bool,
}

impl Default for AfkSettings {
    fn default() -> Self {
        AfkSettings { enabled: false, always_ready: true, notify: true, auto_reconnect: false, options_fallback: true }
    }
}
