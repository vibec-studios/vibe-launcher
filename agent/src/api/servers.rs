use super::auth::Authed;
use super::error::{ApiError, ApiResult};
use crate::roles::Perm;
use crate::state::Ctx;
use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::Json;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use vibe_server_core::minecraft::LogLine;
use vibe_server_core::server::run::{ServerStatus, TunnelStatus};
use vibe_server_core::server::{ops, Server, ServerCreate, ServerPatch};

#[derive(Serialize)]
pub struct ServerView {
    #[serde(flatten)]
    pub server: Server,
    pub status: Option<ServerStatus>,
}

fn view(ctx: &Ctx, s: Server) -> ServerView {
    let status = ctx.core.server_mgr.status(&s.id);
    ServerView { server: s, status }
}

pub fn ensure_stopped(ctx: &Ctx, id: &str) -> ApiResult<()> {
    if ctx.core.server_mgr.is_active(id) {
        Err(ApiError::server_running())
    } else {
        Ok(())
    }
}

pub fn check_java_path(ctx: &Ctx, p: &ServerPatch) -> ApiResult<()> {
    let Some(Some(path)) = &p.java_path else { return Ok(()) };
    if path.trim().is_empty() {
        return Ok(());
    }
    let allowed = ctx.cfg.read().allowed_java.clone();
    let java_root = ctx.core.paths.java_root();
    let pb = std::path::PathBuf::from(path.trim());
    let ok = std::fs::canonicalize(&pb).ok().is_some_and(|c| {
        std::fs::canonicalize(&java_root).ok().is_some_and(|r| c.starts_with(r))
            || allowed.iter().any(|a| std::fs::canonicalize(a).ok().is_some_and(|r| c.starts_with(r)))
    });
    if ok {
        Ok(())
    } else {
        Err(ApiError::invalid("Java-Pfad ist nicht erlaubt (nur Javas im Agent-Datenordner oder aus allowed_java)."))
    }
}

pub async fn list(State(ctx): State<Ctx>, a: Authed) -> ApiResult<Json<Vec<ServerView>>> {
    a.require(Perm::ServersRead)?;
    Ok(Json(ctx.core.servers.list().into_iter().filter(|s| a.user.can_access(&s.id)).map(|s| view(&ctx, s)).collect()))
}

pub async fn statuses(State(ctx): State<Ctx>, a: Authed) -> ApiResult<Json<Vec<ServerStatus>>> {
    a.require(Perm::ServersRead)?;
    Ok(Json(ctx.core.server_mgr.statuses().into_iter().filter(|s| a.user.can_access(&s.server_id)).collect()))
}

pub async fn get_one(State(ctx): State<Ctx>, a: Authed, Path(id): Path<String>) -> ApiResult<Json<ServerView>> {
    a.server(Perm::ServersRead, &id)?;
    Ok(Json(view(&ctx, ctx.core.servers.get(&id)?)))
}

pub async fn create(State(ctx): State<Ctx>, a: Authed, Json(mut req): Json<ServerCreate>) -> ApiResult<Json<Value>> {
    a.require(Perm::ServersManage)?;
    if !a.user.can_access("*") {
        return Err(ApiError::forbidden("servers.manage (*)"));
    }
    req.from_instance = None;
    req.mods = None;
    req.world = None;
    req.copy_configs = None;
    let s = ctx.core.servers.create(&req)?;
    let task_id = ops::spawn_install(&ctx.core, &s, false, None);
    a.audit(&ctx, "server.create", Some(&s.id), true, Some(format!("{} {}", s.mc_version, s.loader.kind.as_str())));
    Ok(Json(json!({ "server": s, "task_id": task_id })))
}

pub async fn update(State(ctx): State<Ctx>, a: Authed, Path(id): Path<String>, Json(patch): Json<ServerPatch>) -> ApiResult<Json<Server>> {
    a.server(Perm::ServersManage, &id)?;
    check_java_path(&ctx, &patch)?;
    let s = ops::patch(&ctx.core, &id, patch)?;
    a.audit(&ctx, "server.update", Some(&id), true, None);
    Ok(Json(s))
}

pub async fn remove(State(ctx): State<Ctx>, a: Authed, Path(id): Path<String>) -> ApiResult<StatusCode> {
    a.server(Perm::ServersManage, &id)?;
    ctx.core.servers.get(&id)?;
    ensure_stopped(&ctx, &id)?;
    ops::delete(&ctx.core, &id).await?;
    a.audit(&ctx, "server.delete", Some(&id), true, None);
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Deserialize, Default)]
#[serde(default)]
pub struct InstallReq {
    force: bool,
}

pub async fn install(State(ctx): State<Ctx>, a: Authed, Path(id): Path<String>, body: Option<Json<InstallReq>>) -> ApiResult<Json<Value>> {
    a.server(Perm::ServersManage, &id)?;
    ctx.core.servers.get(&id)?;
    ensure_stopped(&ctx, &id)?;
    let force = body.map(|b| b.0.force).unwrap_or(false);
    let task_id = ops::install(&ctx.core, &id, force)?;
    a.audit(&ctx, "server.install", Some(&id), true, force.then(|| "force".into()));
    Ok(Json(json!({ "task_id": task_id })))
}

pub async fn eula(State(ctx): State<Ctx>, a: Authed, Path(id): Path<String>) -> ApiResult<Json<Server>> {
    a.server(Perm::ServersManage, &id)?;
    ctx.core.servers.get(&id)?;
    let s = ops::accept_eula(&ctx.core, &id, "Vibe Agent")?;
    a.audit(&ctx, "server.eula", Some(&id), true, None);
    Ok(Json(s))
}

async fn control(ctx: &Ctx, a: &Authed, id: &str, action: &str) -> ApiResult<StatusCode> {
    a.server(Perm::ServersControl, id)?;
    ctx.core.servers.get(id)?;
    let core = &ctx.core;
    let r = match action {
        "start" => vibe_server_core::server::run::start(core, id),
        "stop" => core.server_mgr.stop(id),
        "restart" => core.server_mgr.restart(core, id),
        _ => core.server_mgr.kill(id),
    };
    a.audit(ctx, &format!("server.{action}"), Some(id), r.is_ok(), r.as_ref().err().map(|e| e.to_string()));
    r?;
    Ok(StatusCode::NO_CONTENT)
}

pub async fn start(State(ctx): State<Ctx>, a: Authed, Path(id): Path<String>) -> ApiResult<StatusCode> {
    control(&ctx, &a, &id, "start").await
}

pub async fn stop(State(ctx): State<Ctx>, a: Authed, Path(id): Path<String>) -> ApiResult<StatusCode> {
    control(&ctx, &a, &id, "stop").await
}

pub async fn restart(State(ctx): State<Ctx>, a: Authed, Path(id): Path<String>) -> ApiResult<StatusCode> {
    control(&ctx, &a, &id, "restart").await
}

pub async fn kill(State(ctx): State<Ctx>, a: Authed, Path(id): Path<String>) -> ApiResult<StatusCode> {
    control(&ctx, &a, &id, "kill").await
}

#[derive(Deserialize)]
pub struct CommandReq {
    command: String,
}

pub fn run_command(ctx: &Ctx, a: &Authed, id: &str, command: &str) -> ApiResult<()> {
    a.server(Perm::ServersControl, id)?;
    let command = command.trim();
    if command.is_empty() || command.len() > 1000 || command.contains(['\n', '\r']) {
        return Err(ApiError::invalid("Ungültiger Befehl."));
    }
    if !ctx.core.server_mgr.is_active(id) {
        return Err(ApiError::new(StatusCode::CONFLICT, "server_not_running", "Der Server läuft nicht."));
    }
    ctx.core.server_mgr.command(id, command)?;
    a.audit(ctx, "server.command", Some(id), true, Some(command.chars().take(200).collect()));
    Ok(())
}

pub async fn command(State(ctx): State<Ctx>, a: Authed, Path(id): Path<String>, Json(req): Json<CommandReq>) -> ApiResult<StatusCode> {
    run_command(&ctx, &a, &id, &req.command)?;
    Ok(StatusCode::NO_CONTENT)
}

pub async fn status(State(ctx): State<Ctx>, a: Authed, Path(id): Path<String>) -> ApiResult<Json<Value>> {
    a.server(Perm::ServersRead, &id)?;
    ctx.core.servers.get(&id)?;
    Ok(Json(serde_json::to_value(ctx.core.server_mgr.status(&id)).unwrap_or(Value::Null)))
}

#[derive(Deserialize, Default)]
#[serde(default)]
pub struct LogQuery {
    after: Option<u64>,
}

pub async fn log(State(ctx): State<Ctx>, a: Authed, Path(id): Path<String>, Query(q): Query<LogQuery>) -> ApiResult<Json<Vec<LogLine>>> {
    a.server(Perm::ServersRead, &id)?;
    let lines = ctx.core.server_mgr.log(&id);
    let lines: Vec<LogLine> = match q.after {
        Some(after) => lines.into_iter().filter(|l| l.seq > after).collect(),
        None => lines,
    };
    let skip = lines.len().saturating_sub(2000);
    Ok(Json(lines.into_iter().skip(skip).collect()))
}

pub async fn addresses(State(ctx): State<Ctx>, a: Authed, Path(id): Path<String>) -> ApiResult<Json<Value>> {
    a.server(Perm::ServersRead, &id)?;
    let addr = ops::addresses(&ctx.core, &id)?;
    let relay = ctx.core.server_mgr.status(&id).and_then(|s| s.tunnel).and_then(|t| t.address);
    Ok(Json(json!({ "local": addr.local, "lan": addr.lan, "public": Value::Null, "relay": relay })))
}

pub async fn tunnel(State(ctx): State<Ctx>, a: Authed, Path(id): Path<String>) -> ApiResult<Json<Option<TunnelStatus>>> {
    a.server(Perm::ServersRead, &id)?;
    ctx.core.servers.get(&id)?;
    Ok(Json(ctx.core.server_mgr.status(&id).and_then(|s| s.tunnel)))
}

pub async fn tunnel_reset(State(ctx): State<Ctx>, a: Authed, Path(id): Path<String>) -> ApiResult<StatusCode> {
    a.server(Perm::ServersManage, &id)?;
    let s = ctx.core.servers.get(&id)?;
    if s.connection == vibe_server_core::server::ServerConnection::Relay && !ctx.host.gateway.connected() {
        return Err(ApiError::new(StatusCode::FAILED_DEPENDENCY, "not_configured", "Für den Vibe-Relay muss der Agent mit einem Vibe-Konto verbunden sein."));
    }
    ops::tunnel_reset(&ctx.core, &id)?;
    a.audit(&ctx, "server.tunnel_reset", Some(&id), true, None);
    Ok(StatusCode::NO_CONTENT)
}

pub async fn properties(State(ctx): State<Ctx>, a: Authed, Path(id): Path<String>) -> ApiResult<Json<Vec<(String, String)>>> {
    a.server(Perm::ServersRead, &id)?;
    Ok(Json(ops::properties(&ctx.core, &id)?))
}

#[derive(Deserialize)]
pub struct PropsReq {
    values: HashMap<String, String>,
}

pub async fn set_properties(State(ctx): State<Ctx>, a: Authed, Path(id): Path<String>, Json(req): Json<PropsReq>) -> ApiResult<Json<Vec<(String, String)>>> {
    a.server(Perm::ServersManage, &id)?;
    let keys: Vec<String> = req.values.keys().cloned().collect();
    let out = ops::set_properties(&ctx.core, &id, req.values)?;
    a.audit(&ctx, "server.properties", Some(&id), true, Some(keys.join(",")));
    Ok(Json(out))
}

pub async fn properties_raw(State(ctx): State<Ctx>, a: Authed, Path(id): Path<String>) -> ApiResult<String> {
    a.server(Perm::ServersRead, &id)?;
    Ok(ops::properties_raw(&ctx.core, &id)?)
}

pub async fn set_properties_raw(State(ctx): State<Ctx>, a: Authed, Path(id): Path<String>, text: String) -> ApiResult<StatusCode> {
    a.server(Perm::ServersManage, &id)?;
    ops::set_properties_raw(&ctx.core, &id, &text)?;
    a.audit(&ctx, "server.properties_raw", Some(&id), true, None);
    Ok(StatusCode::NO_CONTENT)
}
