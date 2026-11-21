use super::dispatch::{self, frame, Acks, GwUser, ReqFrame};
use super::{load, refresh_status, save, ws_url, GatewayFile, PROTOCOL};
use crate::state::Ctx;
use axum::body::Body;
use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine;
use futures::{SinkExt, StreamExt};
use parking_lot::Mutex;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;
use tokio::io::AsyncWriteExt;
use tokio::sync::mpsc;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::protocol::frame::coding::CloseCode;
use tokio_tungstenite::tungstenite::Message;

const WS_MSG_MAX: usize = 48 * 1024;

enum End {
    Retry,
    DropToken,
    Wait(Duration),
}

struct Upload {
    path: PathBuf,
    file: tokio::fs::File,
    received: u64,
    frame: ReqFrame,
}

struct Conn {
    ctx: Ctx,
    router: axum::Router,
    out: mpsc::Sender<String>,
    acks: Arc<Acks>,
    reqs: Mutex<HashMap<String, tokio::task::AbortHandle>>,
    sockets: Mutex<HashMap<String, mpsc::Sender<String>>>,
    uploads: tokio::sync::Mutex<HashMap<String, Upload>>,
}

pub async fn run(ctx: Ctx, router: axum::Router) {
    let mut backoff = 1u64;
    loop {
        let enabled = ctx.cfg.read().gateway_enabled;
        let token = load(&ctx).agent_token;
        let Some(token) = token.filter(|_| enabled) else {
            ctx.gateway.write().connected = false;
            tokio::select! {
                _ = ctx.gw_notify.notified() => {}
                _ = tokio::time::sleep(Duration::from_secs(30)) => {}
            }
            continue;
        };
        let end = connect(&ctx, &router, &token).await;
        ctx.gateway.write().connected = false;
        let wait = match end {
            Ok(End::DropToken) => {
                let _ = save(&ctx, &GatewayFile::default());
                refresh_status(&ctx);
                backoff = 1;
                continue;
            }
            Ok(End::Wait(d)) => d,
            Ok(End::Retry) => {
                backoff = 1;
                Duration::from_millis(1000 + (crate::crypto::random_bytes::<1>()[0] as u64) * 16)
            }
            Err(e) => {
                tracing::debug!("Gateway: {e}");
                ctx.gateway.write().last_error = Some(e);
                backoff = (backoff * 2).min(60);
                Duration::from_millis(backoff * 1000 + (crate::crypto::random_bytes::<1>()[0] as u64) * 4)
            }
        };
        tokio::select! {
            _ = tokio::time::sleep(wait) => {}
            _ = ctx.gw_notify.notified() => {}
        }
    }
}

fn hello(ctx: &Ctx) -> String {
    let cfg = ctx.cfg.read().clone();
    frame("hello", json!({ "protocol": PROTOCOL, "version": env!("CARGO_PKG_VERSION"), "os": std::env::consts::OS, "arch": std::env::consts::ARCH, "hostname": crate::config::hostname(), "name": cfg.name }))
}

async fn status_frame(ctx: &Ctx) -> String {
    let servers = ctx.core.servers.list();
    let statuses = ctx.core.server_mgr.statuses();
    let running = statuses.iter().filter(|s| s.pid.is_some()).count();
    let players: usize = statuses.iter().map(|s| s.players.len()).sum();
    let r = crate::api::agent::resources_of(ctx).await;
    frame("status", json!({ "servers": servers.len(), "running": running, "players": players, "cpuPercent": r.cpu_percent, "memUsed": r.mem_used, "memTotal": r.mem_total }))
}

async fn connect(ctx: &Ctx, router: &axum::Router, token: &str) -> Result<End, String> {
    let mut req = ws_url(ctx).into_client_request().map_err(|e| e.to_string())?;
    req.headers_mut().insert("authorization", format!("Bearer {token}").parse().map_err(|_| "Token ungültig".to_string())?);
    req.headers_mut().insert("user-agent", vibe_server_core::product::user_agent().parse().map_err(|_| "UA".to_string())?);
    let (ws, _) = tokio::time::timeout(Duration::from_secs(15), tokio_tungstenite::connect_async(req)).await.map_err(|_| "Zeitüberschreitung".to_string())?.map_err(|e| e.to_string())?;
    let (mut sink, mut stream) = ws.split();
    sink.send(Message::Text(hello(ctx).into())).await.map_err(|e| e.to_string())?;
    let (out_tx, mut out_rx) = mpsc::channel::<String>(512);
    let conn = Arc::new(Conn {
        ctx: ctx.clone(),
        router: router.clone(),
        out: out_tx,
        acks: Arc::new(Acks::default()),
        reqs: Mutex::new(HashMap::new()),
        sockets: Mutex::new(HashMap::new()),
        uploads: tokio::sync::Mutex::new(HashMap::new()),
    });
    let mut ping = tokio::time::interval(Duration::from_secs(30));
    ping.tick().await;
    let mut status = tokio::time::interval(Duration::from_secs(30));
    let result = loop {
        tokio::select! {
            m = out_rx.recv() => {
                let Some(m) = m else { break Ok(End::Retry) };
                if sink.send(Message::Text(m.into())).await.is_err() {
                    break Err("Senden fehlgeschlagen".to_string());
                }
            }
            _ = ping.tick() => {
                if sink.send(Message::Text(frame("ping", json!({})).into())).await.is_err() {
                    break Err("Ping fehlgeschlagen".to_string());
                }
            }
            _ = status.tick() => {
                let f = status_frame(ctx).await;
                if sink.send(Message::Text(f.into())).await.is_err() {
                    break Err("Status fehlgeschlagen".to_string());
                }
            }
            m = tokio::time::timeout(Duration::from_secs(75), stream.next()) => match m {
                Err(_) => break Err("Gateway antwortet nicht".to_string()),
                Ok(None) => break Ok(End::Retry),
                Ok(Some(Err(e))) => break Err(e.to_string()),
                Ok(Some(Ok(Message::Close(c)))) => break Ok(close_action(c.map(|c| c.code))),
                Ok(Some(Ok(Message::Text(t)))) => {
                    if let Some(end) = on_frame(&conn, &t).await {
                        break Ok(end);
                    }
                }
                Ok(Some(Ok(_))) => {}
            },
        }
    };
    ctx.host.gateway.detach();
    for (_, h) in conn.reqs.lock().drain() {
        h.abort();
    }
    conn.sockets.lock().clear();
    for (_, u) in conn.uploads.lock().await.drain() {
        let _ = tokio::fs::remove_file(&u.path).await;
    }
    result
}

fn close_action(code: Option<CloseCode>) -> End {
    match code.map(u16::from) {
        Some(4001) | Some(4401) => End::DropToken,
        Some(4403) => End::Wait(Duration::from_secs(600)),
        Some(4029) => End::Wait(Duration::from_secs(60)),
        Some(4000) => End::Wait(Duration::from_secs(30)),
        _ => End::Retry,
    }
}

async fn on_frame(conn: &Arc<Conn>, text: &str) -> Option<End> {
    let v: Value = serde_json::from_str(text).ok()?;
    let d = &v["d"];
    match v["op"].as_str().unwrap_or_default() {
        "welcome" => {
            conn.ctx.host.gateway.attach(conn.out.clone());
            let mut g = conn.ctx.gateway.write();
            g.connected = true;
            g.last_error = None;
            if let Some(id) = d["agentId"].as_str() {
                g.agent_id = Some(id.to_string());
            }
        }
        "req" => {
            if let Ok(f) = serde_json::from_value::<ReqFrame>(d.clone()) {
                let body = f.body.as_deref().and_then(|b| B64.decode(b).ok()).unwrap_or_default();
                spawn_req(conn, f, Body::from(body));
            }
        }
        "relay.ticket" => conn.ctx.host.gateway.resolve(d),
        "res.ack" => conn.acks.ack(d["id"].as_str().unwrap_or_default(), d["seq"].as_u64().unwrap_or(0)),
        "cancel" => {
            if let Some(h) = conn.reqs.lock().remove(d["id"].as_str().unwrap_or_default()) {
                h.abort();
            }
        }
        "ws.open" => ws_open(conn, d),
        "ws.send" => {
            let sid = d["sid"].as_str().unwrap_or_default();
            let tx = conn.sockets.lock().get(sid).cloned();
            if let (Some(tx), Some(data)) = (tx, d["data"].as_str()) {
                let _ = tx.try_send(data.to_string());
            }
        }
        "ws.close" => {
            conn.sockets.lock().remove(d["sid"].as_str().unwrap_or_default());
        }
        "upload.begin" => upload_begin(conn, d).await,
        "upload.chunk" => upload_chunk(conn, d).await,
        "upload.end" => upload_end(conn, d).await,
        "upload.abort" => {
            if let Some(u) = conn.uploads.lock().await.remove(d["uid"].as_str().unwrap_or_default()) {
                let _ = tokio::fs::remove_file(&u.path).await;
            }
        }
        "token.rotate" => {
            if let Some(t) = d["token"].as_str() {
                let mut f = load(&conn.ctx);
                f.agent_token = Some(t.to_string());
                if save(&conn.ctx, &f).is_ok() {
                    let _ = conn.out.send(frame("token.rotated", json!({}))).await;
                }
            }
        }
        "unpaired" => {
            conn.ctx.audit(None, None, "gateway", "gateway.unpaired", None, true, d["reason"].as_str().map(str::to_string));
            return Some(End::DropToken);
        }
        "error" => {
            conn.ctx.gateway.write().last_error = d["message"].as_str().map(str::to_string);
        }
        _ => {}
    }
    None
}

fn spawn_req(conn: &Arc<Conn>, f: ReqFrame, body: Body) {
    let id = f.id.clone();
    let c = conn.clone();
    let task = tokio::spawn(async move {
        let id = f.id.clone();
        dispatch::handle(c.router.clone(), f, body, c.out.clone(), c.acks.clone()).await;
        c.reqs.lock().remove(&id);
    });
    conn.reqs.lock().insert(id, task.abort_handle());
}

fn ws_open(conn: &Arc<Conn>, d: &Value) {
    let sid = d["sid"].as_str().unwrap_or_default().to_string();
    let user: Option<GwUser> = serde_json::from_value(d["user"].clone()).ok();
    let path = d["path"].as_str().unwrap_or_default();
    let authed = user.and_then(|u| crate::api::auth::gateway_user(&conn.ctx, &u.via()).ok());
    let (Some(authed), true) = (authed, path == "/api/v1/ws") else {
        let _ = conn.out.try_send(frame("ws.closed", json!({ "sid": sid, "code": 4404, "reason": "Nicht verfügbar" })));
        return;
    };
    let (in_tx, in_rx) = mpsc::channel::<String>(64);
    let (o_tx, mut o_rx) = mpsc::channel::<String>(256);
    conn.sockets.lock().insert(sid.clone(), in_tx);
    let _ = conn.out.try_send(frame("ws.opened", json!({ "sid": sid })));
    let c = conn.clone();
    let ctx = conn.ctx.clone();
    let s2 = sid.clone();
    tokio::spawn(async move { crate::api::ws::session(ctx, Some(authed), None, in_rx, o_tx).await });
    tokio::spawn(async move {
        while let Some(m) = o_rx.recv().await {
            for part in dispatch::split_ws_message(&m, WS_MSG_MAX) {
                if c.out.send(frame("ws.message", json!({ "sid": s2, "data": part }))).await.is_err() {
                    return;
                }
            }
            if !c.sockets.lock().contains_key(&s2) {
                return;
            }
        }
        c.sockets.lock().remove(&s2);
        let _ = c.out.send(frame("ws.closed", json!({ "sid": s2, "code": 1000, "reason": "" }))).await;
    });
}

async fn upload_begin(conn: &Arc<Conn>, d: &Value) {
    let uid = d["uid"].as_str().unwrap_or_default().to_string();
    let mut fr = d.clone();
    fr["id"] = json!(uid);
    let Ok(frame_req) = serde_json::from_value::<ReqFrame>(fr) else {
        let _ = conn.out.send(frame("upload.error", json!({ "uid": uid, "message": "Ungültiger Upload" }))).await;
        return;
    };
    let path = conn.ctx.core.paths.tmp().join(format!("gw-upload-{}.part", uuid::Uuid::new_v4().simple()));
    let _ = tokio::fs::create_dir_all(conn.ctx.core.paths.tmp()).await;
    match tokio::fs::File::create(&path).await {
        Ok(file) => {
            conn.uploads.lock().await.insert(uid.clone(), Upload { path, file, received: 0, frame: frame_req });
            let _ = conn.out.send(frame("upload.ack", json!({ "uid": uid, "received": 0 }))).await;
        }
        Err(e) => {
            let _ = conn.out.send(frame("upload.error", json!({ "uid": uid, "message": e.to_string() }))).await;
        }
    }
}

async fn upload_chunk(conn: &Arc<Conn>, d: &Value) {
    let uid = d["uid"].as_str().unwrap_or_default().to_string();
    let data = d["data"].as_str().and_then(|b| B64.decode(b).ok()).unwrap_or_default();
    let mut ups = conn.uploads.lock().await;
    let Some(u) = ups.get_mut(&uid) else { return };
    if d["offset"].as_u64() != Some(u.received) {
        let _ = conn.out.send(frame("upload.ack", json!({ "uid": uid, "received": u.received }))).await;
        return;
    }
    if let Err(e) = u.file.write_all(&data).await {
        let _ = conn.out.send(frame("upload.error", json!({ "uid": uid, "message": e.to_string() }))).await;
        return;
    }
    u.received += data.len() as u64;
    let _ = conn.out.send(frame("upload.ack", json!({ "uid": uid, "received": u.received }))).await;
}

async fn upload_end(conn: &Arc<Conn>, d: &Value) {
    let uid = d["uid"].as_str().unwrap_or_default();
    let Some(mut u) = conn.uploads.lock().await.remove(uid) else { return };
    let _ = u.file.flush().await;
    drop(u.file);
    let Ok(file) = tokio::fs::File::open(&u.path).await else { return };
    u.frame.id = d["id"].as_str().unwrap_or(uid).to_string();
    let path = u.path.clone();
    let body = Body::from_stream(tokio_util::io::ReaderStream::new(file));
    let c = conn.clone();
    let f = u.frame;
    tokio::spawn(async move {
        dispatch::handle(c.router.clone(), f, body, c.out.clone(), c.acks.clone()).await;
        let _ = tokio::fs::remove_file(path).await;
    });
}
