use super::*;

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
pub(super) fn default_expires() -> u64 {
    900
}
pub(super) fn default_interval() -> u64 {
    5
}

#[derive(Debug, Clone, Deserialize)]
pub struct MsaTokens {
    pub access_token: String,
    #[serde(default)]
    pub refresh_token: Option<String>,
}

#[derive(Debug, Deserialize)]
pub(super) struct OAuthError {
    #[serde(default)]
    pub(super) error: String,
    #[serde(default)]
    pub(super) error_description: String,
    #[serde(default)]
    pub(super) error_codes: Vec<u64>,
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
            ("redirect_uri", super::super::pkce::REDIRECT_URI),
            ("code_verifier", verifier),
            ("scope", MSA_SCOPE),
        ],
    )
    .await
}

pub(super) async fn token_post(client: &reqwest::Client, token_url: &str, form: &[(&str, &str)]) -> AppResult<MsaTokens> {
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

pub(super) fn parse_tokens(body: &[u8]) -> AppResult<MsaTokens> {
    serde_json::from_slice(body).map_err(|e| AppError::msg(format!("Ungültige Token-Antwort von Microsoft: {e}")))
}

/// Erste Zeile ohne angehängte Trace-/Correlation-IDs.
pub(super) fn first_line(s: &str) -> &str {
    let s = s.lines().next().unwrap_or("");
    let s = s.split(" Trace ID:").next().unwrap_or(s);
    s.trim()
}
