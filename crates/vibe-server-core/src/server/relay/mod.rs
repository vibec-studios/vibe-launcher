//! Vibey-Relay-Client: macht einen lokalen Server über eine feste Adresse (z. B. `mossy-otter-27.axolite.cc`)
//! erreichbar. Protokoll siehe `relay/README.md` in vibec-studios/vibey-multiplayer:
//! Magic `00 56 42 59`, danach zeilenweises JSON. Control: hello -> challenge -> (Mojang join) -> auth -> ready.
//! Je Spieler `open` -> eigene Data-Verbindung `{"t":"data",…}` + Rohbytes, gespleißt mit `127.0.0.1:<port>`.
use super::run::{TunnelState, TunnelStatus};
use super::ServerConnection;
use crate::error::{AppError, AppResult};
use crate::minecraft::LogLevel;
use crate::Core;
use parking_lot::Mutex;
use serde::Serialize;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::OnceLock;
use std::time::Duration;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::TcpStream;
use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;

mod udp_state;
pub use udp_state::*;
mod session;
use session::*;

pub const MAGIC: [u8; 4] = [0x00, b'V', b'B', b'Y'];
const PROTOCOL: u32 = 1;

/// Sender zur Control-Verbindung je Server (für `access`/`rotate`).
fn senders() -> &'static Mutex<HashMap<String, mpsc::UnboundedSender<Value>>> {
    static S: OnceLock<Mutex<HashMap<String, mpsc::UnboundedSender<Value>>>> = OnceLock::new();
    S.get_or_init(Default::default)
}

pub fn split_host_port(addr: &str) -> (String, u16) {
    let a = addr.trim();
    match a.rsplit_once(':') {
        Some((h, p)) if !h.contains(':') || h.starts_with('[') => (h.trim_matches(['[', ']']).to_string(), p.parse().unwrap_or(25565)),
        _ => (a.to_string(), 25565),
    }
}

fn access_msg(state: &Core, id: &str) -> Value {
    let (wl, names, ips) = super::players::access_lists(state, id);
    json!({
        "t": "access",
        "whitelist": wl,
        "banNames": names,
        "banIps": ips,
        "messages": { "banned": "Du bist auf diesem Server gesperrt.", "whitelist": "Du stehst nicht auf der Whitelist dieses Servers." }
    })
}

/// Aktuelle Whitelist/Banns an den Relay schicken (falls verbunden).
pub fn push_access(state: &Core, id: &str) {
    if let Some(tx) = senders().lock().get(id) {
        let _ = tx.send(access_msg(state, id));
    }
}

/// Neue Adresse anfordern.
pub fn rotate(id: &str) -> bool {
    match senders().lock().get(id) {
        Some(tx) => tx.send(json!({ "t": "rotate" })).is_ok(),
        None => false,
    }
}

fn status(state: &Core, id: &str, st: TunnelState, address: Option<String>, message: Option<String>) {
    let udp = if st == TunnelState::Online { udp_states().lock().get(id).cloned() } else { None };
    state.server_mgr.set_tunnel(
        id,
        Some(TunnelStatus { kind: ServerConnection::Relay, state: st, address, claim_url: None, message, udp }),
    );
}

fn error_text(code: &str, msg: &str) -> String {
    match code {
        "limit" => format!("Limit erreicht: {msg} (Du hostest schon die maximale Anzahl an Welten/Servern.)"),
        "auth_failed" => "Dein Minecraft-Account konnte nicht bestätigt werden. Melde dich unter „Accounts“ neu an.".into(),
        "version" => "Der Relay verlangt eine neuere Launcher-Version.".into(),
        "bad_hello" => "Ungültiges Profil für den Relay.".into(),
        "rate_limited" => "Zu viele neue Adressen – versuch es später noch einmal.".into(),
        _ if !msg.is_empty() => format!("Relay: {msg}"),
        _ => format!("Relay-Fehler ({code})"),
    }
}

fn ticket_retries() -> &'static Mutex<HashMap<String, u32>> {
    static M: OnceLock<Mutex<HashMap<String, u32>>> = OnceLock::new();
    M.get_or_init(Default::default)
}

/// Fehler bei Ticket-Anmeldung (Vibe Server Agent, Relay ≥ 1.7): abgelaufen/Backend weg → neu versuchen.
fn ticket_error(id: &str, code: &str, text: String) -> AppResult<Option<String>> {
    match code {
        "ticket_expired" | "unavailable" => Err(AppError::Unreachable(text)),
        "ticket_invalid" => {
            let mut m = ticket_retries().lock();
            let n = m.entry(id.to_string()).or_insert(0);
            *n += 1;
            if *n <= 1 {
                Err(AppError::Unreachable(text))
            } else {
                m.remove(id);
                Ok(Some(text))
            }
        }
        "auth_failed" => Ok(Some("Dieser Relay unterstützt keine Vibe Server Agents.".into())),
        _ => Ok(Some(text)),
    }
}

pub fn spawn(state: Core, id: String, cancel: CancellationToken) {
    crate::rt::spawn(async move {
        let mut backoff = 1u64;
        loop {
            if cancel.is_cancelled() {
                break;
            }
            status(&state, &id, TunnelState::Connecting, None, None);
            let r = tokio::select! {
                r = session(&state, &id, &cancel) => r,
                _ = cancel.cancelled() => Ok(None),
            };
            senders().lock().remove(&id);
            udp_states().lock().remove(&id);
            if cancel.is_cancelled() {
                break;
            }
            match r {
                Ok(Some(fatal)) => {
                    state.server_mgr.launcher_line(&id, LogLevel::Error, fatal.clone());
                    status(&state, &id, TunnelState::Error, None, Some(fatal));
                    break;
                }
                Ok(None) => backoff = 1,
                Err(e) => {
                    let msg = format!("Verbindung zum Relay unterbrochen: {e} – neuer Versuch …");
                    status(&state, &id, TunnelState::Connecting, None, Some(msg));
                }
            }
            tokio::select! {
                _ = tokio::time::sleep(Duration::from_secs(backoff)) => {}
                _ = cancel.cancelled() => break,
            }
            backoff = (backoff * 2).min(30);
        }
        senders().lock().remove(&id);
        udp_states().lock().remove(&id);
        if state.server_mgr.status(&id).and_then(|s| s.tunnel).is_some_and(|t| t.kind == ServerConnection::Relay && t.state != TunnelState::Error) {
            state.server_mgr.set_tunnel(&id, None);
        }
    });
}

#[cfg(test)]
mod tests;
