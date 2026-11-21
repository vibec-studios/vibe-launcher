use super::{api_base, refresh_status, save, GatewayFile};
use crate::roles::Role;
use crate::state::Ctx;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::time::Duration;
use vibe_server_core::error::{AppError, AppResult};
use vibe_server_core::util::now_ms;

#[derive(Debug, Clone, Serialize)]
pub struct PairingCode {
    pub code: String,
    pub display: String,
    pub expires_at: i64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct StartRes {
    code: String,
    pair_token: String,
    #[serde(default = "default_expires")]
    expires_in: i64,
    #[serde(default = "default_interval")]
    interval: u64,
}

fn default_expires() -> i64 {
    900
}

fn default_interval() -> u64 {
    5
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PollRes {
    status: String,
    #[serde(default)]
    agent_id: Option<String>,
    #[serde(default)]
    agent_token: Option<String>,
    #[serde(default)]
    owner: Option<Owner>,
}

#[derive(Deserialize)]
struct Owner {
    id: String,
    #[serde(default)]
    name: Option<String>,
}

pub async fn start_pairing(ctx: &Ctx) -> AppResult<PairingCode> {
    if let Some(p) = ctx.gateway.read().pairing.clone().filter(|p| p.expires_at > now_ms() + 60_000) {
        return Ok(p);
    }
    let base = api_base(ctx);
    let cfg = ctx.cfg.read().clone();
    let body = json!({
        "name": cfg.name,
        "hostname": crate::config::hostname(),
        "os": std::env::consts::OS,
        "arch": std::env::consts::ARCH,
        "version": env!("CARGO_PKG_VERSION"),
    });
    let r = ctx.core.net.client.post(format!("{base}/api/v1/agent/pair/start")).json(&body).send().await?;
    if !r.status().is_success() {
        return Err(AppError::Unreachable(format!("Vibe-Gateway: Kopplung nicht möglich (HTTP {})", r.status())));
    }
    let s: StartRes = r.json().await?;
    let code = PairingCode { display: crate::pairing::display(&s.code), code: s.code, expires_at: now_ms() + s.expires_in * 1000 };
    ctx.gateway.write().pairing = Some(code.clone());
    let ret = code.clone();
    let c2 = ctx.clone();
    tokio::spawn(async move {
        if let Err(e) = poll(&c2, &s.pair_token, s.interval.max(2), code.expires_at).await {
            tracing::warn!("Gateway-Kopplung: {e}");
            c2.gateway.write().last_error = Some(e.to_string());
        }
        c2.gateway.write().pairing = None;
    });
    Ok(ret)
}

async fn poll(ctx: &Ctx, pair_token: &str, interval: u64, until: i64) -> AppResult<()> {
    let base = api_base(ctx);
    while now_ms() < until {
        tokio::time::sleep(Duration::from_secs(interval)).await;
        let r = ctx.core.net.client.post(format!("{base}/api/v1/agent/pair/poll")).json(&json!({ "pairToken": pair_token })).send().await;
        let r = match r {
            Ok(r) => r,
            Err(e) => {
                tracing::debug!("Gateway-Poll: {e}");
                continue;
            }
        };
        if r.status().as_u16() == 404 {
            return Err(AppError::Invalid("Kopplungscode abgelaufen.".into()));
        }
        if !r.status().is_success() {
            continue;
        }
        let p: PollRes = r.json().await?;
        if p.status != "claimed" {
            continue;
        }
        let token = p.agent_token.ok_or_else(|| AppError::msg("Gateway: Token fehlt"))?;
        let owner = p.owner.ok_or_else(|| AppError::msg("Gateway: Besitzer fehlt"))?;
        store_link(ctx, token, p.agent_id, owner)?;
        return Ok(());
    }
    Err(AppError::Invalid("Kopplungscode abgelaufen.".into()))
}

fn store_link(ctx: &Ctx, token: String, agent_id: Option<String>, owner: Owner) -> AppResult<()> {
    save(ctx, &GatewayFile { agent_token: Some(token), agent_id, owner_id: Some(owner.id.clone()), owner_name: owner.name.clone() })?;
    if ctx.users.by_vibe_user(&owner.id).is_none() {
        let role = if ctx.users.has_owner() { Role::Admin } else { Role::Owner };
        ctx.users.create(owner.name.as_deref().unwrap_or("Vibe-Konto"), role, vec![], Some(owner.id.clone()))?;
    }
    ctx.audit(None, None, "gateway", "gateway.paired", owner.name.as_deref(), true, None);
    refresh_status(ctx);
    super::kick(ctx);
    Ok(())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct LinkRes {
    agent_id: Option<String>,
    agent_token: String,
    owner: Owner,
    #[serde(default)]
    gateway_url: Option<String>,
}

pub async fn link_with_code(ctx: &Ctx, code: &str) -> AppResult<()> {
    let base = api_base(ctx);
    let cfg = ctx.cfg.read().clone();
    let body = json!({
        "code": code.trim(),
        "name": cfg.name,
        "hostname": crate::config::hostname(),
        "os": std::env::consts::OS,
        "arch": std::env::consts::ARCH,
        "version": env!("CARGO_PKG_VERSION"),
    });
    let r = ctx.core.net.client.post(format!("{base}/api/v1/agent/link")).json(&body).send().await?;
    match r.status().as_u16() {
        200 | 201 => {}
        404 => return Err(AppError::Invalid("Der Vibe-Code ist falsch oder abgelaufen.".into())),
        409 => return Err(AppError::Invalid("Mit diesem Vibe-Konto sind schon zu viele Agents verbunden.".into())),
        429 => return Err(AppError::Invalid("Zu viele Versuche – bitte kurz warten.".into())),
        s => return Err(AppError::Unreachable(format!("Vibe-Gateway: Kopplung nicht möglich (HTTP {s})"))),
    }
    let l: LinkRes = r.json().await?;
    if let Some(u) = l.gateway_url.filter(|u| u.starts_with("wss://") || u.starts_with("ws://")) {
        let default = super::ws_url(ctx);
        if u != default {
            let mut c = ctx.cfg.write();
            c.gateway_url = Some(u);
        }
    }
    {
        ctx.cfg.write().gateway_enabled = true;
    }
    let cfg = ctx.cfg.read().clone();
    crate::config::save(&ctx.dirs.config, &cfg)?;
    store_link(ctx, l.agent_token, l.agent_id, l.owner)
}
