use super::auth::{self, Authed, ViaGateway};
use super::error::error_json;
use crate::roles::Perm;
use crate::state::{AgentState, Ctx};
use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{FromRequestParts, State};
use axum::http::request::Parts;
use axum::response::Response;
use futures::{SinkExt, StreamExt};
use serde_json::{json, Value};
use std::collections::HashSet;
use std::time::Duration;
use tokio::sync::mpsc;

pub struct WsParts {
    pub authed: Option<Authed>,
    pub peer: Option<String>,
}

impl FromRequestParts<Ctx> for WsParts {
    type Rejection = super::error::ApiError;

    async fn from_request_parts(parts: &mut Parts, st: &Ctx) -> Result<Self, Self::Rejection> {
        let peer = auth::peer_ip(parts);
        if let Some(g) = parts.extensions.get::<ViaGateway>() {
            return Ok(WsParts { authed: Some(auth::gateway_user(st, g)?), peer });
        }
        let token = auth::bearer(parts).or_else(|| auth::query_token(parts));
        let authed = match token {
            Some(t) => Some(auth::authenticate(st, &t, peer.clone())?),
            None => None,
        };
        Ok(WsParts { authed, peer })
    }
}

pub async fn upgrade(State(ctx): State<Ctx>, p: WsParts, ws: WebSocketUpgrade) -> Response {
    ws.on_upgrade(move |socket| bridge(ctx, p, socket))
}

async fn bridge(ctx: Ctx, p: WsParts, socket: WebSocket) {
    let (mut sink, mut stream) = socket.split();
    let (in_tx, in_rx) = mpsc::channel::<String>(64);
    let (out_tx, mut out_rx) = mpsc::channel::<String>(256);
    let writer = tokio::spawn(async move {
        let mut ping = tokio::time::interval(Duration::from_secs(30));
        ping.tick().await;
        loop {
            tokio::select! {
                m = out_rx.recv() => match m {
                    Some(text) => if sink.send(Message::Text(text.into())).await.is_err() { break },
                    None => break,
                },
                _ = ping.tick() => if sink.send(Message::Ping(Vec::new().into())).await.is_err() { break },
            }
        }
        let _ = sink.close().await;
    });
    let reader = tokio::spawn(async move {
        loop {
            match tokio::time::timeout(Duration::from_secs(90), stream.next()).await {
                Ok(Some(Ok(Message::Text(t)))) => {
                    if in_tx.send(t.to_string()).await.is_err() {
                        break;
                    }
                }
                Ok(Some(Ok(Message::Close(_)))) | Ok(None) | Ok(Some(Err(_))) | Err(_) => break,
                Ok(Some(Ok(_))) => {}
            }
        }
    });
    session(ctx, p.authed, p.peer, in_rx, out_tx).await;
    reader.abort();
    let _ = writer.await;
}

fn send(out: &mpsc::Sender<String>, v: Value) -> bool {
    out.try_send(v.to_string()).is_ok() || !out.is_closed()
}

fn event_allowed(a: &Authed, topics: &HashSet<String>, event: &str, data: &Value) -> bool {
    let server_of = |d: &Value| d["server_id"].as_str().or_else(|| d["id"].as_str()).map(str::to_string);
    match event {
        "server://log" => server_of(data).is_some_and(|id| topics.contains(&format!("log:{id}")) && a.user.can_access(&id)),
        "server://status" | "servers://changed" | "servers://removed" => topics.contains("servers") && server_of(data).is_none_or_access(a),
        "task://update" => topics.contains("tasks") && data["instance_id"].as_str().and_then(|i| i.strip_prefix("server:")).map_or(true, |id| a.user.can_access(id)),
        _ => false,
    }
}

trait AccessExt {
    fn is_none_or_access(&self, a: &Authed) -> bool;
}

impl AccessExt for Option<String> {
    fn is_none_or_access(&self, a: &Authed) -> bool {
        self.as_deref().map_or(true, |id| a.user.can_access(id))
    }
}

async fn wait_auth(ctx: &AgentState, peer: Option<String>, rx: &mut mpsc::Receiver<String>) -> Option<Authed> {
    let msg = tokio::time::timeout(Duration::from_secs(10), rx.recv()).await.ok()??;
    let v: Value = serde_json::from_str(&msg).ok()?;
    if v["t"] != "auth" {
        return None;
    }
    auth::authenticate(ctx, v["token"].as_str()?, peer).ok()
}

pub async fn session(ctx: Ctx, authed: Option<Authed>, peer: Option<String>, mut rx: mpsc::Receiver<String>, out: mpsc::Sender<String>) {
    let a = match authed {
        Some(a) => a,
        None => match wait_auth(&ctx, peer, &mut rx).await {
            Some(a) => a,
            None => {
                let _ = out.send(json!({ "t": "error", "error": { "code": "unauthorized", "message": "Nicht angemeldet oder Token ungültig.", "kind": "access" } }).to_string()).await;
                return;
            }
        },
    };
    if a.require(Perm::ServersRead).is_err() {
        return;
    }
    let hello = json!({ "t": "hello", "agent": super::agent::info_json(&ctx), "user": a.user, "api_version": super::API_VERSION });
    if out.send(hello.to_string()).await.is_err() {
        return;
    }
    let mut events = ctx.events.subscribe();
    let mut topics: HashSet<String> = HashSet::new();
    let mut res_tick = tokio::time::interval(Duration::from_secs(5));
    let limiter = crate::ratelimit::RateLimiter::new(20, Duration::from_secs(1));
    loop {
        tokio::select! {
            m = rx.recv() => {
                let Some(m) = m else { break };
                let Ok(v) = serde_json::from_str::<Value>(&m) else { continue };
                if !handle(&ctx, &a, &mut topics, &limiter, &v, &out).await {
                    break;
                }
            }
            e = events.recv() => match e {
                Ok((event, data)) => {
                    if event_allowed(&a, &topics, &event, &data) && !send(&out, json!({ "t": "event", "event": event, "data": data })) {
                        break;
                    }
                }
                Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => {}
                Err(_) => break,
            },
            _ = res_tick.tick(), if topics.contains("resources") => {
                let mut r = super::agent::resources_of(&ctx).await;
                r.servers.retain(|s| a.user.can_access(&s.id));
                if !send(&out, json!({ "t": "event", "event": "agent://resources", "data": r })) {
                    break;
                }
            }
        }
        if out.is_closed() {
            break;
        }
    }
}

async fn handle(ctx: &Ctx, a: &Authed, topics: &mut HashSet<String>, limiter: &crate::ratelimit::RateLimiter, v: &Value, out: &mpsc::Sender<String>) -> bool {
    match v["t"].as_str().unwrap_or_default() {
        "ping" => send(out, json!({ "t": "pong" })),
        "auth" => true,
        "subscribe" => {
            for t in v["topics"].as_array().into_iter().flatten().filter_map(|t| t.as_str()) {
                if let Some(id) = t.strip_prefix("log:") {
                    if !a.user.can_access(id) || ctx.core.servers.get(id).is_err() {
                        continue;
                    }
                    let lines = ctx.core.server_mgr.log(id);
                    let tail: Vec<_> = lines.iter().skip(lines.len().saturating_sub(200)).cloned().collect();
                    send(out, json!({ "t": "event", "event": "server://log", "data": { "server_id": id, "lines": tail } }));
                }
                if ["servers", "tasks", "resources"].contains(&t) || t.starts_with("log:") {
                    topics.insert(t.to_string());
                }
            }
            true
        }
        "unsubscribe" => {
            for t in v["topics"].as_array().into_iter().flatten().filter_map(|t| t.as_str()) {
                topics.remove(t);
            }
            true
        }
        "command" => {
            let id = v["id"].clone();
            let r = if limiter.check(&a.user.id).is_err() {
                Err(super::error::ApiError::rate_limited(1))
            } else {
                super::servers::run_command(ctx, a, v["server_id"].as_str().unwrap_or_default(), v["command"].as_str().unwrap_or_default())
            };
            match r {
                Ok(()) => send(out, json!({ "t": "reply", "id": id, "ok": true, "data": null })),
                Err(e) => send(out, json!({ "t": "reply", "id": id, "ok": false, "error": error_json(&e) })),
            }
        }
        _ => true,
    }
}
