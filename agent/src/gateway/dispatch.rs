use crate::api::auth::ViaGateway;
use crate::roles::Role;
use axum::body::Body;
use axum::http::{Method, Request};
use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine;
use futures::StreamExt;
use parking_lot::Mutex;
use serde::Deserialize;
use serde_json::{json, Map, Value};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::mpsc;
use tower::ServiceExt;

pub const INLINE_MAX: usize = 32 * 1024;
pub const CHUNK: usize = 32 * 1024;
pub const MAX_INFLIGHT: u64 = 32;

const REQ_HEADERS: &[&str] = &["content-type", "accept", "accept-language", "range", "if-none-match", "if-modified-since"];
const RES_HEADERS: &[&str] = &["content-type", "content-disposition", "content-length", "cache-control", "etag", "last-modified", "content-range", "accept-ranges", "retry-after"];

#[derive(Debug, Clone, Deserialize)]
pub struct GwUser {
    pub id: String,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub role: Option<String>,
}

impl GwUser {
    pub fn via(&self) -> ViaGateway {
        let role = match self.role.as_deref() {
            Some("owner") => Role::Owner,
            Some("admin") => Role::Admin,
            _ => Role::Viewer,
        };
        ViaGateway { vibe_user_id: self.id.clone(), name: self.name.clone().unwrap_or_else(|| "Vibe-Nutzer".into()), role }
    }
}

#[derive(Debug, Clone, Deserialize)]
pub struct ReqFrame {
    pub id: String,
    pub method: String,
    pub path: String,
    #[serde(default)]
    pub query: Option<String>,
    #[serde(default)]
    pub headers: HashMap<String, String>,
    #[serde(default)]
    pub body: Option<String>,
    pub user: GwUser,
}

#[derive(Default)]
pub struct Acks {
    map: Mutex<HashMap<String, mpsc::UnboundedSender<u64>>>,
}

impl Acks {
    pub fn register(&self, id: &str) -> mpsc::UnboundedReceiver<u64> {
        let (tx, rx) = mpsc::unbounded_channel();
        self.map.lock().insert(id.to_string(), tx);
        rx
    }
    pub fn ack(&self, id: &str, seq: u64) {
        if let Some(tx) = self.map.lock().get(id) {
            let _ = tx.send(seq);
        }
    }
    pub fn done(&self, id: &str) {
        self.map.lock().remove(id);
    }
}

pub fn frame(op: &str, d: Value) -> String {
    json!({ "op": op, "d": d }).to_string()
}

pub fn build_request(f: &ReqFrame, body: Body) -> Option<Request<Body>> {
    if !f.path.starts_with("/api/v1/") || f.path.contains("..") {
        return None;
    }
    let method = Method::from_bytes(f.method.to_ascii_uppercase().as_bytes()).ok()?;
    let uri = match f.query.as_deref().filter(|q| !q.is_empty()) {
        Some(q) => format!("{}?{q}", f.path),
        None => f.path.clone(),
    };
    let mut b = Request::builder().method(method).uri(uri);
    for (k, v) in &f.headers {
        let k = k.to_ascii_lowercase();
        if REQ_HEADERS.contains(&k.as_str()) {
            b = b.header(k, v);
        }
    }
    let mut req = b.body(body).ok()?;
    req.extensions_mut().insert(f.user.via());
    Some(req)
}

fn error_res(id: &str, status: u16, code: &str, message: &str) -> String {
    let body = json!({ "error": { "code": code, "message": message, "kind": "invalid" } }).to_string();
    frame("res", json!({ "id": id, "status": status, "headers": { "content-type": "application/json" }, "body": B64.encode(body) }))
}

pub async fn handle(router: axum::Router, f: ReqFrame, body: Body, out: mpsc::Sender<String>, acks: Arc<Acks>) {
    let id = f.id.clone();
    let Some(req) = build_request(&f, body) else {
        let _ = out.send(error_res(&id, 404, "not_found", "Unbekannter Pfad.")).await;
        return;
    };
    let res = match router.oneshot(req).await {
        Ok(r) => r,
        Err(e) => match e {},
    };
    let status = res.status().as_u16();
    let mut headers = Map::new();
    for (k, v) in res.headers() {
        if RES_HEADERS.contains(&k.as_str()) {
            if let Ok(v) = v.to_str() {
                headers.insert(k.as_str().to_string(), Value::String(v.to_string()));
            }
        }
    }
    let known_small = res.headers().get("content-length").and_then(|v| v.to_str().ok()).and_then(|v| v.parse::<usize>().ok()).is_some_and(|n| n <= INLINE_MAX);
    let mut stream = res.into_body().into_data_stream();
    if known_small {
        let mut buf = Vec::new();
        while let Some(Ok(c)) = stream.next().await {
            buf.extend_from_slice(&c);
        }
        let _ = out.send(frame("res", json!({ "id": id, "status": status, "headers": headers, "body": B64.encode(&buf) }))).await;
        return;
    }
    let mut first: Vec<u8> = Vec::new();
    let mut ended = false;
    while first.len() <= INLINE_MAX {
        match stream.next().await {
            Some(Ok(c)) => first.extend_from_slice(&c),
            Some(Err(_)) | None => {
                ended = true;
                break;
            }
        }
    }
    if ended {
        let _ = out.send(frame("res", json!({ "id": id, "status": status, "headers": headers, "body": B64.encode(&first) }))).await;
        return;
    }
    let mut ack_rx = acks.register(&id);
    let _ = out.send(frame("res", json!({ "id": id, "status": status, "headers": headers, "stream": true }))).await;
    let mut seq: u64 = 0;
    let mut acked: i64 = -1;
    let mut pending = first;
    let mut error: Option<String> = None;
    loop {
        while pending.len() >= CHUNK || (!pending.is_empty() && ended) {
            while (seq as i64) - acked > MAX_INFLIGHT as i64 {
                match tokio::time::timeout(std::time::Duration::from_secs(60), ack_rx.recv()).await {
                    Ok(Some(a)) => acked = acked.max(a as i64),
                    _ => {
                        acks.done(&id);
                        return;
                    }
                }
            }
            let take = pending.len().min(CHUNK);
            let chunk: Vec<u8> = pending.drain(..take).collect();
            if out.send(frame("res.chunk", json!({ "id": id, "seq": seq, "data": B64.encode(&chunk) }))).await.is_err() {
                acks.done(&id);
                return;
            }
            seq += 1;
            while let Ok(a) = ack_rx.try_recv() {
                acked = acked.max(a as i64);
            }
        }
        if ended {
            break;
        }
        match stream.next().await {
            Some(Ok(c)) => pending.extend_from_slice(&c),
            Some(Err(e)) => {
                error = Some(e.to_string());
                ended = true;
                pending.clear();
            }
            None => ended = true,
        }
    }
    let mut d = json!({ "id": id });
    if let Some(e) = error {
        d["error"] = json!(e);
    }
    let _ = out.send(frame("res.end", d)).await;
    acks.done(&id);
}

pub fn split_ws_message(text: &str, max: usize) -> Vec<String> {
    if text.len() <= max {
        return vec![text.to_string()];
    }
    let Ok(v) = serde_json::from_str::<Value>(text) else { return vec![] };
    if v["event"] != "server://log" {
        return vec![];
    }
    let id = v["data"]["server_id"].clone();
    let lines = v["data"]["lines"].as_array().cloned().unwrap_or_default();
    let mut out = Vec::new();
    let mut cur: Vec<Value> = Vec::new();
    let mut size = 0;
    for l in lines {
        let n = l.to_string().len();
        if n > max - 200 {
            continue;
        }
        if size + n > max - 200 && !cur.is_empty() {
            out.push(json!({ "t": "event", "event": "server://log", "data": { "server_id": id, "lines": std::mem::take(&mut cur) } }).to_string());
            size = 0;
        }
        size += n + 1;
        cur.push(l);
    }
    if !cur.is_empty() {
        out.push(json!({ "t": "event", "event": "server://log", "data": { "server_id": id, "lines": cur } }).to_string());
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn request_is_restricted_to_api() {
        let f = |path: &str| ReqFrame {
            id: "r".into(),
            method: "GET".into(),
            path: path.into(),
            query: Some("a=1".into()),
            headers: HashMap::from([("Content-Type".into(), "application/json".into()), ("authorization".into(), "Bearer x".into())]),
            body: None,
            user: GwUser { id: "u1".into(), name: Some("Steve".into()), role: Some("viewer".into()) },
        };
        assert!(build_request(&f("/"), Body::empty()).is_none());
        assert!(build_request(&f("/api/v1/../x"), Body::empty()).is_none());
        let r = build_request(&f("/api/v1/servers"), Body::empty()).unwrap();
        assert_eq!(r.uri().to_string(), "/api/v1/servers?a=1");
        assert!(r.headers().get("authorization").is_none());
        assert_eq!(r.headers().get("content-type").unwrap(), "application/json");
        assert_eq!(r.extensions().get::<ViaGateway>().unwrap().role, Role::Viewer);
    }

    #[test]
    fn splits_large_log_events() {
        let lines: Vec<Value> = (0..2000).map(|i| json!({ "seq": i, "text": "x".repeat(60) })).collect();
        let text = json!({ "t": "event", "event": "server://log", "data": { "server_id": "s", "lines": lines } }).to_string();
        let parts = split_ws_message(&text, 48 * 1024);
        assert!(parts.len() > 1);
        assert!(parts.iter().all(|p| p.len() <= 48 * 1024));
        let total: usize = parts.iter().map(|p| serde_json::from_str::<Value>(p).unwrap()["data"]["lines"].as_array().unwrap().len()).sum();
        assert_eq!(total, 2000);
    }
}
