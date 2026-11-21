use super::auth::Authed;
use super::error::{ApiError, ApiResult};
use crate::roles::Perm;
use crate::state::Ctx;
use axum::extract::{Path, Query, State};
use axum::Json;
use serde::Deserialize;
use serde_json::{json, Value};
use vibe_server_core::minecraft::{loaders, meta, LoaderVersion};
use vibe_server_core::model::LoaderKind;
use vibe_server_core::server::ops;
use vibe_server_core::server::platform::{self, PlatformBuild, PlatformKind, PlatformVersion};

pub async fn minecraft(State(ctx): State<Ctx>, a: Authed) -> ApiResult<Json<Vec<Value>>> {
    a.require(Perm::ServersRead)?;
    let m = meta::manifest(&ctx.core, false).await?;
    Ok(Json(m.versions.iter().map(|v| json!({ "id": v.id, "type": v.kind, "release_time": v.release_time })).collect()))
}

#[derive(Deserialize, Default)]
#[serde(default)]
pub struct McQuery {
    mc: String,
}

fn loader_kind(s: &str) -> ApiResult<LoaderKind> {
    LoaderKind::parse(s).ok_or_else(|| ApiError::invalid(format!("Unbekannter Loader: {s}")))
}

fn platform_kind(s: &str) -> ApiResult<PlatformKind> {
    serde_json::from_value(Value::String(s.to_ascii_lowercase())).map_err(|_| ApiError::invalid(format!("Unbekannte Plattform: {s}")))
}

pub async fn loaders(State(ctx): State<Ctx>, a: Authed, Path(kind): Path<String>, Query(q): Query<McQuery>) -> ApiResult<Json<Vec<LoaderVersion>>> {
    a.require(Perm::ServersRead)?;
    let kind = loader_kind(&kind)?;
    if q.mc.trim().is_empty() {
        return Err(ApiError::invalid("Parameter mc fehlt."));
    }
    Ok(Json(loaders::loader_versions(&ctx.core, kind, q.mc.trim()).await?))
}

pub async fn platform_versions(State(ctx): State<Ctx>, a: Authed, Path(kind): Path<String>) -> ApiResult<Json<Vec<PlatformVersion>>> {
    a.require(Perm::ServersRead)?;
    Ok(Json(platform::versions(&ctx.core, platform_kind(&kind)?).await?))
}

pub async fn platform_builds(State(ctx): State<Ctx>, a: Authed, Path(kind): Path<String>, Query(q): Query<McQuery>) -> ApiResult<Json<Vec<PlatformBuild>>> {
    a.require(Perm::ServersRead)?;
    Ok(Json(platform::builds(&ctx.core, platform_kind(&kind)?, q.mc.trim()).await?))
}

#[derive(Deserialize, Default)]
#[serde(default)]
pub struct BuildReq {
    build: Option<String>,
}

pub async fn set_build(State(ctx): State<Ctx>, a: Authed, Path(id): Path<String>, Json(r): Json<BuildReq>) -> ApiResult<Json<Value>> {
    a.server(Perm::ServersManage, &id)?;
    super::servers::ensure_stopped(&ctx, &id)?;
    let task_id = ops::set_platform_build(&ctx.core, &id, r.build.clone()).await?;
    a.audit(&ctx, "server.platform_build", Some(&id), true, r.build);
    Ok(Json(json!({ "task_id": task_id })))
}
