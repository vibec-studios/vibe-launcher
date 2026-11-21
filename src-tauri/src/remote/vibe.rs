use super::{agent_key, http, now_ms, valid_id, RemoteAgent, Via};
use crate::error::{AppError, AppResult};
use crate::state::AppState;
use crate::vibe::{self as core, Feature};
use serde_json::{json, Value};
use std::time::Duration;

pub fn token(state: &AppState) -> AppResult<String> {
    core::tokens_get(state)
        .map(|t| t.access_token)
        .ok_or_else(|| AppError::Auth("Du bist nicht bei Vibe angemeldet. Melde dich zuerst unter Freunde an.".into()))
}

pub fn base(state: &AppState) -> AppResult<String> {
    core::ensure(state, Feature::Any)
}

pub fn builder(state: &AppState, m: reqwest::Method, path: &str) -> AppResult<reqwest::RequestBuilder> {
    builder_with(state, m, path, 30)
}

pub fn builder_with(state: &AppState, m: reqwest::Method, path: &str, timeout_s: u64) -> AppResult<reqwest::RequestBuilder> {
    let url = format!("{}{path}", base(state)?);
    Ok(state.net.client.request(m, url).timeout(Duration::from_secs(timeout_s)).bearer_auth(token(state)?).header("X-Vibe-Api", "1"))
}

pub async fn call(state: &AppState, m: reqwest::Method, path: &str, body: Option<Value>) -> AppResult<Value> {
    let mut rb = builder(state, m, path)?;
    if let Some(b) = body {
        rb = rb.json(&b);
    }
    let res = rb.send().await.map_err(|e| http::send_error(e, None, "Vibe"))?;
    http::read(res).await
}

pub fn ws_url(state: &AppState, agent_id: &str) -> AppResult<String> {
    let b = base(state)?;
    let b = if let Some(r) = b.strip_prefix("https://") {
        format!("wss://{r}")
    } else if let Some(r) = b.strip_prefix("http://") {
        format!("ws://{r}")
    } else {
        b
    };
    Ok(format!("{b}/api/v1/agents/{agent_id}/ws"))
}

pub fn proxy_path(agent_id: &str, path: &str) -> String {
    format!("/api/v1/agents/{agent_id}/proxy{path}")
}

fn iso_ms(v: &Value) -> Option<i64> {
    v.as_i64().or_else(|| v.as_str().and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok()).map(|d| d.timestamp_millis()))
}

pub fn parse(v: &Value) -> Option<RemoteAgent> {
    let id = v["id"].as_str()?.to_string();
    if !valid_id(&id) {
        return None;
    }
    let s = |k: &str| v[k].as_str().filter(|x| !x.is_empty()).map(str::to_string);
    Some(RemoteAgent {
        key: agent_key(Via::Vibe, &id),
        name: s("name").unwrap_or_else(|| id.clone()),
        id,
        via: Via::Vibe,
        address: None,
        fingerprint: None,
        version: s("version"),
        os: s("os"),
        arch: s("arch"),
        token_id: None,
        role: s("myRole").or_else(|| s("role")),
        online: v["online"].as_bool(),
        last_seen: iso_ms(&v["lastSeenAt"]),
        gateway_id: None,
        disabled: v["disabled"].as_bool(),
        added_at: iso_ms(&v["createdAt"]).unwrap_or_else(now_ms),
    })
}

pub async fn list(state: &AppState) -> AppResult<Vec<RemoteAgent>> {
    let v = call(state, reqwest::Method::GET, "/api/v1/agents", None).await?;
    let arr = v["agents"].as_array().or_else(|| v.as_array()).cloned().unwrap_or_default();
    Ok(arr.iter().filter_map(parse).collect())
}

pub async fn link_code(state: &AppState) -> AppResult<Value> {
    let v = call(state, reqwest::Method::POST, "/api/v1/agents/link-codes", Some(json!({}))).await?;
    let code = v["code"].as_str().ok_or_else(|| AppError::Msg("Vibe hat keinen Code geliefert.".into()))?;
    let expires = iso_ms(&v["expiresAt"]).or_else(|| iso_ms(&v["expires_at"])).unwrap_or_else(|| now_ms() + 600_000);
    Ok(json!({ "code": code, "expires_at": expires }))
}

pub async fn claim(state: &AppState, code: &str, name: Option<&str>) -> AppResult<RemoteAgent> {
    let mut body = json!({ "code": code.trim() });
    if let Some(n) = name.map(str::trim).filter(|n| !n.is_empty()) {
        body["name"] = json!(n);
    }
    let v = match call(state, reqwest::Method::POST, "/api/v1/agents/claim", Some(body)).await {
        Err(AppError::NotFound(_)) => return Err(AppError::Invalid("Der Code ist falsch, schon benutzt oder abgelaufen.".into())),
        r => r?,
    };
    parse(&v).ok_or_else(|| AppError::Msg("Ungültige Antwort von Vibe".into()))
}

pub async fn rename(state: &AppState, id: &str, name: &str) -> AppResult<()> {
    call(state, reqwest::Method::PATCH, &format!("/api/v1/agents/{id}"), Some(json!({ "name": name }))).await.map(|_| ())
}

pub async fn unlink(state: &AppState, id: &str) -> AppResult<()> {
    match call(state, reqwest::Method::DELETE, &format!("/api/v1/agents/{id}"), None).await {
        Ok(_) | Err(AppError::NotFound(_)) => Ok(()),
        Err(e) => Err(e),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_gateway_agent() {
        let v = json!({
            "id": "ag_1", "name": "Server-PC", "hostname": "srv", "os": "linux", "arch": "x86_64", "version": "0.1.0",
            "online": true, "lastSeenAt": "2026-11-21T12:00:00.000Z", "createdAt": "2026-11-20T12:00:00.000Z",
            "owner": { "id": "u1", "name": "Steve" }, "myRole": "owner", "summary": null, "disabled": false
        });
        let a = parse(&v).unwrap();
        assert_eq!(a.key, "v-ag_1");
        assert_eq!(a.role.as_deref(), Some("owner"));
        assert_eq!(a.last_seen, Some(1_795_262_400_000));
        assert_eq!(a.online, Some(true));
        assert_eq!(a.disabled, Some(false));
        assert!(parse(&json!({ "id": "bad id" })).is_none());
    }
}
