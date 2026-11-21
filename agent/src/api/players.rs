use super::auth::Authed;
use super::error::{ApiError, ApiResult};
use crate::roles::Perm;
use crate::state::Ctx;
use axum::extract::{Path, State};
use axum::Json;
use serde::Deserialize;
use vibe_server_core::server::players::{self, ListKind, ServerPlayers};

pub async fn get_players(State(ctx): State<Ctx>, a: Authed, Path(id): Path<String>) -> ApiResult<Json<ServerPlayers>> {
    a.server(Perm::ServersRead, &id)?;
    ctx.core.servers.get(&id)?;
    Ok(Json(players::read_all(&ctx.core, &id)))
}

#[derive(Deserialize)]
pub struct ActionReq {
    action: String,
    name: String,
    #[serde(default)]
    reason: Option<String>,
}

fn parse_list(s: &str) -> ApiResult<ListKind> {
    serde_json::from_value(serde_json::Value::String(s.to_string())).map_err(|_| ApiError::invalid(format!("Unbekannte Liste: {s}")))
}

pub async fn action(State(ctx): State<Ctx>, a: Authed, Path((id, list)): Path<(String, String)>, Json(req): Json<ActionReq>) -> ApiResult<Json<ServerPlayers>> {
    a.server(Perm::ServersManage, &id)?;
    ctx.core.servers.get(&id)?;
    let kind = parse_list(&list)?;
    let add = match req.action.as_str() {
        "add" => true,
        "remove" => false,
        _ => return Err(ApiError::invalid("action muss add oder remove sein.")),
    };
    let name = req.name.trim();
    if name.is_empty() || name.len() > 64 {
        return Err(ApiError::invalid("Ungültiger Name."));
    }
    let out = players::action(&ctx.core, &id, kind, add, name, req.reason).await?;
    a.audit(&ctx, &format!("players.{list}.{}", req.action), Some(&id), true, Some(name.to_string()));
    Ok(Json(out))
}

#[derive(Deserialize)]
pub struct WhitelistReq {
    enabled: bool,
}

pub async fn whitelist(State(ctx): State<Ctx>, a: Authed, Path(id): Path<String>, Json(req): Json<WhitelistReq>) -> ApiResult<Json<ServerPlayers>> {
    a.server(Perm::ServersManage, &id)?;
    ctx.core.servers.get(&id)?;
    let out = players::set_whitelist(&ctx.core, &id, req.enabled).await?;
    a.audit(&ctx, "players.whitelist", Some(&id), true, Some(req.enabled.to_string()));
    Ok(Json(out))
}

#[derive(Deserialize)]
pub struct KickReq {
    name: String,
    #[serde(default)]
    reason: Option<String>,
}

pub fn valid_player_name(n: &str) -> bool {
    (1..=16).contains(&n.len()) && n.chars().all(|c| c.is_ascii_alphanumeric() || c == '_')
}

pub async fn kick(State(ctx): State<Ctx>, a: Authed, Path(id): Path<String>, Json(r): Json<KickReq>) -> ApiResult<axum::http::StatusCode> {
    a.server(Perm::ServersControl, &id)?;
    ctx.core.servers.get(&id)?;
    let name = r.name.trim();
    if !valid_player_name(name) {
        return Err(ApiError::invalid("Ungültiger Spielername."));
    }
    let reason: String = r.reason.unwrap_or_default().chars().filter(|c| !c.is_control()).take(200).collect();
    let cmd = if reason.trim().is_empty() { format!("kick {name}") } else { format!("kick {name} {}", reason.trim()) };
    super::servers::run_command(&ctx, &a, &id, &cmd)?;
    a.audit(&ctx, "players.kick", Some(&id), true, Some(name.to_string()));
    Ok(axum::http::StatusCode::NO_CONTENT)
}

#[cfg(test)]
mod tests {
    #[test]
    fn player_names() {
        assert!(super::valid_player_name("Steve_42"));
        assert!(!super::valid_player_name("a b"));
        assert!(!super::valid_player_name("x;op me"));
        assert!(!super::valid_player_name(""));
        assert!(!super::valid_player_name("abcdefghijklmnopq"));
    }
}
