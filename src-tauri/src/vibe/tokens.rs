use super::*;

/// Vom SDK gespeicherte Tokens (`StoredTokens` im SDK, camelCase).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct VibeTokens {
    pub access_token: String,
    pub refresh_token: String,
    /// Ablauf des Access-Tokens (ms seit 1970)
    pub expires_at: i64,
    pub session_id: String,
}

#[derive(Serialize, Deserialize)]
pub(super) struct StoredVibe {
    pub(super) api_url: String,
    pub(super) tokens: VibeTokens,
}

/// Wer gerade angemeldet ist (Schlüssel im Schlüsselbund).
#[derive(Debug, Clone, Serialize)]
pub struct VibeIdentity {
    /// Schlüssel: Account-ID bzw. `dev-<name>`
    pub scope: String,
    pub name: String,
    /// Minecraft-UUID mit Bindestrichen
    pub uuid: String,
    /// Nur Debug-Builds: Offline-Testprofil (`VIBE_DEV_OFFLINE_ACCOUNT`)
    pub dev: bool,
}

/// Aktiver Minecraft-Account (bzw. Debug-Offline-Profil). `None` = kein Account.
pub fn identity(state: &AppState) -> Option<VibeIdentity> {
    let accounts = state.auth.list();
    if let Some(a) = accounts.iter().find(|a| a.active).or(accounts.first()) {
        return Some(VibeIdentity { scope: a.id.clone(), name: a.username.clone(), uuid: a.uuid.clone(), dev: false });
    }
    #[cfg(debug_assertions)]
    if let Ok(name) = std::env::var("VIBE_DEV_OFFLINE_ACCOUNT") {
        let name = name.trim().to_string();
        if (3..=16).contains(&name.len()) && name.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_') {
            return Some(VibeIdentity { scope: format!("dev-{name}"), uuid: String::new(), name, dev: true });
        }
    }
    None
}

pub(super) fn secret_id(scope: &str) -> String {
    format!("vibe:{scope}")
}

pub(super) fn token_cache() -> &'static Mutex<HashMap<String, Option<StoredVibeCache>>> {
    static C: OnceLock<Mutex<HashMap<String, Option<StoredVibeCache>>>> = OnceLock::new();
    C.get_or_init(Default::default)
}

#[derive(Clone)]
pub(super) struct StoredVibeCache {
    pub(super) api_url: String,
    pub(super) tokens: VibeTokens,
}

pub(super) fn store(state: &AppState) -> SecretStore {
    SecretStore::new(&state.paths)
}

/// Tokens des aktiven Accounts für die aktuelle Backend-Adresse.
pub fn tokens_get(state: &AppState) -> Option<VibeTokens> {
    let id = identity(state)?;
    let base = api_base(state);
    let cached = token_cache().lock().get(&id.scope).cloned();
    let entry = match cached {
        Some(c) => c,
        None => {
            let loaded = store(state)
                .load(&secret_id(&id.scope))
                .ok()
                .flatten()
                .and_then(|s| serde_json::from_str::<StoredVibe>(&s).ok())
                .map(|s| StoredVibeCache { api_url: s.api_url, tokens: s.tokens });
            token_cache().lock().insert(id.scope.clone(), loaded.clone());
            loaded
        }
    };
    let entry = entry?;
    match token_match(&entry.api_url, &base)? {
        TokenMatch::Same => Some(entry.tokens),
        TokenMatch::Migrate => {
            // Einmalig umschreiben, danach ist es ein normaler Treffer
            let fixed = StoredVibeCache { api_url: base.clone(), tokens: entry.tokens };
            token_cache().lock().insert(id.scope.clone(), Some(fixed.clone()));
            if let Ok(json) = serde_json::to_string(&StoredVibe { api_url: fixed.api_url.clone(), tokens: fixed.tokens.clone() }) {
                if let Err(e) = store(state).save(&secret_id(&id.scope), &json) {
                    tracing::warn!("Vibe-Tokens nicht umgeschrieben: {e}");
                }
            }
            Some(fixed.tokens)
        }
    }
}

#[derive(Debug, PartialEq)]
pub(super) enum TokenMatch {
    /// Gespeichert für genau diese Adresse
    Same,
    /// Gespeichert für die alte Standardadresse, aktuelle Adresse ist die neue -> umschreiben
    Migrate,
}

/// Gehören Tokens, die für `saved` gespeichert wurden, zum Backend `base`? Tokens einer anderen Backend-Instanz nie
/// mitschicken. Domain-Umzug: Die alte Standardadresse ist dasselbe Backend (gleiche Datenbank) wie die neue.
pub(super) fn token_match(saved: &str, base: &str) -> Option<TokenMatch> {
    let saved_n = normalize_base(saved);
    if saved_n == base {
        return Some(TokenMatch::Same);
    }
    (normalize_base(&crate::domains::migrate_api_url(&saved_n)) == base).then_some(TokenMatch::Migrate)
}

/// Tokens speichern (`None` = abmelden).
pub fn tokens_set(state: &AppState, tokens: Option<VibeTokens>) -> AppResult<()> {
    let id = identity(state).ok_or_else(|| AppError::NotConfigured("Kein Minecraft-Account".into()))?;
    let st = store(state);
    let key = secret_id(&id.scope);
    match tokens {
        Some(t) => {
            let api_url = api_base(state);
            let json = serde_json::to_string(&StoredVibe { api_url: api_url.clone(), tokens: t.clone() })?;
            token_cache().lock().insert(id.scope.clone(), Some(StoredVibeCache { api_url, tokens: t }));
            // Schlüsselbund nicht beschreibbar -> Sitzung gilt bis zum Neustart (Cache)
            if let Err(e) = st.save(&key, &json) {
                tracing::warn!("Vibe-Tokens nicht im Schlüsselbund gespeichert: {e}");
            }
        }
        None => {
            token_cache().lock().insert(id.scope.clone(), None);
            st.delete(&key);
        }
    }
    Ok(())
}

pub fn forget_tokens(state: &AppState, scope: &str) {
    token_cache().lock().insert(scope.to_string(), None);
    store(state).delete(&secret_id(scope));
}
