//! Vibey-Relay-Client: macht einen lokalen Server über eine feste Adresse (z. B. `mossy-otter-27.axolite.cc`)
//! erreichbar. Protokoll siehe `relay/README.md` in vibec-studios/vibey-multiplayer:
//! Magic `00 56 42 59`, danach zeilenweises JSON. Control: hello -> challenge -> (Mojang join) -> auth -> ready.
//! Je Spieler `open` -> eigene Data-Verbindung `{"t":"data",…}` + Rohbytes, gespleißt mit `127.0.0.1:<port>`.
use super::run::{TunnelState, TunnelStatus};
use super::ServerConnection;
use crate::error::{AppError, AppResult};
use crate::minecraft::LogLevel;
use crate::state::AppState;
use parking_lot::Mutex;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::OnceLock;
use std::time::Duration;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::TcpStream;
use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;

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

fn access_msg(state: &AppState, id: &str) -> Value {
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
pub fn push_access(state: &AppState, id: &str) {
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

fn status(state: &AppState, id: &str, st: TunnelState, address: Option<String>, message: Option<String>) {
    state.server_mgr.set_tunnel(
        id,
        Some(TunnelStatus { kind: ServerConnection::Relay, state: st, address, claim_url: None, message }),
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

pub fn spawn(state: AppState, id: String, cancel: CancellationToken) {
    tauri::async_runtime::spawn(async move {
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
        if state.server_mgr.status(&id).and_then(|s| s.tunnel).is_some_and(|t| t.kind == ServerConnection::Relay && t.state != TunnelState::Error) {
            state.server_mgr.set_tunnel(&id, None);
        }
    });
}

/// Mojang-Sessionserver: Beitritt bestätigen (der Relay prüft danach `hasJoined`).
async fn mojang_join(state: &AppState, token: &str, uuid: &str, server_id: &str) -> AppResult<()> {
    let body = json!({ "accessToken": token, "selectedProfile": uuid, "serverId": server_id });
    let r = state.net.client.post("https://sessionserver.mojang.com/session/minecraft/join").json(&body).send().await?;
    if !r.status().is_success() {
        return Err(AppError::Auth(format!("Mojang-Sitzung abgelehnt (HTTP {})", r.status())));
    }
    Ok(())
}

/// Eine Control-Sitzung. `Ok(Some(text))` = endgültiger Fehler (kein neuer Versuch).
async fn session(state: &AppState, id: &str, cancel: &CancellationToken) -> AppResult<Option<String>> {
    let server = state.servers.get(id)?;
    let acc = match state.auth.launch_account(state, None).await {
        Ok(a) => a,
        Err(e) => return Ok(Some(format!("Für den Vibe-Relay wird ein Minecraft-Account benötigt: {e}"))),
    };
    let (host, port) = split_host_port(&server.relay());
    let stream = tokio::time::timeout(Duration::from_secs(10), TcpStream::connect((host.as_str(), port)))
        .await
        .map_err(|_| AppError::msg(format!("Relay {host}:{port} antwortet nicht")))??;
    stream.set_nodelay(true)?;
    let (rd, mut wr) = stream.into_split();
    let hello = json!({
        "t": "hello", "v": PROTOCOL, "name": acc.username, "uuid": acc.uuid.replace('-', ""), "mc": server.mc_version,
        "mod": format!("vibe-launcher-{}", env!("CARGO_PKG_VERSION")),
        "slot": server.relay_slot.max(1), "kind": "server", "client": "launcher",
    });
    let mut first = MAGIC.to_vec();
    first.extend_from_slice(format!("{hello}\n{}\n", access_msg(state, id)).as_bytes());
    wr.write_all(&first).await?;

    let (tx, mut rx) = mpsc::unbounded_channel::<Value>();
    senders().lock().insert(id.to_string(), tx.clone());
    // Schreiber + Ping
    let writer = tokio::spawn(async move {
        let mut ping = tokio::time::interval(Duration::from_secs(20));
        ping.tick().await;
        loop {
            let msg = tokio::select! {
                m = rx.recv() => match m { Some(m) => m, None => break },
                _ = ping.tick() => json!({ "t": "ping" }),
            };
            if wr.write_all(format!("{msg}\n").as_bytes()).await.is_err() {
                break;
            }
        }
    });
    struct AbortOnDrop(tokio::task::JoinHandle<()>);
    impl Drop for AbortOnDrop {
        fn drop(&mut self) {
            self.0.abort();
        }
    }
    let _w = AbortOnDrop(writer);

    let mut lines = BufReader::new(rd).lines();
    let local_port = server.port;
    loop {
        let line = tokio::time::timeout(Duration::from_secs(75), lines.next_line())
            .await
            .map_err(|_| AppError::msg("Relay antwortet nicht mehr"))??;
        let Some(line) = line else { return Err(AppError::msg("Relay hat die Verbindung geschlossen")) };
        if line.trim().is_empty() {
            continue;
        }
        let Ok(msg) = serde_json::from_str::<Value>(&line) else { continue };
        match msg["t"].as_str().unwrap_or_default() {
            "challenge" => {
                let sid = msg["serverId"].as_str().unwrap_or_default().to_string();
                // Offline-Testprofil (nur Debug-Builds): kein Mojang-Aufruf möglich
                if acc.access_token.len() > 8 {
                    if let Err(e) = mojang_join(state, &acc.access_token, &acc.uuid.replace('-', ""), &sid).await {
                        tracing::warn!("Mojang join fehlgeschlagen: {e}");
                    }
                }
                let _ = tx.send(json!({ "t": "auth" }));
            }
            "ready" => {
                let addr = msg["address"].as_str().map(str::to_string);
                if let Some(a) = &addr {
                    state.server_mgr.launcher_line(id, LogLevel::Launcher, format!("Vibe-Relay: Freunde verbinden sich mit {a}"));
                }
                status(state, id, TunnelState::Online, addr, None);
            }
            "open" => {
                let sid = msg["sid"].as_u64().unwrap_or(0);
                let key = msg["key"].as_str().unwrap_or_default().to_string();
                if let Some(name) = msg["name"].as_str() {
                    let ip = msg["ip"].as_str().unwrap_or("?");
                    state.server_mgr.launcher_line(id, LogLevel::Launcher, format!("Vibe-Relay: {name} verbindet sich ({ip})"));
                }
                let (h, p) = (host.clone(), port);
                let c = cancel.clone();
                tokio::spawn(async move {
                    if let Err(e) = data_stream(&h, p, sid, &key, local_port, c).await {
                        tracing::debug!("Relay-Stream {sid} beendet: {e}");
                    }
                });
            }
            "blocked" => {
                let name = msg["name"].as_str().unwrap_or("?");
                let reason = if msg["reason"].as_str() == Some("whitelist") { "nicht auf der Whitelist" } else { "gesperrt" };
                state.server_mgr.launcher_line(id, LogLevel::Warn, format!("Vibe-Relay: {name} abgewiesen ({reason})"));
            }
            "pong" => {}
            "replaced" => {
                return Ok(Some("Dein Account hostet diesen Platz jetzt an anderer Stelle – Relay getrennt.".into()));
            }
            "error" => {
                let code = msg["code"].as_str().unwrap_or_default();
                let text = error_text(code, msg["msg"].as_str().unwrap_or_default());
                if code == "rate_limited" {
                    state.server_mgr.launcher_line(id, LogLevel::Warn, text);
                    continue;
                }
                return Ok(Some(text));
            }
            _ => {}
        }
    }
}

/// Data-Verbindung: Relay <-> 127.0.0.1:<port>.
async fn data_stream(host: &str, port: u16, sid: u64, key: &str, local_port: u16, cancel: CancellationToken) -> AppResult<()> {
    let mut remote = tokio::time::timeout(Duration::from_secs(8), TcpStream::connect((host, port)))
        .await
        .map_err(|_| AppError::msg("Relay-Timeout"))??;
    remote.set_nodelay(true)?;
    let mut local = tokio::time::timeout(Duration::from_secs(3), TcpStream::connect(("127.0.0.1", local_port)))
        .await
        .map_err(|_| AppError::msg("Server-Timeout"))??;
    local.set_nodelay(true)?;
    let mut head = MAGIC.to_vec();
    head.extend_from_slice(format!("{}\n", json!({ "t": "data", "sid": sid, "key": key })).as_bytes());
    remote.write_all(&head).await?;
    tokio::select! {
        r = tokio::io::copy_bidirectional(&mut remote, &mut local) => { r?; }
        _ = cancel.cancelled() => {}
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    #[test]
    fn host_port() {
        assert_eq!(super::split_host_port("relay.axolite.cc:25565"), ("relay.axolite.cc".into(), 25565));
        assert_eq!(super::split_host_port("localhost"), ("localhost".into(), 25565));
        assert_eq!(super::split_host_port("127.0.0.1:25599"), ("127.0.0.1".into(), 25599));
    }
}
