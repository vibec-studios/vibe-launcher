use super::http::{self, Body};
use super::pair::{self, Probe};
use super::upload::{self, Progress};
use super::{store, vibe, ws, RemoteAgent, Via};
use crate::error::{AppError, AppResult};
use crate::state::AppState;
use serde::Serialize;
use serde_json::{json, Value};
use tauri::{AppHandle, State};

#[derive(Serialize)]
pub struct AgentView {
    #[serde(flatten)]
    pub agent: RemoteAgent,
    pub conn: Option<&'static str>,
}

fn view(a: RemoteAgent) -> AgentView {
    let conn = ws::state_of(&a.key);
    AgentView { agent: a, conn }
}

#[tauri::command]
pub fn remote_agents(state: State<'_, AppState>) -> Vec<AgentView> {
    store::list(&state.paths).into_iter().map(view).collect()
}

async fn resolve_gateway_ids(state: &AppState) {
    let all = store::list(&state.paths);
    let unmatched = all.iter().any(|v| v.via == Via::Vibe && !all.iter().any(|d| d.gateway_id.as_deref() == Some(v.id.as_str())));
    if !unmatched {
        return;
    }
    let pending: Vec<RemoteAgent> = all.into_iter().filter(|a| a.via == Via::Direct && a.gateway_id.is_none()).collect();
    let found = futures::future::join_all(pending.iter().map(|a| http::direct(state, a, "GET", "/agent/gateway", Body { json: None, text: None }, 4))).await;
    for (a, r) in pending.iter().zip(found) {
        let Ok(v) = r else { continue };
        if let Some(gid) = v["agent_id"].as_str().filter(|g| super::valid_id(g)).map(str::to_string) {
            let _ = store::update(&state.paths, &a.key, |x| x.gateway_id = Some(gid));
        }
    }
}

#[tauri::command]
pub async fn remote_vibe_sync(state: State<'_, AppState>) -> AppResult<Vec<AgentView>> {
    let fresh = vibe::list(&state).await?;
    let keep: Vec<String> = fresh.iter().map(|a| a.key.clone()).collect();
    for a in store::list(&state.paths).into_iter().filter(|a| a.via == Via::Vibe && !keep.contains(&a.key)) {
        ws::disconnect(&a.key);
    }
    store::replace_vibe(&state.paths, fresh)?;
    resolve_gateway_ids(&state).await;
    Ok(store::list(&state.paths).into_iter().map(view).collect())
}

#[tauri::command]
pub async fn remote_vibe_claim(state: State<'_, AppState>, code: String, name: Option<String>) -> AppResult<AgentView> {
    let agent = vibe::claim(&state, &code, name.as_deref()).await?;
    let agent = store::upsert(&state.paths, agent)?;
    Ok(view(agent))
}

#[tauri::command]
pub async fn remote_upload_file(
    app: AppHandle,
    state: State<'_, AppState>,
    agent: String,
    method: String,
    path: String,
    file: String,
    content_type: Option<String>,
    progress_id: Option<String>,
) -> AppResult<Value> {
    let a = store::get(&state.paths, &agent)?;
    let ct = content_type.unwrap_or_else(|| "application/octet-stream".into());
    upload::upload(&state, &a, &method, &path, std::path::Path::new(&file), &ct, Progress::new(app, progress_id, 0)).await
}

#[tauri::command]
pub async fn remote_probe(address: String) -> AppResult<Probe> {
    pair::probe(&address).await
}

#[tauri::command]
pub async fn remote_pair(app: AppHandle, state: State<'_, AppState>, address: String, code: String, fingerprint: String) -> AppResult<AgentView> {
    let agent = pair::pair(&state, &address, &code, &fingerprint).await?;
    ws::disconnect(&agent.key);
    ws::connect(app, agent.clone());
    Ok(view(agent))
}

#[tauri::command]
pub async fn remote_vibe_link_code(state: State<'_, AppState>) -> AppResult<Value> {
    vibe::link_code(&state).await
}

#[tauri::command]
pub async fn remote_gateway_link(state: State<'_, AppState>, agent: String, code: String) -> AppResult<Value> {
    let a = store::get(&state.paths, &agent)?;
    if a.via != Via::Direct {
        return Err(AppError::Invalid("Dieser Server ist schon über Vibe verbunden.".into()));
    }
    let v = http::request(&state, &a, "POST", "/agent/gateway/link", Body { json: Some(json!({ "code": code })), text: None }).await?;
    if let Some(gid) = v["agent_id"].as_str().filter(|g| super::valid_id(g)).map(str::to_string) {
        let _ = store::update(&state.paths, &agent, |x| x.gateway_id = Some(gid));
    }
    Ok(v)
}

#[tauri::command]
pub async fn remote_agent_rename(state: State<'_, AppState>, agent: String, name: String) -> AppResult<AgentView> {
    let name = name.trim().to_string();
    if name.is_empty() || name.chars().count() > 60 {
        return Err(AppError::Invalid("Der Name muss 1 bis 60 Zeichen lang sein.".into()));
    }
    let a = store::get(&state.paths, &agent)?;
    if a.via == Via::Vibe {
        vibe::rename(&state, &a.id, &name).await?;
    }
    Ok(view(store::update(&state.paths, &agent, |x| x.name = name)?))
}

#[tauri::command]
pub async fn remote_agent_remove(state: State<'_, AppState>, agent: String) -> AppResult<()> {
    let a = store::get(&state.paths, &agent)?;
    ws::disconnect(&a.key);
    match a.via {
        Via::Vibe => vibe::unlink(&state, &a.id).await?,
        Via::Direct => {
            if let Some(tid) = a.token_id.clone() {
                let path = format!("/tokens/{}", urlencoding::encode(&tid));
                if let Err(e) = http::direct(&state, &a, "DELETE", &path, Body { json: None, text: None }, 6).await {
                    tracing::info!("Remote-Token nicht widerrufen ({}): {e}", a.key);
                }
            }
        }
    }
    store::remove(&state.paths, &a.key)
}

#[tauri::command]
pub async fn remote_agent_info(state: State<'_, AppState>, agent: String) -> AppResult<Value> {
    let a = store::get(&state.paths, &agent)?;
    let info = http::request(&state, &a, "GET", "/info", Body { json: None, text: None }).await?;
    let version = info["version"].as_str().map(str::to_string);
    let os = info["os"].as_str().map(str::to_string);
    let arch = info["arch"].as_str().map(str::to_string);
    let _ = store::update(&state.paths, &agent, |x| {
        x.version = version.or(x.version.take());
        x.os = os.or(x.os.take());
        x.arch = arch.or(x.arch.take());
        x.last_seen = Some(super::now_ms());
    });
    Ok(info)
}

#[tauri::command]
pub async fn remote_request(state: State<'_, AppState>, agent: String, method: String, path: String, body: Option<Value>, text: Option<String>) -> AppResult<Value> {
    let a = store::get(&state.paths, &agent)?;
    http::request(&state, &a, &method, &path, Body { json: body, text }).await
}

#[tauri::command]
pub fn remote_ws_connect(app: AppHandle, state: State<'_, AppState>, agent: String) -> AppResult<()> {
    let a = store::get(&state.paths, &agent)?;
    ws::connect(app, a);
    Ok(())
}

#[tauri::command]
pub fn remote_ws_disconnect(agent: String) {
    ws::disconnect(&agent);
}

#[tauri::command]
pub fn remote_ws_subscribe(agent: String, topics: Vec<String>, on: bool) -> AppResult<()> {
    ws::subscribe(&agent, topics, on)
}

#[tauri::command]
pub fn remote_ws_send(agent: String, data: String) -> AppResult<()> {
    ws::send(&agent, data)
}
