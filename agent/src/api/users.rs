use super::auth::Authed;
use super::error::{ApiError, ApiResult};
use crate::pairing;
use crate::roles::{Perm, Role};
use crate::state::Ctx;
use crate::users::{TokenInfo, User, UserPatch};
use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::Json;
use serde::Deserialize;
use serde_json::{json, Value};

pub async fn list(State(ctx): State<Ctx>, a: Authed) -> ApiResult<Json<Vec<User>>> {
    a.require(Perm::AgentAdmin)?;
    Ok(Json(ctx.users.list()))
}

#[derive(Deserialize)]
pub struct InviteReq {
    #[serde(default = "default_role")]
    role: Role,
    #[serde(default)]
    servers: Vec<String>,
}

fn default_role() -> Role {
    Role::Viewer
}

pub fn new_code(ctx: &Ctx, a: &Authed, role: Role, servers: Vec<String>) -> ApiResult<Value> {
    a.require(Perm::AgentAdmin)?;
    let role = if role == Role::Owner { Role::Admin } else { role };
    if a.user.role != Role::Owner && role == Role::Admin && !a.user.can_access("*") {
        return Err(ApiError::forbidden("agent.admin"));
    }
    let c = ctx.pairing.create(role, servers)?;
    a.audit(ctx, "pair.code", None, true, Some(format!("{role:?}")));
    Ok(json!({ "code": pairing::display(&c.code), "expires_at": c.expires_at, "role": c.role }))
}

pub async fn invite(State(ctx): State<Ctx>, a: Authed, Json(r): Json<InviteReq>) -> ApiResult<Json<Value>> {
    Ok(Json(new_code(&ctx, &a, r.role, r.servers)?))
}

pub async fn update(State(ctx): State<Ctx>, a: Authed, Path(id): Path<String>, Json(p): Json<UserPatch>) -> ApiResult<Json<User>> {
    a.require(Perm::AgentAdmin)?;
    let target = ctx.users.get(&id).ok_or_else(|| ApiError::not_found(format!("Benutzer {id}")))?;
    if target.role == Role::Owner && a.user.role != Role::Owner {
        return Err(ApiError::forbidden("owner"));
    }
    let u = ctx.users.update(&id, p)?;
    a.audit(&ctx, "user.update", Some(&id), true, Some(format!("{:?}", u.role)));
    Ok(Json(u))
}

pub async fn remove(State(ctx): State<Ctx>, a: Authed, Path(id): Path<String>) -> ApiResult<StatusCode> {
    a.require(Perm::AgentAdmin)?;
    ctx.users.delete(&id)?;
    a.audit(&ctx, "user.delete", Some(&id), true, None);
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Deserialize, Default)]
#[serde(default)]
pub struct TokensQuery {
    all: Option<String>,
}

pub async fn tokens(State(ctx): State<Ctx>, a: Authed, Query(q): Query<TokensQuery>) -> ApiResult<Json<Vec<TokenInfo>>> {
    let all = q.all.as_deref().is_some_and(|v| v == "1" || v == "true");
    if all {
        a.require(Perm::AgentAdmin)?;
        return Ok(Json(ctx.users.tokens(None)));
    }
    Ok(Json(ctx.users.tokens(Some(&a.user.id))))
}

pub async fn rotate(State(ctx): State<Ctx>, a: Authed) -> ApiResult<Json<Value>> {
    let tid = a.token_id.clone().ok_or_else(|| ApiError::invalid("Über das Gateway gibt es kein Agent-Token zum Rotieren."))?;
    let (token, info) = ctx.users.rotate(&tid)?;
    a.audit(&ctx, "token.rotate", Some(&info.id), true, None);
    Ok(Json(json!({ "token": token, "token_id": info.id })))
}

pub async fn revoke(State(ctx): State<Ctx>, a: Authed, Path(id): Path<String>) -> ApiResult<StatusCode> {
    let owner = ctx.users.token_owner(&id).ok_or_else(|| ApiError::not_found(format!("Token {id}")))?;
    if owner != a.user.id {
        a.require(Perm::AgentAdmin)?;
    }
    ctx.users.revoke(&id)?;
    a.audit(&ctx, "token.revoke", Some(&id), true, None);
    Ok(StatusCode::NO_CONTENT)
}
