//! WebSocket-Brücke für das Gateway des SDK: Rust hält die Verbindung, die Webview bekommt
//! `vibe://ws`-Events (`open` / `message` / `close`). Das SDK nutzt dafür eine kleine
//! WebSocket-kompatible Klasse (`src/lib/vibe/transport.ts`).
use super::Feature;
use crate::error::{AppError, AppResult};
use crate::events;
use crate::state::AppState;
use futures::{SinkExt, StreamExt};
use parking_lot::Mutex;
use serde::Serialize;
use std::collections::HashMap;
use std::sync::OnceLock;
use std::time::Duration;
use tokio::sync::mpsc;
use tokio_tungstenite::tungstenite::protocol::{frame::coding::CloseCode, CloseFrame};
use tokio_tungstenite::tungstenite::Message;

pub const EV_WS: &str = "vibe://ws";

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum WsEvent {
    Open { id: String },
    Message { id: String, data: String },
    Close { id: String, code: u16, reason: String },
}

enum Out {
    Text(String),
    Close(u16, String),
}

fn conns() -> &'static Mutex<HashMap<String, mpsc::UnboundedSender<Out>>> {
    static C: OnceLock<Mutex<HashMap<String, mpsc::UnboundedSender<Out>>>> = OnceLock::new();
    C.get_or_init(Default::default)
}

/// Gateway-URL zur Backend-Adresse: `https://host` -> `wss://host/ws`.
pub fn gateway_url(base: &str) -> String {
    let b = super::normalize_base(base);
    let b = if let Some(r) = b.strip_prefix("https://") { format!("wss://{r}") } else if let Some(r) = b.strip_prefix("http://") { format!("ws://{r}") } else { b };
    format!("{b}/ws")
}

fn valid_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 64 && id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

/// Verbindung öffnen. `url` muss die Gateway-URL der eingestellten Backend-Adresse sein.
pub fn open(state: &AppState, id: String, url: String) -> AppResult<()> {
    let base = super::ensure(state, Feature::Any)?;
    if !valid_id(&id) {
        return Err(AppError::Invalid("Ungültige Verbindungs-ID".into()));
    }
    if url != gateway_url(&base) {
        return Err(AppError::Invalid("Verbindung zu einer fremden Adresse abgelehnt".into()));
    }
    let (tx, mut rx) = mpsc::unbounded_channel::<Out>();
    if let Some(old) = conns().lock().insert(id.clone(), tx) {
        let _ = old.send(Out::Close(1000, "ersetzt".into()));
    }
    let app = state.app.clone();
    tauri::async_runtime::spawn(async move {
        let emit = |ev: WsEvent| events::emit(&app, EV_WS, &ev);
        let mut req = match tokio_tungstenite::tungstenite::client::IntoClientRequest::into_client_request(url.as_str()) {
            Ok(r) => r,
            Err(e) => {
                conns().lock().remove(&id);
                emit(WsEvent::Close { id, code: 1006, reason: format!("Ungültige Adresse: {e}") });
                return;
            }
        };
        if let Ok(v) = crate::net::USER_AGENT.parse() {
            req.headers_mut().insert("user-agent", v);
        }
        let conn = tokio::time::timeout(Duration::from_secs(15), tokio_tungstenite::connect_async(req)).await;
        let stream = match conn {
            Ok(Ok((s, _))) => s,
            Ok(Err(e)) => {
                tracing::debug!("Vibe-Gateway nicht erreichbar: {e}");
                conns().lock().remove(&id);
                emit(WsEvent::Close { id, code: 1006, reason: "nicht erreichbar".into() });
                return;
            }
            Err(_) => {
                conns().lock().remove(&id);
                emit(WsEvent::Close { id, code: 1006, reason: "Zeitüberschreitung".into() });
                return;
            }
        };
        // Wurde inzwischen geschlossen (z. B. Dienste ausgeschaltet)?
        if !conns().lock().contains_key(&id) {
            return;
        }
        emit(WsEvent::Open { id: id.clone() });
        let (mut sink, mut source) = stream.split();
        let mut close: Option<(u16, String)> = None;
        loop {
            tokio::select! {
                out = rx.recv() => match out {
                    Some(Out::Text(t)) => {
                        if sink.send(Message::Text(t.into())).await.is_err() { break; }
                    }
                    Some(Out::Close(code, reason)) => {
                        let frame = CloseFrame { code: CloseCode::from(code), reason: reason.clone().into() };
                        let _ = tokio::time::timeout(Duration::from_secs(2), sink.send(Message::Close(Some(frame)))).await;
                        close = Some((code, reason));
                        break;
                    }
                    None => break,
                },
                msg = source.next() => match msg {
                    Some(Ok(Message::Text(t))) => emit(WsEvent::Message { id: id.clone(), data: t.to_string() }),
                    Some(Ok(Message::Binary(b))) => emit(WsEvent::Message { id: id.clone(), data: String::from_utf8_lossy(&b).into_owned() }),
                    Some(Ok(Message::Close(f))) => {
                        close = Some(f.map(|f| (u16::from(f.code), f.reason.to_string())).unwrap_or((1005, String::new())));
                        break;
                    }
                    Some(Ok(_)) => {}
                    Some(Err(e)) => {
                        tracing::debug!("Vibe-Gateway getrennt: {e}");
                        break;
                    }
                    None => break,
                },
            }
        }
        conns().lock().remove(&id);
        let (code, reason) = close.unwrap_or((1006, String::new()));
        emit(WsEvent::Close { id, code, reason });
    });
    Ok(())
}

pub fn send(id: &str, data: String) -> AppResult<()> {
    match conns().lock().get(id) {
        Some(tx) => tx.send(Out::Text(data)).map_err(|_| AppError::msg("Verbindung geschlossen")),
        None => Err(AppError::msg("Verbindung geschlossen")),
    }
}

pub fn close(id: &str, code: Option<u16>, reason: Option<String>) {
    let code = code.filter(|c| *c == 1000 || (3000..=4999).contains(c)).unwrap_or(1000);
    if let Some(tx) = conns().lock().get(id) {
        let _ = tx.send(Out::Close(code, reason.unwrap_or_default()));
    }
}

/// Alle Verbindungen schließen (Dienste ausgeschaltet).
pub fn close_all() {
    let all: Vec<_> = conns().lock().drain().collect();
    for (_, tx) in all {
        let _ = tx.send(Out::Close(1000, "deaktiviert".into()));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn urls() {
        assert_eq!(gateway_url("https://vibe.axolite.app/"), "wss://vibe.axolite.app/ws");
        assert_eq!(gateway_url("http://127.0.0.1:3917"), "ws://127.0.0.1:3917/ws");
        assert!(valid_id("gw-1a2b"));
        assert!(!valid_id("../x"));
    }
}
