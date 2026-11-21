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
    let url = format!("{}{path}", base(state)?);
    Ok(state.net.client.request(m, url).timeout(Duration::from_secs(30)).bearer_auth(token(state)?).header("X-Vibe-Api", "1"))
}

async fn call(state: &AppState, m: reqwest::Method, path: &str, body: Option<Value>) -> AppResult<Value> {
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

fn parse(v: &Value) -> Option<RemoteAgent> {
    let id = v["id"].as_str()?.to_string();
    if !valid_id(&id) {
        return None;
    }
    let s = |k: &str| v[k].as_str().map(str::to_string);
    Some(RemoteAgent {
        key: agent_key(Via::Vibe, &id),
        name: s("name").unwrap_or_else(|| id.clone()),
        id,
        via: Via::Vibe,
        address: None,
        fingerprint: s("fingerprint"),
        version: s("version"),
        os: s("os"),
        arch: s("arch"),
        token_id: None,
        role: s("role"),
        online: v["online"].as_bool(),
        last_seen: v["last_seen"].as_i64(),
        added_at: now_ms(),
    })
}

pub async fn list(state: &AppState) -> AppResult<Vec<RemoteAgent>> {
    let v = call(state, reqwest::Method::GET, "/api/v1/agents", None).await?;
    let arr = v["agents"].as_array().or_else(|| v.as_array()).cloned().unwrap_or_default();
    Ok(arr.iter().filter_map(parse).collect())
}

pub async fn link_code(state: &AppState) -> AppResult<Value> {
    call(state, reqwest::Method::POST, "/api/v1/agents/link-codes", Some(json!({}))).await
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
