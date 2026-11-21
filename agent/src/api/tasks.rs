use super::auth::Authed;
use super::error::{ApiError, ApiResult};
use crate::roles::Perm;
use crate::state::Ctx;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::Json;
use vibe_server_core::tasks::TaskInfo;

fn visible(a: &Authed, t: &TaskInfo) -> bool {
    match t.instance_id.as_deref().and_then(|i| i.strip_prefix("server:")) {
        Some(id) => a.user.can_access(id),
        None => true,
    }
}

pub async fn list(State(ctx): State<Ctx>, a: Authed) -> ApiResult<Json<Vec<TaskInfo>>> {
    a.require(Perm::ServersRead)?;
    Ok(Json(ctx.core.tasks.list().into_iter().filter(|t| visible(&a, t)).collect()))
}

pub async fn get_one(State(ctx): State<Ctx>, a: Authed, Path(id): Path<String>) -> ApiResult<Json<TaskInfo>> {
    a.require(Perm::ServersRead)?;
    ctx.core.tasks.list().into_iter().find(|t| t.id == id && visible(&a, t)).map(Json).ok_or_else(|| ApiError::not_found(format!("Aufgabe {id}")))
}

pub async fn cancel(State(ctx): State<Ctx>, a: Authed, Path(id): Path<String>) -> ApiResult<StatusCode> {
    a.require(Perm::ServersManage)?;
    let t = ctx.core.tasks.list().into_iter().find(|t| t.id == id && visible(&a, t)).ok_or_else(|| ApiError::not_found(format!("Aufgabe {id}")))?;
    ctx.core.tasks.cancel(&t.id);
    a.audit(&ctx, "task.cancel", t.instance_id.as_deref(), true, Some(t.title));
    Ok(StatusCode::NO_CONTENT)
}
