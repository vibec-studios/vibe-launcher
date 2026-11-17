//! Accounts: Microsoft (Device-Code-Flow: MSA -> Xbox Live -> XSTS -> Minecraft Services) und Offline.
//!
//! OWNER: Auth-Agent. Öffentliche Typen/Signaturen sind Teil des Vertrags (docs/CONTRACT.md).
use crate::error::{AppError, AppResult};
use crate::paths::Paths;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tauri::AppHandle;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AccountKind {
    Microsoft,
    Offline,
}

/// Account, wie ihn das Frontend sieht (ohne Tokens).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Account {
    /// Lokale ID (stabil), = Minecraft-UUID ohne Bindestriche
    pub id: String,
    pub kind: AccountKind,
    pub username: String,
    /// Minecraft-UUID mit Bindestrichen
    pub uuid: String,
    /// URL des Skins (falls bekannt)
    pub skin_url: Option<String>,
    pub active: bool,
    /// Ablauf des Minecraft-Tokens (ms seit Epoch)
    pub expires_at: Option<i64>,
    /// Refresh fehlgeschlagen -> Nutzer muss sich neu anmelden
    pub needs_relogin: bool,
}

/// Device-Code für den Microsoft-Login.
#[derive(Debug, Clone, Serialize)]
pub struct DeviceCode {
    pub user_code: String,
    pub verification_uri: String,
    pub expires_in: u64,
    pub interval: u64,
    pub message: String,
}

/// Was der Spielstart braucht.
#[derive(Debug, Clone)]
pub struct LaunchAccount {
    pub username: String,
    /// UUID ohne Bindestriche
    pub uuid: String,
    pub access_token: String,
    /// "msa" oder "legacy"
    pub user_type: String,
    pub xuid: Option<String>,
    pub client_id: Option<String>,
}

pub struct AuthState {
    #[allow(dead_code)]
    paths: Paths,
    #[allow(dead_code)]
    app: AppHandle,
}

impl AuthState {
    pub fn load(paths: Paths, app: AppHandle) -> Arc<Self> {
        Arc::new(AuthState { paths, app })
    }

    pub fn list(&self) -> Vec<Account> {
        vec![]
    }

    /// Gültige Zugangsdaten für den Start (frischt Microsoft-Tokens bei Bedarf auf).
    /// `account_id = None` -> aktiver Account. Kein Account -> Fehler `NotConfigured`.
    pub async fn launch_account(&self, _state: &crate::state::AppState, _account_id: Option<&str>) -> AppResult<LaunchAccount> {
        Err(AppError::NotConfigured("Kein Account".into()))
    }
}
