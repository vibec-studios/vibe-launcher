use super::tls::{self, Pinned};
use super::{http, store, vibe, RemoteAgent, Via};
use crate::error::{AppError, AppResult};
use crate::events;
use futures::{SinkExt, StreamExt};
use parking_lot::Mutex;
use serde::Serialize;
use serde_json::json;
use std::collections::{BTreeSet, HashMap};
use std::sync::{Arc, OnceLock};
use std::time::Duration;
use tauri::{AppHandle, Manager};
use tokio::sync::mpsc;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::http::HeaderValue;
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::Connector;

pub const EV_MESSAGE: &str = "remote://ws";
pub const EV_STATE: &str = "remote://state";

#[derive(Clone, Serialize)]
struct MessageEv {
    agent: String,
    data: String,
}

#[derive(Clone, Serialize)]
struct StateEv {
    agent: String,
    state: &'static str,
    error: Option<String>,
}

struct Conn {
    tx: mpsc::UnboundedSender<String>,
    topics: Mutex<BTreeSet<String>>,
    stop: tokio_util::sync::CancellationToken,
    state: Mutex<&'static str>,
}

fn conns() -> &'static Mutex<HashMap<String, Arc<Conn>>> {
    static C: OnceLock<Mutex<HashMap<String, Arc<Conn>>>> = OnceLock::new();
    C.get_or_init(Default::default)
}

fn set_state(app: &AppHandle, key: &str, conn: &Conn, state: &'static str, error: Option<String>) {
    *conn.state.lock() = state;
    events::emit(app, EV_STATE, &StateEv { agent: key.to_string(), state, error });
}

pub fn state_of(key: &str) -> Option<&'static str> {
    conns().lock().get(key).map(|c| *c.state.lock())
}

pub fn connect(app: AppHandle, agent: RemoteAgent) {
    let key = agent.key.clone();
    if conns().lock().contains_key(&key) {
        return;
    }
    let (tx, rx) = mpsc::unbounded_channel::<String>();
    let conn = Arc::new(Conn {
        tx,
        topics: Mutex::new(["servers".to_string(), "tasks".to_string()].into_iter().collect()),
        stop: tokio_util::sync::CancellationToken::new(),
        state: Mutex::new("connecting"),
    });
    conns().lock().insert(key.clone(), Arc::clone(&conn));
    tauri::async_runtime::spawn(run(app, agent, conn, rx));
}

pub fn disconnect(key: &str) {
    if let Some(c) = conns().lock().remove(key) {
        c.stop.cancel();
    }
}

pub fn subscribe(key: &str, topics: Vec<String>, on: bool) -> AppResult<()> {
    let c = conns().lock().get(key).cloned().ok_or_else(|| AppError::NotFound("Keine Verbindung".into()))?;
    {
        let mut t = c.topics.lock();
        for x in &topics {
            if on {
                t.insert(x.clone());
            } else {
                t.remove(x);
            }
        }
    }
    let kind = if on { "subscribe" } else { "unsubscribe" };
    let _ = c.tx.send(json!({ "t": kind, "topics": topics }).to_string());
    Ok(())
}

pub fn send(key: &str, data: String) -> AppResult<()> {
    let c = conns().lock().get(key).cloned().ok_or_else(|| AppError::NotFound("Keine Verbindung".into()))?;
    c.tx.send(data).map_err(|_| AppError::Unreachable("Verbindung getrennt".into()))
}

type Ws = tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>;

async fn open(app: &AppHandle, agent: &RemoteAgent) -> AppResult<(Ws, Option<String>)> {
    let state = app.state::<crate::state::AppState>();
    match agent.via {
        Via::Direct => {
            let address = agent.address.clone().unwrap_or_default();
            let base = http::base_url(&address)?;
            let token = store::load_token(&state.paths, &agent.key)?;
            let url = format!("wss://{}/api/v1/ws", base.trim_start_matches("https://"));
            let pin = Pinned::new(agent.fingerprint.as_deref());
            let connector = Connector::Rustls(Arc::new(tls::config(Arc::clone(&pin))));
            let req = url.into_client_request().map_err(|e| AppError::Invalid(e.to_string()))?;
            let fut = tokio_tungstenite::connect_async_tls_with_config(req, None, false, Some(connector));
            match tokio::time::timeout(Duration::from_secs(10), fut).await {
                Ok(Ok((ws, _))) => Ok((ws, Some(json!({ "t": "auth", "token": token }).to_string()))),
                Ok(Err(e)) if pin.mismatched() => {
                    tracing::warn!("Remote-WS {}: Zertifikat passt nicht ({e})", agent.key);
                    Err(AppError::Access("Das Zertifikat dieses Servers hat sich geändert. Bitte neu koppeln.".into()))
                }
                Ok(Err(e)) => Err(AppError::Unreachable(format!("{address} nicht erreichbar ({e})"))),
                Err(_) => Err(AppError::Unreachable(format!("{address} antwortet nicht"))),
            }
        }
        Via::Vibe => {
            let url = vibe::ws_url(&state, &agent.id)?;
            let token = vibe::token(&state)?;
            let mut req = url.into_client_request().map_err(|e| AppError::Invalid(e.to_string()))?;
            let hv = HeaderValue::from_str(&format!("Bearer {token}")).map_err(|_| AppError::Auth("Ungültiges Token".into()))?;
            req.headers_mut().insert("authorization", hv);
            let fut = tokio_tungstenite::connect_async(req);
            match tokio::time::timeout(Duration::from_secs(15), fut).await {
                Ok(Ok((ws, _))) => Ok((ws, None)),
                Ok(Err(e)) => Err(AppError::Unreachable(format!("Vibe-Gateway nicht erreichbar ({e})"))),
                Err(_) => Err(AppError::Unreachable("Vibe-Gateway antwortet nicht".into())),
            }
        }
    }
}

async fn run(app: AppHandle, agent: RemoteAgent, conn: Arc<Conn>, mut rx: mpsc::UnboundedReceiver<String>) {
    let key = agent.key.clone();
    let mut backoff = 2u64;
    loop {
        if conn.stop.is_cancelled() {
            break;
        }
        set_state(&app, &key, &conn, "connecting", None);
        let opened = tokio::select! {
            r = open(&app, &agent) => r,
            _ = conn.stop.cancelled() => break,
        };
        match opened {
            Ok((ws, auth)) => {
                backoff = 2;
                let reason = pump(&app, &key, &conn, ws, auth, &mut rx).await;
                if conn.stop.is_cancelled() {
                    break;
                }
                set_state(&app, &key, &conn, "offline", reason);
            }
            Err(e) => {
                let fatal = matches!(e, AppError::Access(_) | AppError::Auth(_) | AppError::NotConfigured(_));
                set_state(&app, &key, &conn, if fatal { "failed" } else { "offline" }, Some(e.to_string()));
                if fatal {
                    backoff = backoff.max(60);
                }
            }
        }
        tokio::select! {
            _ = tokio::time::sleep(Duration::from_secs(backoff)) => {}
            _ = conn.stop.cancelled() => break,
        }
        backoff = (backoff * 2).min(60);
    }
    set_state(&app, &key, &conn, "offline", None);
}

async fn pump(app: &AppHandle, key: &str, conn: &Conn, ws: Ws, auth: Option<String>, rx: &mut mpsc::UnboundedReceiver<String>) -> Option<String> {
    let (mut sink, mut stream) = ws.split();
    if let Some(a) = auth {
        if sink.send(Message::text(a)).await.is_err() {
            return Some("Anmeldung fehlgeschlagen".into());
        }
    }
    let topics: Vec<String> = conn.topics.lock().iter().cloned().collect();
    let _ = sink.send(Message::text(json!({ "t": "subscribe", "topics": topics }).to_string())).await;
    set_state(app, key, conn, "online", None);
    let mut ping = tokio::time::interval(Duration::from_secs(25));
    ping.tick().await;
    loop {
        tokio::select! {
            _ = conn.stop.cancelled() => {
                let _ = sink.send(Message::Close(None)).await;
                return None;
            }
            _ = ping.tick() => {
                if sink.send(Message::text(json!({ "t": "ping" }).to_string())).await.is_err() {
                    return Some("Verbindung verloren".into());
                }
            }
            out = rx.recv() => {
                let Some(text) = out else { return None };
                if sink.send(Message::text(text)).await.is_err() {
                    return Some("Verbindung verloren".into());
                }
            }
            msg = stream.next() => match msg {
                Some(Ok(Message::Text(t))) => {
                    events::emit(app, EV_MESSAGE, &MessageEv { agent: key.to_string(), data: t.to_string() });
                }
                Some(Ok(Message::Ping(p))) => {
                    let _ = sink.send(Message::Pong(p)).await;
                }
                Some(Ok(Message::Close(f))) => {
                    return f.map(|f| f.reason.to_string()).filter(|r| !r.is_empty());
                }
                Some(Ok(_)) => {}
                Some(Err(e)) => return Some(e.to_string()),
                None => return Some("Verbindung beendet".into()),
            }
        }
    }
}
