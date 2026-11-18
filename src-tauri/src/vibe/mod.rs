//! Vibe-Online-Dienste (Freunde, Chats, Presence, Einladungen, geteilte Modpacks).
//!
//! Der eigentliche Client ist das TypeScript-SDK (`src/lib/vibe/`). Rust übernimmt hier nur, was die
//! Webview nicht darf oder nicht soll:
//! - **Mojang-Join** für den Login (das Minecraft-Token verlässt Rust nie),
//! - **Vibe-Tokens** im OS-Schlüsselbund (je Minecraft-Account und Backend-Adresse),
//! - **HTTP und WebSocket** zum Backend (CSP der Webview, kein CORS) –
//!   und damit die harte Sperre: Ist `settings.vibe.enabled` aus, gibt es keine Verbindung.
//! - **Modpacks teilen/importieren** (Export, Multipart-Upload, Overrides mit Zip-Slip-Prüfung).
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

/// Welcher Teilbereich gebraucht wird (für die Schalter in den Einstellungen).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Feature {
    /// Nur Hauptschalter (Login, Meta, Gateway)
    Any,
    Social,
    Sharing,
    Hosting,
}

/// Offizielles Backend von Vibe Craft Studios. Nutzer können keine eigene Adresse einstellen.
pub const DEFAULT_API_URL: &str = "https://vibe.henny.dev";

/// Basis-URL des Backends: immer [`DEFAULT_API_URL`]. Nur Debug-Builds dürfen sie für die lokale Entwicklung per
/// Env `VIBE_API_URL` überschreiben (z. B. `http://127.0.0.1:3000`); Release-Builds ignorieren die Variable.
pub fn api_base(_state: &AppState) -> String {
    normalize_base(&effective_api_url(debug_override("VIBE_API_URL")))
}

fn effective_api_url(over: Option<String>) -> String {
    over.unwrap_or_else(|| DEFAULT_API_URL.to_string())
}

/// Wert einer Entwickler-Umgebungsvariable – nur in Debug-Builds, in Release immer `None`.
pub fn debug_override(name: &str) -> Option<String> {
    #[cfg(debug_assertions)]
    {
        std::env::var(name).ok().map(|s| s.trim().to_string()).filter(|s| !s.is_empty())
    }
    #[cfg(not(debug_assertions))]
    {
        let _ = name;
        None
    }
}

pub fn normalize_base(raw: &str) -> String {
    raw.trim().trim_end_matches('/').to_string()
}

/// Prüft den Hauptschalter (und optional einen Teilbereich). Aus = Fehler, keine Verbindung.
pub fn ensure(state: &AppState, f: Feature) -> AppResult<String> {
    let s = state.settings().vibe;
    if !s.enabled {
        return Err(AppError::NotConfigured("Die Vibe-Dienste sind in den Einstellungen ausgeschaltet.".into()));
    }
    let on = match f {
        Feature::Any => true,
        Feature::Social => s.social,
        Feature::Sharing => s.sharing,
        Feature::Hosting => s.hosting,
    };
    if !on {
        return Err(AppError::NotConfigured("Diese Vibe-Funktion ist in den Einstellungen ausgeschaltet.".into()));
    }
    let base = api_base(state);
    if !(base.starts_with("https://") || base.starts_with("http://")) {
        return Err(AppError::Invalid("Die Vibe-Server-Adresse muss mit https:// beginnen.".into()));
    }
    Ok(base)
}

/// Wird nach dem Speichern der Einstellungen aufgerufen: Hauptschalter aus -> alle Verbindungen schließen.
pub fn on_settings_changed(state: &AppState) {
    if !state.settings().vibe.enabled {
        ws::close_all();
    }
}

// ------------------------------------------------------------------ Tokens

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
struct StoredVibe {
    api_url: String,
    tokens: VibeTokens,
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

fn secret_id(scope: &str) -> String {
    format!("vibe:{scope}")
}

fn token_cache() -> &'static Mutex<HashMap<String, Option<StoredVibeCache>>> {
    static C: OnceLock<Mutex<HashMap<String, Option<StoredVibeCache>>>> = OnceLock::new();
    C.get_or_init(Default::default)
}

#[derive(Clone)]
struct StoredVibeCache {
    api_url: String,
    tokens: VibeTokens,
}

fn store(state: &AppState) -> SecretStore {
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
    // Tokens einer anderen Backend-Instanz nie mitschicken
    entry.filter(|e| normalize_base(&e.api_url) == base).map(|e| e.tokens)
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

// ------------------------------------------------------------------ Mojang-Join

#[derive(Debug, Clone, Serialize)]
pub struct JoinResult {
    /// Minecraft-Name für `/auth/verify`
    pub name: String,
    pub uuid: String,
}

/// Mojang `session/minecraft/join` mit dem Minecraft-Token des aktiven Accounts (bleibt in Rust).
pub async fn mojang_join(state: &AppState, server_id: &str) -> AppResult<JoinResult> {
    ensure(state, Feature::Any)?;
    if server_id.is_empty() || server_id.len() > 64 || !server_id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-') {
        return Err(AppError::Invalid("Ungültige Anmeldeanfrage".into()));
    }
    let la = state.auth.launch_account(state, None).await?;
    let name = la.username.clone();
    let uuid = dashed(&la.uuid);
    // Debug-Offline-Profil: kein echter Token, das lokale Test-Backend (AUTH_DEV_BYPASS) prüft nicht
    #[cfg(debug_assertions)]
    if la.user_type == "legacy" {
        return Ok(JoinResult { name, uuid });
    }
    let send = |token: String| {
        let body = serde_json::json!({ "accessToken": token, "selectedProfile": la.uuid.replace('-', ""), "serverId": server_id });
        let client = state.net.client.clone();
        async move { client.post("https://sessionserver.mojang.com/session/minecraft/join").json(&body).timeout(Duration::from_secs(15)).send().await }
    };
    let r = send(la.access_token.clone()).await?;
    if r.status().is_success() {
        return Ok(JoinResult { name, uuid });
    }
    // Token abgelehnt -> einmal erneuern und wiederholen
    if r.status().as_u16() == 401 || r.status().as_u16() == 403 {
        let id = state.auth.list().into_iter().find(|a| a.active).map(|a| a.id);
        if let Some(id) = id {
            state.auth.refresh(state, &id, true).await?;
            let la2 = state.auth.launch_account(state, Some(&id)).await?;
            let r2 = send(la2.access_token).await?;
            if r2.status().is_success() {
                return Ok(JoinResult { name, uuid });
            }
            return Err(AppError::Auth(format!("Mojang hat die Anmeldung abgelehnt (HTTP {}). Melde dich unter „Accounts“ neu an.", r2.status().as_u16())));
        }
    }
    Err(AppError::Auth(format!("Mojang hat die Anmeldung abgelehnt (HTTP {}).", r.status().as_u16())))
}

fn dashed(u: &str) -> String {
    let h = u.replace('-', "").to_lowercase();
    if h.len() != 32 {
        return u.to_string();
    }
    format!("{}-{}-{}-{}-{}", &h[..8], &h[8..12], &h[12..16], &h[16..20], &h[20..])
}

// ------------------------------------------------------------------ HTTP-Proxy für das SDK

#[derive(Debug, Clone, Deserialize)]
pub struct HttpRequest {
    pub method: String,
    /// Absolute URL (muss unter der Backend-Adresse liegen)
    pub url: String,
    #[serde(default)]
    pub headers: HashMap<String, String>,
    #[serde(default)]
    pub body: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct HttpResponse {
    pub status: u16,
    pub body: String,
    pub content_type: Option<String>,
    pub retry_after: Option<String>,
}

/// Prüft, dass eine URL zum konfigurierten Backend gehört (gleiches Schema/Host/Port, Pfad unter `/api/`).
pub fn check_api_url(base: &str, url: &str) -> AppResult<url::Url> {
    let b = url::Url::parse(base).map_err(|_| AppError::Invalid("Ungültige Vibe-Server-Adresse".into()))?;
    let u = url::Url::parse(url).map_err(|_| AppError::Invalid("Ungültige Adresse".into()))?;
    let same = u.scheme() == b.scheme() && u.host_str() == b.host_str() && u.port_or_known_default() == b.port_or_known_default();
    let prefix = format!("{}/api/", b.path().trim_end_matches('/'));
    if !same || !u.path().starts_with(&prefix) || u.path().split('/').any(|s| s == "..") {
        return Err(AppError::Invalid("Anfrage an eine fremde Adresse abgelehnt".into()));
    }
    Ok(u)
}

pub async fn http(state: &AppState, req: HttpRequest) -> AppResult<HttpResponse> {
    let base = ensure(state, Feature::Any)?;
    let url = check_api_url(&base, &req.url)?;
    let method = match req.method.to_ascii_uppercase().as_str() {
        "GET" => reqwest::Method::GET,
        "POST" => reqwest::Method::POST,
        "PUT" => reqwest::Method::PUT,
        "PATCH" => reqwest::Method::PATCH,
        "DELETE" => reqwest::Method::DELETE,
        _ => return Err(AppError::Invalid("Methode nicht erlaubt".into())),
    };
    let mut rb = state.net.client.request(method, url).timeout(Duration::from_secs(20));
    for (k, v) in &req.headers {
        let k = k.to_ascii_lowercase();
        if matches!(k.as_str(), "authorization" | "content-type" | "accept") {
            rb = rb.header(k, v);
        }
    }
    if let Some(b) = req.body {
        rb = rb.body(b);
    }
    let r = rb.send().await?;
    let status = r.status().as_u16();
    let content_type = r.headers().get("content-type").and_then(|v| v.to_str().ok()).map(str::to_string);
    let retry_after = r.headers().get("retry-after").and_then(|v| v.to_str().ok()).map(str::to_string);
    let body = r.text().await?;
    Ok(HttpResponse { status, body, content_type, retry_after })
}

/// Fehlertext aus einer Backend-Antwort (`{ error: { message } }`).
pub fn api_error(status: u16, body: &str) -> AppError {
    let msg = serde_json::from_str::<serde_json::Value>(body)
        .ok()
        .and_then(|v| v["error"]["message"].as_str().map(str::to_string))
        .unwrap_or_else(|| format!("Vibe-Server antwortet mit HTTP {status}"));
    if status == 401 {
        AppError::Auth(msg)
    } else {
        AppError::Msg(msg)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn api_url_check() {
        let base = "https://vibe.henny.dev";
        assert!(check_api_url(base, "https://vibe.henny.dev/api/v1/meta").is_ok());
        assert!(check_api_url(base, "https://vibe.henny.dev:443/api/v1/friends?x=1").is_ok());
        assert!(check_api_url(base, "https://evil.example/api/v1/meta").is_err());
        assert!(check_api_url(base, "http://vibe.henny.dev/api/v1/meta").is_err());
        assert!(check_api_url(base, "https://vibe.henny.dev/admin/api/users").is_err());
        assert!(check_api_url(base, "https://vibe.henny.dev.evil.example/api/v1").is_err());
        let local = "http://127.0.0.1:3917";
        assert!(check_api_url(local, "http://127.0.0.1:3917/api/v1/packs/ABC/versions/1/overrides.zip").is_ok());
        assert!(check_api_url(local, "http://127.0.0.1:3000/api/v1/meta").is_err());
    }

    #[test]
    fn api_url_is_fixed() {
        assert_eq!(effective_api_url(None), DEFAULT_API_URL);
        assert_eq!(effective_api_url(Some("http://127.0.0.1:3000".into())), "http://127.0.0.1:3000");
        // Release-Builds lesen keine Env-Variablen
        #[cfg(not(debug_assertions))]
        {
            std::env::set_var("VIBE_API_URL", "https://evil.example");
            assert!(debug_override("VIBE_API_URL").is_none());
        }
    }

    #[test]
    fn dashes() {
        assert_eq!(dashed("069a79f444e94726a5befca90e38aaf5"), "069a79f4-44e9-4726-a5be-fca90e38aaf5");
        assert_eq!(dashed("069a79f4-44e9-4726-a5be-fca90e38aaf5"), "069a79f4-44e9-4726-a5be-fca90e38aaf5");
    }

    #[test]
    fn error_text() {
        let e = api_error(429, r#"{"error":{"code":"rate_limited","message":"Zu schnell"}}"#);
        assert_eq!(e.to_string(), "Zu schnell");
        assert!(matches!(api_error(401, "{}"), AppError::Auth(_)));
    }
}
