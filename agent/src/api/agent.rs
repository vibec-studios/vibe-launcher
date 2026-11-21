use super::auth::Authed;
use super::error::{ApiError, ApiResult};
use crate::roles::Perm;
use crate::state::{AgentState, Ctx};
use axum::extract::{Query, State};
use axum::http::StatusCode;
use axum::Json;
use serde::Deserialize;
use serde_json::{json, Value};

pub fn info_json(ctx: &AgentState) -> Value {
    let cfg = ctx.cfg.read().clone();
    let gw = ctx.gateway.read().clone();
    json!({
        "id": cfg.id,
        "name": cfg.name,
        "hostname": crate::config::hostname(),
        "version": env!("CARGO_PKG_VERSION"),
        "api_version": super::API_VERSION,
        "min_api_version": super::MIN_API_VERSION,
        "os": std::env::consts::OS,
        "arch": std::env::consts::ARCH,
        "tls": cfg.tls,
        "fingerprint": ctx.fingerprint,
        "paired": ctx.users.has_owner(),
        "gateway": { "enabled": cfg.gateway_enabled, "connected": gw.connected, "linked": gw.linked },
        "started_at": ctx.started_at,
    })
}

pub async fn info(State(ctx): State<Ctx>) -> Json<Value> {
    Json(info_json(&ctx))
}

pub async fn me(a: Authed) -> Json<Value> {
    Json(json!({ "user": a.user, "permissions": a.user.role.permissions(), "via": a.via }))
}

pub async fn resources_of(ctx: &AgentState) -> crate::resources::Resources {
    let servers = ctx.core.servers.list().into_iter().map(|s| {
        let pid = ctx.core.server_mgr.status(&s.id).and_then(|st| st.pid);
        (s.id, pid)
    });
    crate::resources::sample(&ctx.core.paths.root, servers.collect()).await
}

pub async fn resources(State(ctx): State<Ctx>, a: Authed) -> ApiResult<Json<crate::resources::Resources>> {
    a.require(Perm::ServersRead)?;
    let mut r = resources_of(&ctx).await;
    r.servers.retain(|s| a.user.can_access(&s.id));
    Ok(Json(r))
}

fn settings_json(ctx: &AgentState) -> Value {
    let cfg = ctx.cfg.read().clone();
    json!({
        "name": cfg.name,
        "port": cfg.port,
        "bind": cfg.bind,
        "tls": cfg.tls,
        "data_dir": ctx.dirs.data,
        "gateway_enabled": cfg.gateway_enabled,
        "hosting": cfg.hosting,
        "auto_java": cfg.auto_java,
        "curseforge_configured": cfg.curseforge_api_key.as_deref().is_some_and(|k| !k.trim().is_empty()),
        "relay": relay_json(ctx),
    })
}

fn relay_json(ctx: &AgentState) -> Value {
    let connected = ctx.host.gateway.connected();
    let owner = ctx.gateway.read().owner.clone();
    json!({ "configured": connected, "source": connected.then_some("gateway"), "name": owner.and_then(|o| o["name"].as_str().map(str::to_string)) })
}

pub async fn settings(State(ctx): State<Ctx>, a: Authed) -> ApiResult<Json<Value>> {
    a.require(Perm::AgentAdmin)?;
    Ok(Json(settings_json(&ctx)))
}

#[derive(Deserialize, Default)]
#[serde(default)]
pub struct SettingsPatch {
    name: Option<String>,
    gateway_enabled: Option<bool>,
    hosting: Option<bool>,
    auto_java: Option<bool>,
}

pub async fn patch_settings(State(ctx): State<Ctx>, a: Authed, Json(p): Json<SettingsPatch>) -> ApiResult<Json<Value>> {
    a.require(Perm::AgentAdmin)?;
    let cfg = {
        let mut c = ctx.cfg.write();
        if let Some(n) = p.name.filter(|n| !n.trim().is_empty()) {
            c.name = n.trim().chars().take(80).collect();
        }
        if let Some(v) = p.gateway_enabled {
            c.gateway_enabled = v;
        }
        if let Some(v) = p.hosting {
            c.hosting = v;
        }
        if let Some(v) = p.auto_java {
            c.auto_java = v;
        }
        c.clone()
    };
    crate::config::save(&ctx.dirs.config, &cfg)?;
    crate::gateway::kick(&ctx);
    a.audit(&ctx, "agent.settings", None, true, None);
    Ok(Json(settings_json(&ctx)))
}

#[derive(Deserialize, Default)]
#[serde(default)]
pub struct AuditQuery {
    limit: Option<usize>,
    before: Option<i64>,
}

pub async fn audit(State(ctx): State<Ctx>, a: Authed, Query(q): Query<AuditQuery>) -> ApiResult<Json<Vec<crate::audit::AuditEntry>>> {
    a.require(Perm::AgentAdmin)?;
    Ok(Json(ctx.audit.read(q.limit.unwrap_or(200), q.before)))
}

pub async fn update_check(State(ctx): State<Ctx>, a: Authed) -> ApiResult<Json<Value>> {
    a.require(Perm::AgentAdmin)?;
    let r = crate::update::check(&ctx.core.net.client).await?;
    Ok(Json(json!({ "current": env!("CARGO_PKG_VERSION"), "latest": r.as_ref().map(|r| r.version.to_string()), "available": r.is_some(), "notes_url": r.map(|r| r.html_url) })))
}

pub async fn update_apply(State(ctx): State<Ctx>, a: Authed) -> ApiResult<Json<Value>> {
    a.require(Perm::AgentAdmin)?;
    let task_id = crate::update::spawn_apply(&ctx);
    a.audit(&ctx, "agent.update", None, true, None);
    Ok(Json(json!({ "task_id": task_id })))
}

pub async fn relay(State(ctx): State<Ctx>, a: Authed) -> ApiResult<Json<Value>> {
    a.require(Perm::ServersRead)?;
    Ok(Json(relay_json(&ctx)))
}

pub async fn gateway(State(ctx): State<Ctx>, a: Authed) -> ApiResult<Json<Value>> {
    a.require(Perm::AgentAdmin)?;
    Ok(Json(crate::gateway::status_json(&ctx)))
}

#[derive(Deserialize, Default)]
#[serde(default)]
pub struct LinkReq {
    code: Option<String>,
}

pub async fn gateway_link(State(ctx): State<Ctx>, a: Authed, body: Option<Json<LinkReq>>) -> ApiResult<Json<Value>> {
    a.require(Perm::AgentAdmin)?;
    let code = body.and_then(|b| b.0.code).filter(|c| !c.trim().is_empty());
    {
        let mut c = ctx.cfg.write();
        c.gateway_enabled = true;
    }
    let cfg = ctx.cfg.read().clone();
    crate::config::save(&ctx.dirs.config, &cfg)?;
    if let Some(c) = code {
        crate::gateway::link_with_code(&ctx, &c).await?;
        a.audit(&ctx, "gateway.link", None, true, Some("code".into()));
        return Ok(Json(crate::gateway::status_json(&ctx)));
    }
    let code = crate::gateway::start_pairing(&ctx).await?;
    a.audit(&ctx, "gateway.link", None, true, None);
    let mut out = crate::gateway::status_json(&ctx);
    out["code"] = json!(code.display);
    out["expires_at"] = json!(code.expires_at);
    Ok(Json(out))
}

pub async fn gateway_unlink(State(ctx): State<Ctx>, a: Authed) -> ApiResult<StatusCode> {
    a.require(Perm::AgentAdmin)?;
    crate::gateway::unlink(&ctx).map_err(ApiError::from)?;
    a.audit(&ctx, "gateway.unlink", None, true, None);
    Ok(StatusCode::NO_CONTENT)
}
