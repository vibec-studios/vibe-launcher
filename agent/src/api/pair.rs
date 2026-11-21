use super::auth::{Authed, Peer};
use super::error::{ApiError, ApiResult};
use crate::pairing::{self, Attempt};
use crate::roles::Role;
use crate::state::Ctx;
use axum::extract::State;
use axum::http::StatusCode;
use axum::{Extension, Json};
use serde::Deserialize;
use serde_json::{json, Value};

#[derive(Deserialize)]
pub struct PairReq {
    #[serde(default)]
    client_name: Option<String>,
    #[serde(default)]
    client_kind: Option<String>,
    #[serde(default)]
    code: Option<String>,
    #[serde(default)]
    nonce: Option<String>,
    #[serde(default)]
    fingerprint: Option<String>,
    #[serde(default)]
    proof: Option<String>,
}

pub async fn pair(State(ctx): State<Ctx>, peer: Option<Extension<Peer>>, Json(r): Json<PairReq>) -> ApiResult<Json<Value>> {
    let ip = peer.and_then(|p| p.0 .0).map(|a| a.ip().to_string());
    let key = format!("pair:{}", ip.clone().unwrap_or_else(|| "local".into()));
    if let Some(s) = ctx.pair_limit.blocked(&key) {
        return Err(ApiError::rate_limited(s));
    }
    let own_fp = ctx.fingerprint.clone().unwrap_or_default();
    let (code, attempt_ok) = match (&r.proof, &r.nonce, &r.code) {
        (Some(proof), Some(nonce), _) => {
            let seen = r.fingerprint.clone().unwrap_or_default().to_ascii_lowercase().replace(':', "");
            if !seen.is_empty() && seen != own_fp {
                (None, false)
            } else {
                let found = ctx.pairing.redeem(Attempt::Proof { fingerprint: &own_fp, nonce, proof });
                let ok = found.is_some();
                (found, ok)
            }
        }
        (_, _, Some(code)) => {
            let found = ctx.pairing.redeem(Attempt::Code(code));
            let ok = found.is_some();
            (found, ok)
        }
        _ => return Err(ApiError::invalid("code oder nonce+proof fehlt.")),
    };
    let Some(code) = code.filter(|_| attempt_ok) else {
        ctx.pair_limit.note(&key);
        ctx.audit(None, ip, "direct", "pair", None, false, None);
        return Err(ApiError::new(StatusCode::UNAUTHORIZED, "pairing_failed", "Der Kopplungscode ist falsch oder abgelaufen."));
    };
    let kind = match r.client_kind.as_deref() {
        Some(k @ ("launcher" | "panel" | "gateway" | "cli")) => k.to_string(),
        _ => "launcher".to_string(),
    };
    let name = r.client_name.clone().filter(|n| !n.trim().is_empty()).unwrap_or_else(|| format!("{kind} {}", ip.clone().unwrap_or_default()));
    let role = if code.role == Role::Owner && ctx.users.has_owner() { Role::Admin } else { code.role };
    let user = ctx.users.create(&name, role, code.servers.clone(), None)?;
    let (token, info) = ctx.users.issue_token(&user.id, &name, &kind)?;
    ctx.audit(Some(&user), ip, "direct", "pair", Some(&info.id), true, Some(kind));
    let cfg = ctx.cfg.read().clone();
    let mut out = json!({
        "token": token,
        "token_id": info.id,
        "user": { "id": user.id, "name": user.name, "role": user.role },
        "agent": { "id": cfg.id, "name": cfg.name, "version": env!("CARGO_PKG_VERSION"), "fingerprint": ctx.fingerprint },
    });
    if let Some(nonce) = &r.nonce {
        if r.proof.is_some() {
            out["server_proof"] = json!(pairing::server_proof(&code.code, &own_fp, nonce, &token));
        }
    }
    Ok(Json(out))
}

#[derive(Deserialize, Default)]
#[serde(default)]
pub struct CodeReq {
    role: Option<Role>,
    servers: Vec<String>,
}

pub async fn new_code(State(ctx): State<Ctx>, a: Authed, body: Option<Json<CodeReq>>) -> ApiResult<Json<Value>> {
    let r = body.map(|b| b.0).unwrap_or_default();
    Ok(Json(super::users::new_code(&ctx, &a, r.role.unwrap_or(Role::Admin), r.servers)?))
}
