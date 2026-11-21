use super::*;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(super) struct StoredAccount {
    pub(super) id: String,
    pub(super) kind: AccountKind,
    pub(super) username: String,
    pub(super) uuid: String,
    #[serde(default)]
    pub(super) skin_url: Option<String>,
    #[serde(default)]
    pub(super) expires_at: Option<i64>,
    #[serde(default)]
    pub(super) needs_relogin: bool,
    #[serde(default)]
    pub(super) xuid: Option<String>,
    #[serde(default)]
    pub(super) added_at: i64,
}

#[derive(Debug, Default, Serialize, Deserialize)]
pub(super) struct AccountsFile {
    #[serde(default)]
    pub(super) active: Option<String>,
    #[serde(default, deserialize_with = "lenient_accounts")]
    pub(super) accounts: Vec<StoredAccount>,
}

/// Unlesbare/unbekannte Einträge (z. B. alte Account-Arten) überspringen statt die ganze Datei zu verwerfen.
pub(super) fn lenient_accounts<'de, D: serde::Deserializer<'de>>(d: D) -> Result<Vec<StoredAccount>, D::Error> {
    let raw: Vec<serde_json::Value> = Deserialize::deserialize(d)?;
    Ok(raw
        .into_iter()
        .filter_map(|v| match serde_json::from_value::<StoredAccount>(v) {
            Ok(a) => Some(a),
            Err(e) => {
                tracing::warn!("accounts.json: Eintrag übersprungen ({e})");
                None
            }
        })
        .collect())
}

/// Geheimnisse eines Microsoft-Accounts (nur im Schlüsselbund).
#[derive(Clone, Default, Serialize, Deserialize)]
pub(super) struct Secrets {
    #[serde(default)]
    pub(super) msa_refresh_token: Option<String>,
    #[serde(default)]
    pub(super) mc_access_token: Option<String>,
}

pub(super) struct PendingLogin {
    pub(super) generation: u64,
    pub(super) client_id: String,
    pub(super) device_code: String,
    pub(super) interval: u64,
    pub(super) deadline: Instant,
    pub(super) cancel: CancellationToken,
}

pub struct AuthState {
    pub(super) paths: Paths,
    pub(super) app: AppHandle,
    pub(super) store: Mutex<AccountsFile>,
    pub(super) secrets: secrets::SecretStore,
    /// Cache, damit der Schlüsselbund nicht bei jedem Start gelesen wird (und als Rückfall,
    /// falls er nicht beschreibbar ist).
    pub(super) secret_cache: Mutex<HashMap<String, Secrets>>,
    pub(super) pending: Mutex<Option<PendingLogin>>,
    pub(super) window_login: Mutex<Option<(u64, CancellationToken)>>,
    pub(super) offline: offline::Grants,
    pub(super) vault_warned: Mutex<HashSet<String>>,
    pub(super) generation: std::sync::atomic::AtomicU64,
    /// Refreshs nacheinander (Refresh-Tokens rotieren)
    pub(super) refresh_lock: tokio::sync::Mutex<()>,
    /// Lokale Skin-Bibliothek
    pub skins: skins::Library,
}
