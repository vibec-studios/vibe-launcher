use super::tls::{self, Pinned};
use super::{store, vibe, RemoteAgent, Via};
use crate::error::{AppError, AppResult};
use crate::state::AppState;
use serde_json::Value;
use std::sync::Arc;

pub struct Body {
    pub json: Option<Value>,
    pub text: Option<String>,
}

pub fn method(m: &str) -> AppResult<reqwest::Method> {
    Ok(match m.to_ascii_uppercase().as_str() {
        "GET" => reqwest::Method::GET,
        "POST" => reqwest::Method::POST,
        "PUT" => reqwest::Method::PUT,
        "PATCH" => reqwest::Method::PATCH,
        "DELETE" => reqwest::Method::DELETE,
        _ => return Err(AppError::Invalid("Methode nicht erlaubt".into())),
    })
}

pub fn check_path(path: &str) -> AppResult<()> {
    let p = path.split('?').next().unwrap_or("");
    let bad = !path.starts_with('/') || path.starts_with("//") || path.contains("://") || path.contains('\\') || p.split('/').any(|s| s == ".." || s == ".");
    if bad {
        return Err(AppError::Invalid("Ungültiger Pfad".into()));
    }
    Ok(())
}

pub fn base_url(address: &str) -> AppResult<String> {
    let raw = address.trim();
    let rest = raw.strip_prefix("https://").or_else(|| raw.strip_prefix("wss://")).unwrap_or(raw);
    if rest.contains("://") {
        return Err(AppError::Invalid("Bitte nur die Adresse eingeben, z. B. 192.168.1.20 oder server.example.com:25580".into()));
    }
    let rest = rest.split('/').next().unwrap_or("").trim();
    if rest.is_empty() {
        return Err(AppError::Invalid("Bitte die Adresse des Servers eingeben.".into()));
    }
    let u = url::Url::parse(&format!("https://{rest}")).map_err(|_| AppError::Invalid("Diese Adresse ist ungültig.".into()))?;
    let host = u.host_str().ok_or_else(|| AppError::Invalid("Diese Adresse ist ungültig.".into()))?;
    let port = u.port().unwrap_or(super::DEFAULT_PORT);
    Ok(format!("https://{host}:{port}"))
}

pub fn error_from(status: u16, text: &str) -> AppError {
    let v: Value = serde_json::from_str(text).unwrap_or(Value::Null);
    let e = &v["error"];
    let code = e["code"].as_str().unwrap_or("");
    let msg = e["message"].as_str().map(str::to_string).unwrap_or_else(|| match status {
        401 => "Zugang abgelehnt.".into(),
        403 => "Dafür fehlen dir auf diesem Server die Rechte.".into(),
        404 => "Nicht gefunden.".into(),
        429 => "Zu viele Anfragen. Bitte kurz warten.".into(),
        502..=504 => "Der Remote-Server ist gerade nicht erreichbar.".into(),
        _ => format!("Fehler vom Remote-Server (HTTP {status})"),
    });
    let kind = e["kind"].as_str().unwrap_or("");
    match (status, code, kind) {
        (_, "token_expired" | "invalid_token", _) => AppError::Auth(code.into()),
        (401, _, _) | (_, _, "auth") => AppError::Auth(msg),
        (_, "agent_offline", _) | (502..=504, _, _) | (_, _, "network") => AppError::Unreachable(msg),
        (404, _, _) | (_, _, "not_found") => AppError::NotFound(msg),
        (403, _, _) | (_, _, "access") => AppError::Access(msg),
        (_, _, "not_configured") => AppError::NotConfigured(msg),
        _ => AppError::Msg(msg),
    }
}

pub async fn read(res: reqwest::Response) -> AppResult<Value> {
    let status = res.status().as_u16();
    let json = res
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .is_some_and(|c| c.contains("json"));
    let text = res.text().await.map_err(|e| AppError::Unreachable(format!("Antwort unvollständig: {e}")))?;
    if !(200..300).contains(&status) {
        return Err(error_from(status, &text));
    }
    if status == 204 || text.is_empty() {
        return Ok(Value::Null);
    }
    if json {
        return Ok(serde_json::from_str(&text)?);
    }
    Ok(Value::String(text))
}

pub fn send_error(e: reqwest::Error, pin: Option<&Pinned>, address: &str) -> AppError {
    if pin.is_some_and(|p| p.mismatched()) {
        return AppError::Access(
            "Das Zertifikat dieses Servers hat sich geändert. Aus Sicherheitsgründen wird keine Verbindung aufgebaut. Wurde der Agent neu installiert, entferne ihn und kopple ihn neu.".into(),
        );
    }
    if e.is_timeout() {
        return AppError::Unreachable(format!("{address} antwortet nicht (Zeitüberschreitung)."));
    }
    AppError::Unreachable(format!("{address} ist nicht erreichbar. Läuft der Vibe Server Agent und ist der Port freigegeben?"))
}

fn apply(rb: reqwest::RequestBuilder, body: Body) -> reqwest::RequestBuilder {
    if let Some(t) = body.text {
        return rb.header(reqwest::header::CONTENT_TYPE, "text/plain; charset=utf-8").body(t);
    }
    if let Some(j) = body.json {
        return rb.json(&j);
    }
    rb
}

pub async fn direct(state: &AppState, agent: &RemoteAgent, m: &str, path: &str, body: Body, timeout_s: u64) -> AppResult<Value> {
    check_path(path)?;
    let address = agent.address.clone().ok_or_else(|| AppError::Invalid("Adresse fehlt".into()))?;
    let base = base_url(&address)?;
    let token = store::load_token(&state.paths, &agent.key)?;
    let pin = Pinned::new(agent.fingerprint.as_deref());
    let client = tls::client(Arc::clone(&pin), timeout_s);
    let rb = client.request(method(m)?, format!("{base}/api/v1{path}")).bearer_auth(token).header("X-Vibe-Api", "1");
    let res = apply(rb, body).send().await.map_err(|e| send_error(e, Some(&pin), &address))?;
    match read(res).await {
        Err(AppError::Auth(m)) if m != "token_expired" => Err(AppError::Auth(
            "Der Launcher ist bei diesem Server nicht mehr angemeldet (Zugang widerrufen?). Bitte entfernen und neu koppeln.".into(),
        )),
        r => r,
    }
}

pub async fn request(state: &AppState, agent: &RemoteAgent, m: &str, path: &str, body: Body) -> AppResult<Value> {
    match agent.via {
        Via::Direct => direct(state, agent, m, path, body, 30).await,
        Via::Vibe => {
            check_path(path)?;
            let rb = vibe::builder(state, method(m)?, &format!("/api/v1/agents/{}/proxy{path}", agent.id))?;
            let res = apply(rb, body).send().await.map_err(|e| send_error(e, None, "Vibe"))?;
            read(res).await
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn base_urls() {
        assert_eq!(base_url("192.168.1.20").unwrap(), "https://192.168.1.20:25580");
        assert_eq!(base_url("https://host.example:1234/").unwrap(), "https://host.example:1234");
        assert_eq!(base_url(" [::1]:9 ").unwrap(), "https://[::1]:9");
        assert!(base_url("ftp://x").is_err());
        assert!(base_url("").is_err());
    }

    #[test]
    fn paths() {
        assert!(check_path("/servers/a/start").is_ok());
        assert!(check_path("/servers?x=1").is_ok());
        assert!(check_path("servers").is_err());
        assert!(check_path("/servers/../x").is_err());
        assert!(check_path("//evil").is_err());
    }

    #[test]
    fn errors_map() {
        assert_eq!(error_from(404, r#"{"error":{"code":"not_found","message":"weg","kind":"not_found"}}"#).kind(), "not_found");
        assert_eq!(error_from(409, r#"{"error":{"code":"server_running","message":"läuft","kind":"invalid"}}"#).to_string(), "läuft");
        assert_eq!(error_from(503, "").kind(), "network");
        assert_eq!(error_from(401, r#"{"error":{"code":"token_expired"}}"#).to_string(), "Authentifizierung fehlgeschlagen: token_expired");
    }
}
