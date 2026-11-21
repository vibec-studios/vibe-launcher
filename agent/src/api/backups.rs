use super::auth::Authed;
use super::error::{ApiError, ApiResult};
use crate::roles::Perm;
use crate::state::Ctx;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::Json;
use serde::Deserialize;
use serde_json::{json, Value};
use vibe_server_core::server::backup::{self, ServerBackup, ServerWorld};
use vibe_server_core::server::ops;

pub async fn worlds(State(ctx): State<Ctx>, a: Authed, Path(id): Path<String>) -> ApiResult<Json<Vec<ServerWorld>>> {
    a.server(Perm::ServersRead, &id)?;
    ctx.core.servers.get(&id)?;
    let core = ctx.core.clone();
    Ok(Json(tokio::task::spawn_blocking(move || backup::worlds(&core, &id)).await.map_err(vibe_server_core::error::AppError::from)?))
}

pub async fn list(State(ctx): State<Ctx>, a: Authed, Path(id): Path<String>) -> ApiResult<Json<Vec<ServerBackup>>> {
    a.server(Perm::ServersRead, &id)?;
    ctx.core.servers.get(&id)?;
    Ok(Json(backup::list(&ctx.core, &id)))
}

#[derive(Deserialize, Default)]
#[serde(default)]
pub struct CreateReq {
    world: Option<String>,
}

pub async fn create(State(ctx): State<Ctx>, a: Authed, Path(id): Path<String>, body: Option<Json<CreateReq>>) -> ApiResult<Json<Value>> {
    a.server(Perm::ServersManage, &id)?;
    let world = body.and_then(|b| b.0.world);
    let task_id = ops::backup_create(&ctx.core, &id, world)?;
    a.audit(&ctx, "backup.create", Some(&id), true, None);
    Ok(Json(json!({ "task_id": task_id })))
}

pub async fn remove(State(ctx): State<Ctx>, a: Authed, Path((id, name)): Path<(String, String)>) -> ApiResult<StatusCode> {
    a.server(Perm::ServersManage, &id)?;
    ctx.core.servers.get(&id)?;
    backup::delete(&ctx.core, &id, &name)?;
    a.audit(&ctx, "backup.delete", Some(&id), true, Some(name));
    Ok(StatusCode::NO_CONTENT)
}

pub async fn restore(State(ctx): State<Ctx>, a: Authed, Path((id, name)): Path<(String, String)>) -> ApiResult<Json<Value>> {
    a.server(Perm::ServersManage, &id)?;
    ctx.core.servers.get(&id)?;
    super::servers::ensure_stopped(&ctx, &id)?;
    let task_id = ops::backup_restore(&ctx.core, &id, &name)?;
    a.audit(&ctx, "backup.restore", Some(&id), true, Some(name));
    Ok(Json(json!({ "task_id": task_id })))
}

pub async fn download(State(ctx): State<Ctx>, a: Authed, Path((id, name)): Path<(String, String)>) -> ApiResult<axum::response::Response> {
    a.server(Perm::FilesRead, &id)?;
    ctx.core.servers.get(&id)?;
    let dir = backup::backups_dir(&ctx.core, &id);
    let path = vibe_server_core::util::safe_join(&dir, &name).filter(|p| p.is_file()).ok_or_else(|| ApiError::not_found(name.clone()))?;
    super::body::file_response(&path, &name).await
}
