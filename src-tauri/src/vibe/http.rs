use super::*;

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
/// Beim offiziellen Backend gelten neue und alte Adresse (`vibe.axolite.app`, `vibe.henny.dev`) als dasselbe Backend,
/// damit Downloads aus Antworten mit der alten Adresse weiter funktionieren.
pub fn check_api_url(base: &str, url: &str) -> AppResult<url::Url> {
    let b = url::Url::parse(base).map_err(|_| AppError::Invalid("Ungültige Vibe-Server-Adresse".into()))?;
    let u = url::Url::parse(url).map_err(|_| AppError::Invalid("Ungültige Adresse".into()))?;
    let host_ok = u.host_str().is_some_and(|h| crate::domains::backend_hosts(base).iter().any(|x| x.eq_ignore_ascii_case(h)));
    let same = u.scheme() == b.scheme() && host_ok && u.port_or_known_default() == b.port_or_known_default();
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
    let v = serde_json::from_str::<serde_json::Value>(body).ok();
    let code = v.as_ref().and_then(|v| v["error"]["code"].as_str()).unwrap_or_default();
    if status == 403 {
        if let Some(text) = access_text(code) {
            return AppError::Access(text.into());
        }
    }
    let msg = v
        .as_ref()
        .and_then(|v| v["error"]["message"].as_str().map(str::to_string))
        .unwrap_or_else(|| format!("Vibe-Server antwortet mit HTTP {status}"));
    if status == 401 {
        AppError::Auth(msg)
    } else {
        AppError::Msg(msg)
    }
}

/// Text für die Beta-Sperre (`ACCESS_*`), sonst None.
pub fn access_text(code: &str) -> Option<&'static str> {
    match code {
        "ACCESS_PENDING" => Some("Vibe ist in der Beta: Du bist noch auf der Warteliste. Sobald du freigeschaltet bist, geht das hier."),
        "ACCESS_REJECTED" => Some("Vibe ist in der Beta: Deine Anfrage wurde abgelehnt. In den Vibe-Einstellungen kannst du erneut anfragen."),
        "ACCESS_NONE" => Some("Vibe ist in der Beta: Dafür brauchst du Zugang. Tritt in den Vibe-Einstellungen der Warteliste bei."),
        _ => None,
    }
}
