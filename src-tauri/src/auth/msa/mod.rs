//! Microsoft-Login: Device-Code-Flow (MSA) -> Xbox Live -> XSTS -> Minecraft Services.
//!
//! Tokens werden nie geloggt; Fehlermeldungen enthalten nur Statuscodes und Fehlertexte der Server.
use crate::error::{AppError, AppResult};
use base64::Engine;
use serde::Deserialize;
use serde_json::{json, Value};

const MSA_BASE: &str = "https://login.microsoftonline.com/consumers/oauth2/v2.0";
pub const MSA_SCOPE: &str = "XboxLive.signin offline_access";
const XBL_AUTH: &str = "https://user.auth.xboxlive.com/user/authenticate";
const XSTS_AUTH: &str = "https://xsts.auth.xboxlive.com/xsts/authorize";
const MC_LOGIN: &str = "https://api.minecraftservices.com/authentication/login_with_xbox";
const MC_ENTITLEMENTS: &str = "https://api.minecraftservices.com/entitlements/mcstore";
const MC_PROFILE: &str = "https://api.minecraftservices.com/minecraft/profile";

#[derive(Debug, Clone, Deserialize)]
pub struct DeviceCodeResponse {
    pub device_code: String,
    pub user_code: String,
    pub verification_uri: String,
    #[serde(default = "default_expires")]
    pub expires_in: u64,
    #[serde(default = "default_interval")]
    pub interval: u64,
    #[serde(default)]
    pub message: String,
}
fn default_expires() -> u64 {
    900
}
fn default_interval() -> u64 {
    5
}

#[derive(Debug, Clone, Deserialize)]
pub struct MsaTokens {
    pub access_token: String,
    #[serde(default)]
    pub refresh_token: Option<String>,
}

#[derive(Debug, Deserialize)]
struct OAuthError {
    #[serde(default)]
    error: String,
    #[serde(default)]
    error_description: String,
    #[serde(default)]
    error_codes: Vec<u64>,
}

pub enum Poll {
    Pending,
    SlowDown,
    Done(MsaTokens),
}

#[derive(Debug, Clone)]
pub struct McProfile {
    /// UUID ohne Bindestriche
    pub id: String,
    pub name: String,
    pub skin_url: Option<String>,
}

#[derive(Debug, Clone)]
pub struct McLogin {
    pub access_token: String,
    pub expires_in: u64,
    pub xuid: Option<String>,
    pub profile: McProfile,
}

// ------------------------------------------------------------------ MSA

pub async fn request_device_code(client: &reqwest::Client, client_id: &str) -> AppResult<DeviceCodeResponse> {
    let resp = client
        .post(format!("{MSA_BASE}/devicecode"))
        .form(&[("client_id", client_id), ("scope", MSA_SCOPE)])
        .send()
        .await?;
    let status = resp.status();
    let body = resp.bytes().await?;
    if status.is_success() {
        return serde_json::from_slice(&body).map_err(|e| AppError::msg(format!("Ungültige Antwort von Microsoft: {e}")));
    }
    Err(oauth_error(status.as_u16(), &body))
}

/// Ein Polling-Schritt am Token-Endpoint.
pub async fn poll_device_code(client: &reqwest::Client, client_id: &str, device_code: &str) -> AppResult<Poll> {
    let resp = client
        .post(format!("{MSA_BASE}/token"))
        .form(&[
            ("grant_type", "urn:ietf:params:oauth:grant-type:device_code"),
            ("client_id", client_id),
            ("device_code", device_code),
        ])
        .send()
        .await?;
    let status = resp.status();
    let body = resp.bytes().await?;
    if status.is_success() {
        return Ok(Poll::Done(parse_tokens(&body)?));
    }
    if let Ok(e) = serde_json::from_slice::<OAuthError>(&body) {
        match e.error.as_str() {
            "authorization_pending" => return Ok(Poll::Pending),
            "slow_down" => return Ok(Poll::SlowDown),
            _ => {}
        }
    }
    Err(oauth_error(status.as_u16(), &body))
}

pub async fn refresh_msa(client: &reqwest::Client, client_id: &str, refresh_token: &str) -> AppResult<MsaTokens> {
    refresh_msa_at(client, &format!("{MSA_BASE}/token"), client_id, refresh_token).await
}

pub async fn refresh_msa_at(client: &reqwest::Client, token_url: &str, client_id: &str, refresh_token: &str) -> AppResult<MsaTokens> {
    token_post(
        client,
        token_url,
        &[("grant_type", "refresh_token"), ("client_id", client_id), ("refresh_token", refresh_token), ("scope", MSA_SCOPE)],
    )
    .await
}

pub async fn exchange_code(client: &reqwest::Client, client_id: &str, code: &str, verifier: &str) -> AppResult<MsaTokens> {
    exchange_code_at(client, &format!("{MSA_BASE}/token"), client_id, code, verifier).await
}

pub async fn exchange_code_at(client: &reqwest::Client, token_url: &str, client_id: &str, code: &str, verifier: &str) -> AppResult<MsaTokens> {
    token_post(
        client,
        token_url,
        &[
            ("grant_type", "authorization_code"),
            ("client_id", client_id),
            ("code", code),
            ("redirect_uri", super::pkce::REDIRECT_URI),
            ("code_verifier", verifier),
            ("scope", MSA_SCOPE),
        ],
    )
    .await
}

async fn token_post(client: &reqwest::Client, token_url: &str, form: &[(&str, &str)]) -> AppResult<MsaTokens> {
    let resp = client.post(token_url).form(form).send().await?;
    let status = resp.status();
    let body = resp.bytes().await?;
    if status.is_success() {
        return parse_tokens(&body);
    }
    if status.is_server_error() {
        return Err(AppError::Unreachable(format!("Microsoft-Anmeldedienst nicht erreichbar (HTTP {status}) – bitte später erneut versuchen")));
    }
    Err(oauth_error(status.as_u16(), &body))
}

fn parse_tokens(body: &[u8]) -> AppResult<MsaTokens> {
    serde_json::from_slice(body).map_err(|e| AppError::msg(format!("Ungültige Token-Antwort von Microsoft: {e}")))
}

/// Erste Zeile ohne angehängte Trace-/Correlation-IDs.
fn first_line(s: &str) -> &str {
    let s = s.lines().next().unwrap_or("");
    let s = s.split(" Trace ID:").next().unwrap_or(s);
    s.trim()
}

pub const REDIRECT_HINT: &str = "Das Anmeldefenster ist in der Azure-App noch nicht freigeschaltet: Unter „Authentication → Mobile and desktop applications“ muss die Redirect URI https://login.microsoftonline.com/common/oauth2/nativeclient aktiviert sein. Bis dahin klappt die Anmeldung über „Im Browser anmelden (Code)“.";

pub fn redirect_uri_problem(error: &str, desc: &str) -> bool {
    let d = desc.to_ascii_lowercase();
    (error == "invalid_request" || error.is_empty()) && (d.contains("redirect_uri") || d.contains("redirect uri") || d.contains("reply address"))
}

/// OAuth-Fehler von login.microsoftonline.com in verständliche Meldungen übersetzen.
pub fn oauth_error(status: u16, body: &[u8]) -> AppError {
    let Ok(e) = serde_json::from_slice::<OAuthError>(body) else {
        return AppError::msg(format!("Microsoft-Anmeldung fehlgeschlagen (HTTP {status})"));
    };
    let desc = first_line(&e.error_description);
    let has = |code: u64| e.error_codes.contains(&code) || desc.contains(&format!("AADSTS{code}:"));
    if redirect_uri_problem(&e.error, desc) || has(50011) || has(500113) {
        return AppError::NotConfigured(REDIRECT_HINT.into());
    }
    match e.error.as_str() {
        "expired_token" => return AppError::Auth("Der Anmeldecode ist abgelaufen – bitte den Login erneut starten.".into()),
        "authorization_declined" | "access_denied" => return AppError::Auth("Die Anmeldung wurde im Browser abgelehnt.".into()),
        "bad_verification_code" => return AppError::Auth("Der Anmeldecode ist ungültig – bitte den Login erneut starten.".into()),
        "invalid_grant" => {
            return AppError::Auth("Die gespeicherte Microsoft-Anmeldung ist nicht mehr gültig – bitte neu anmelden.".into())
        }
        _ => {}
    }
    if has(700016) {
        return AppError::NotConfigured(
            "Die Microsoft-Client-ID ist unbekannt oder nicht für private Microsoft-Konten freigegeben (AADSTS700016). \
             Prüfe die Azure-App-Registrierung (Kontotyp „Personal Microsoft accounts“) bzw. die Client-ID in den Einstellungen."
                .into(),
        );
    }
    if has(7000218) || has(70002) {
        return AppError::NotConfigured(
            "Die Azure-App erlaubt keine öffentlichen Client-Flows. In der App-Registrierung unter „Authentication“ \
             „Allow public client flows“ auf „Yes“ stellen."
                .into(),
        );
    }
    if has(9002331) || has(50194) || has(9002346) {
        return AppError::NotConfigured(format!(
            "Die Azure-App ist nicht für private Microsoft-Konten eingerichtet ({desc}). Kontotyp „Personal Microsoft accounts“ wählen."
        ));
    }
    if has(700038) || has(900144) || e.error == "invalid_client" || e.error == "unauthorized_client" || (desc.contains("client") && e.error == "invalid_request") {
        return AppError::NotConfigured(format!("Die Microsoft-Client-ID ist ungültig: {desc}"));
    }
    let what = if e.error.is_empty() { format!("HTTP {status}") } else { e.error.clone() };
    if desc.is_empty() {
        AppError::Auth(format!("Microsoft-Anmeldung fehlgeschlagen ({what})"))
    } else {
        AppError::Auth(format!("Microsoft-Anmeldung fehlgeschlagen ({what}): {desc}"))
    }
}

// ------------------------------------------------------------------ Xbox / XSTS

async fn post_json(client: &reqwest::Client, url: &str, body: &Value, bearer: Option<&str>) -> AppResult<(u16, bytes::Bytes)> {
    let mut req = client.post(url).header("Accept", "application/json").json(body);
    if let Some(t) = bearer {
        req = req.bearer_auth(t);
    }
    let resp = req.send().await?;
    let status = resp.status().as_u16();
    Ok((status, resp.bytes().await?))
}

#[derive(Deserialize)]
struct XblResponse {
    #[serde(rename = "Token")]
    token: String,
    #[serde(rename = "DisplayClaims")]
    display_claims: XblClaims,
}
#[derive(Deserialize)]
struct XblClaims {
    xui: Vec<XblXui>,
}
#[derive(Deserialize)]
struct XblXui {
    uhs: String,
}

/// Xbox-Live-Token + User-Hash.
pub async fn xbox_live(client: &reqwest::Client, msa_access_token: &str) -> AppResult<(String, String)> {
    let body = json!({
        "Properties": {
            "AuthMethod": "RPS",
            "SiteName": "user.auth.xboxlive.com",
            "RpsTicket": format!("d={msa_access_token}"),
        },
        "RelyingParty": "http://auth.xboxlive.com",
        "TokenType": "JWT",
    });
    let (status, bytes) = post_json(client, XBL_AUTH, &body, None).await?;
    if !(200..300).contains(&status) {
        if status >= 500 {
            return Err(AppError::Unreachable(format!("Xbox Live nicht erreichbar (HTTP {status}) – bitte später erneut versuchen")));
        }
        return Err(AppError::Auth(format!("Xbox-Live-Anmeldung fehlgeschlagen (HTTP {status})")));
    }
    let r: XblResponse = serde_json::from_slice(&bytes).map_err(|e| AppError::msg(format!("Ungültige Antwort von Xbox Live: {e}")))?;
    let uhs = r.display_claims.xui.into_iter().next().map(|x| x.uhs).ok_or_else(|| AppError::msg("Xbox Live lieferte keinen User-Hash"))?;
    Ok((r.token, uhs))
}

/// XSTS-Token für Minecraft. Liefert (Token, User-Hash).
pub async fn xsts(client: &reqwest::Client, xbl_token: &str) -> AppResult<(String, String)> {
    let body = json!({
        "Properties": { "SandboxId": "RETAIL", "UserTokens": [xbl_token] },
        "RelyingParty": "rp://api.minecraftservices.com/",
        "TokenType": "JWT",
    });
    let (status, bytes) = post_json(client, XSTS_AUTH, &body, None).await?;
    if status == 401 {
        return Err(AppError::Auth(xsts_error(&bytes)));
    }
    if !(200..300).contains(&status) {
        if status >= 500 {
            return Err(AppError::Unreachable(format!("Xbox-Dienst nicht erreichbar (HTTP {status}) – bitte später erneut versuchen")));
        }
        return Err(AppError::Auth(format!("Xbox-Autorisierung fehlgeschlagen (HTTP {status})")));
    }
    let r: XblResponse = serde_json::from_slice(&bytes).map_err(|e| AppError::msg(format!("Ungültige Antwort von XSTS: {e}")))?;
    let uhs = r.display_claims.xui.into_iter().next().map(|x| x.uhs).ok_or_else(|| AppError::msg("XSTS lieferte keinen User-Hash"))?;
    Ok((r.token, uhs))
}

/// XSTS-Fehlerantwort (`{"XErr": 2148916233, ...}`) -> deutsche Meldung.
pub fn xsts_error(body: &[u8]) -> String {
    let v: Value = serde_json::from_slice(body).unwrap_or(Value::Null);
    let code = match &v["XErr"] {
        Value::Number(n) => n.as_u64(),
        Value::String(s) => s.parse().ok(),
        _ => None,
    };
    match code {
        Some(c) => xsts_message(c),
        None => "Xbox-Autorisierung fehlgeschlagen".into(),
    }
}

pub fn xsts_message(code: u64) -> String {
    match code {
        2148916233 => "Zu diesem Microsoft-Konto gibt es noch kein Xbox-Profil. Melde dich einmal auf xbox.com (oder minecraft.net) an, \
                       um eines anzulegen, und versuche es dann erneut."
            .into(),
        2148916235 => "Xbox Live ist in deinem Land bzw. deiner Region nicht verfügbar.".into(),
        2148916236 | 2148916237 => "Für dieses Konto ist ein Altersnachweis nötig (Südkorea). Bitte auf xbox.com die Altersverifizierung abschließen.".into(),
        2148916238 => "Dies ist ein Kinderkonto. Ein Erwachsener muss es auf account.microsoft.com/family zu einer Microsoft-Familie hinzufügen, \
                       bevor Minecraft genutzt werden kann."
            .into(),
        2148916227 => "Dieses Konto wurde von Xbox gesperrt.".into(),
        2148916229 => "Online-Spielen ist für dieses Konto durch die Jugendschutzeinstellungen gesperrt.".into(),
        2148916234 => "Die Xbox-Nutzungsbedingungen wurden noch nicht akzeptiert. Bitte einmal auf xbox.com anmelden.".into(),
        c => format!("Xbox-Autorisierung fehlgeschlagen (Fehlercode {c})"),
    }
}

// ------------------------------------------------------------------ Minecraft Services

#[derive(Deserialize)]
struct McLoginResponse {
    access_token: String,
    #[serde(default = "default_mc_expires")]
    expires_in: u64,
}
fn default_mc_expires() -> u64 {
    86400
}

#[derive(Deserialize)]
struct Entitlements {
    #[serde(default)]
    items: Vec<Value>,
}

#[derive(Deserialize)]
struct ProfileResponse {
    id: String,
    name: String,
    #[serde(default)]
    skins: Vec<ProfileSkin>,
}
#[derive(Deserialize)]
struct ProfileSkin {
    #[serde(default)]
    state: String,
    #[serde(default)]
    url: String,
}

/// Komplette Kette ab MSA-Access-Token.
pub async fn minecraft_login(client: &reqwest::Client, msa_access_token: &str) -> AppResult<McLogin> {
    let (xbl, _) = xbox_live(client, msa_access_token).await?;
    let (xsts_token, uhs) = xsts(client, &xbl).await?;

    let (status, bytes) =
        post_json(client, MC_LOGIN, &json!({ "identityToken": format!("XBL3.0 x={uhs};{xsts_token}") }), None).await?;
    match status {
        200..=299 => {}
        403 => {
            return Err(AppError::NotConfigured(
                "Minecraft hat die Anmeldung abgelehnt: Die Azure-App ist (noch) nicht für die Minecraft-API freigeschaltet. \
                 Neue Client-IDs müssen über das Formular von Mojang freigegeben werden (https://aka.ms/mce-reviewappid)."
                    .into(),
            ))
        }
        429 => return Err(AppError::msg("Zu viele Anmeldeversuche bei Minecraft – bitte ein paar Minuten warten.")),
        s if s >= 500 => return Err(AppError::Unreachable(format!("Minecraft-Dienste nicht erreichbar (HTTP {s}) – bitte später erneut versuchen"))),
        s => return Err(AppError::Auth(format!("Minecraft-Anmeldung fehlgeschlagen (HTTP {s})"))),
    }
    let login: McLoginResponse =
        serde_json::from_slice(&bytes).map_err(|e| AppError::msg(format!("Ungültige Antwort von Minecraft: {e}")))?;

    let owns_game = match client.get(MC_ENTITLEMENTS).bearer_auth(&login.access_token).send().await {
        Ok(r) if r.status().is_success() => r.json::<Entitlements>().await.map(|e| !e.items.is_empty()).unwrap_or(true),
        _ => true, // Nicht entscheidbar -> Profil entscheidet
    };

    let profile = fetch_profile(client, &login.access_token, owns_game).await?;
    Ok(McLogin { xuid: jwt_claim(&login.access_token, "xuid"), access_token: login.access_token, expires_in: login.expires_in, profile })
}

pub async fn fetch_profile(client: &reqwest::Client, mc_token: &str, owns_game: bool) -> AppResult<McProfile> {
    let resp = client.get(MC_PROFILE).bearer_auth(mc_token).send().await?;
    let status = resp.status().as_u16();
    match status {
        200..=299 => {}
        404 => {
            return Err(AppError::Auth(if owns_game {
                "Kein Minecraft: Java Edition-Profil – für dieses Konto wurde noch kein Spielername festgelegt. \
                 Bitte einmal auf minecraft.net anmelden und einen Namen wählen."
                    .into()
            } else {
                "Kein Minecraft: Java Edition-Profil – dieses Microsoft-Konto besitzt Minecraft: Java Edition nicht \
                 (Xbox Game Pass: einmal den offiziellen Launcher starten)."
                    .into()
            }))
        }
        401 => return Err(AppError::Auth("Minecraft-Token ungültig".into())),
        s if s >= 500 => return Err(AppError::Unreachable(format!("Minecraft-Profil konnte nicht geladen werden (HTTP {s})"))),
        s => return Err(AppError::msg(format!("Minecraft-Profil konnte nicht geladen werden (HTTP {s})"))),
    }
    let p: ProfileResponse = resp.json().await.map_err(|e| AppError::msg(format!("Ungültiges Minecraft-Profil: {e}")))?;
    let skin_url = p
        .skins
        .iter()
        .find(|s| s.state.eq_ignore_ascii_case("active"))
        .or(p.skins.first())
        .map(|s| s.url.clone())
        .filter(|u| !u.is_empty());
    Ok(McProfile { id: p.id.replace('-', ""), name: p.name, skin_url })
}

/// Claim aus dem (unverifizierten) Payload eines JWT lesen.
pub fn jwt_claim(token: &str, claim: &str) -> Option<String> {
    let payload = token.split('.').nth(1)?;
    let bytes = base64::engine::general_purpose::URL_SAFE_NO_PAD.decode(payload.trim_end_matches('=')).ok()?;
    let v: Value = serde_json::from_slice(&bytes).ok()?;
    match &v[claim] {
        Value::String(s) if !s.is_empty() => Some(s.clone()),
        Value::Number(n) => Some(n.to_string()),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn xsts_errors() {
        assert!(xsts_error(br#"{"Identity":"0","XErr":2148916233,"Message":"","Redirect":"https://start.ui.xboxlive.com/CreateAccount"}"#)
            .contains("kein Xbox-Profil"));
        assert!(xsts_error(br#"{"XErr":2148916235}"#).contains("Land"));
        assert!(xsts_error(br#"{"XErr":2148916236}"#).contains("Altersnachweis"));
        assert!(xsts_error(br#"{"XErr":2148916237}"#).contains("Altersnachweis"));
        assert!(xsts_error(br#"{"XErr":2148916238}"#).contains("Kinderkonto"));
        assert!(xsts_error(br#"{"XErr":"2148916238"}"#).contains("Kinderkonto"));
        assert!(xsts_error(br#"{"XErr":123}"#).contains("123"));
        assert_eq!(xsts_error(b"kaputt"), "Xbox-Autorisierung fehlgeschlagen");
    }

    #[test]
    fn oauth_errors() {
        let unknown = br#"{"error":"unauthorized_client","error_description":"AADSTS700016: Application with identifier 'x' was not found in the directory 'Microsoft Accounts'.\r\nTrace ID: abc","error_codes":[700016]}"#;
        assert!(matches!(oauth_error(400, unknown), AppError::NotConfigured(m) if m.contains("AADSTS700016")));
        let public = br#"{"error":"invalid_client","error_description":"AADSTS7000218: The request body must contain ...","error_codes":[7000218]}"#;
        assert!(matches!(oauth_error(400, public), AppError::NotConfigured(m) if m.contains("public client")));
        assert!(matches!(oauth_error(400, br#"{"error":"expired_token"}"#), AppError::Auth(m) if m.contains("abgelaufen")));
        assert!(matches!(oauth_error(400, br#"{"error":"invalid_grant","error_description":"AADSTS70000: x"}"#), AppError::Auth(m) if m.contains("neu anmelden")));
        let invalid = br#"{"error":"invalid_request","error_description":"AADSTS700038: 0000 is not a valid application identifier. Trace ID: f5 Correlation ID: 0e Timestamp: 2026","error_codes":[700038]}"#;
        assert!(matches!(oauth_error(400, invalid), AppError::NotConfigured(m) if m.ends_with("application identifier.")));
        let other = br#"{"error":"temporarily_unavailable","error_description":"Bitte warten\r\nTrace ID: 1"}"#;
        match oauth_error(503, other) {
            AppError::Auth(m) => {
                assert!(m.contains("temporarily_unavailable"));
                assert!(!m.contains("Trace"));
            }
            e => panic!("{e:?}"),
        }
        assert!(matches!(oauth_error(502, b"<html>"), AppError::Msg(_)));
    }

    #[tokio::test]
    async fn code_exchange_sends_verifier() {
        let srv = super::super::fake_server::serve(200, r#"{"access_token":"at","refresh_token":"rt"}"#).await;
        let t = exchange_code_at(&reqwest::Client::new(), &srv.url, "cid", "the-code", "the-verifier").await.unwrap();
        assert_eq!((t.access_token.as_str(), t.refresh_token.as_deref()), ("at", Some("rt")));
        let req = srv.requests.lock().concat();
        let raw_body = req.split("\r\n\r\n").nth(1).unwrap_or_default();
        let body: std::collections::HashMap<String, String> = url::form_urlencoded::parse(raw_body.as_bytes()).into_owned().collect();
        assert_eq!(body["grant_type"], "authorization_code");
        assert_eq!(body["code"], "the-code");
        assert_eq!(body["code_verifier"], "the-verifier");
        assert_eq!(body["redirect_uri"], crate::auth::pkce::REDIRECT_URI);
        assert_eq!(body["client_id"], "cid");
    }

    #[tokio::test]
    async fn code_exchange_redirect_not_enabled() {
        let srv = super::super::fake_server::serve(
            400,
            r#"{"error":"invalid_request","error_description":"AADSTS50011: The redirect URI 'https://login.microsoftonline.com/common/oauth2/nativeclient' specified in the request does not match the redirect URIs configured for the application.","error_codes":[50011]}"#,
        )
        .await;
        let e = exchange_code_at(&reqwest::Client::new(), &srv.url, "cid", "c", "v").await.unwrap_err();
        assert!(matches!(e, AppError::NotConfigured(m) if m.contains("Mobile and desktop applications") && m.contains("(Code)")));
    }

    #[test]
    fn redirect_uri_errors_point_to_fallback() {
        let live = br#"{"error":"invalid_request","error_description":"The provided value for the input parameter 'redirect_uri' is not valid. The expected value is a URI which matches a redirect URI registered for this client application."}"#;
        assert!(matches!(oauth_error(400, live), AppError::NotConfigured(m) if m == REDIRECT_HINT));
        assert!(!redirect_uri_problem("invalid_grant", "redirect_uri"));
    }

    #[test]
    fn jwt_xuid() {
        let payload = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(br#"{"xuid":"2535400000000000","sub":"x"}"#);
        let token = format!("eyJhbGciOiJIUzI1NiJ9.{payload}.sig");
        assert_eq!(jwt_claim(&token, "xuid").as_deref(), Some("2535400000000000"));
        assert_eq!(jwt_claim(&token, "nope"), None);
        assert_eq!(jwt_claim("kein-jwt", "xuid"), None);
    }
}
