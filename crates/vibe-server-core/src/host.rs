use crate::error::AppResult;
use futures::future::BoxFuture;
use std::collections::HashMap;

#[derive(Debug, Clone, Default)]
pub struct JavaPrefs {
    pub overrides: HashMap<String, String>,
    pub auto_java: bool,
}

#[derive(Debug, Clone)]
pub struct RelayIdentity {
    pub username: String,
    pub uuid: String,
    pub access_token: String,
    pub ticket: Option<String>,
}

pub trait Host: Send + Sync {
    fn java_prefs(&self) -> JavaPrefs;
    fn hosting_enabled(&self) -> bool;
    fn hosting_disabled_message(&self) -> String {
        "Vibe-Hosting ist in den Einstellungen ausgeschaltet.".into()
    }
    fn relay_identity<'a>(&'a self, server_id: &'a str) -> BoxFuture<'a, AppResult<RelayIdentity>>;
}
