use super::*;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AccountKind {
    /// Einzige Account-Art (Offline-/Cracked-Accounts gibt es bewusst nicht).
    Microsoft,
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

#[derive(Debug, Clone, Serialize)]
pub struct VaultWarning {
    pub account_id: String,
    pub username: String,
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

/// Minecraft-Token so früh erneuern (vor Ablauf).
pub(super) const REFRESH_MARGIN_MS: i64 = 5 * 60 * 1000;
