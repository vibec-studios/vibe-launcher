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

#[derive(Debug, Clone, Serialize, Default, PartialEq)]
pub struct UdpChannel {
    pub host: String,
    pub port: u16,
    pub address: String,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct UdpDenied {
    pub channel: String,
    pub code: String,
}

/// `waiting` (angefragt), `ok` (Tunnel funktioniert), `blocked` (kein udp_ok nach 5 s: Netz blockiert UDP),
/// `unavailable` (Relay kann kein UDP oder antwortet nicht), `off` (alle Kanäle abgelehnt)
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct UdpStatus {
    pub state: String,
    pub voice: Option<UdpChannel>,
    pub bedrock: Option<UdpChannel>,
    pub denied: Vec<UdpDenied>,
}

fn udp_states() -> &'static Mutex<HashMap<String, UdpStatus>> {
    static S: OnceLock<Mutex<HashMap<String, UdpStatus>>> = OnceLock::new();
    S.get_or_init(Default::default)
}

fn set_udp(state: &Core, id: &str, f: impl FnOnce(&mut Option<UdpStatus>)) {
    let next = {
        let mut map = udp_states().lock();
        let mut cur = map.get(id).cloned();
        f(&mut cur);
        match &cur {
            Some(u) => map.insert(id.to_string(), u.clone()),
            None => map.remove(id),
        };
        cur
    };
    if let Some(t) = state.server_mgr.status(id).and_then(|s| s.tunnel).filter(|t| t.kind == ServerConnection::Relay) {
        state.server_mgr.set_tunnel(id, Some(TunnelStatus { udp: next, ..t }));
    }
}

fn udp(state: &str) -> UdpStatus {
    UdpStatus { state: state.into(), voice: None, bedrock: None, denied: Vec::new() }
}

fn udp_timeout(state: &Core, id: &str, cancel: &CancellationToken, from: &'static str, to: &'static str) {
    let (st, id, c) = (state.clone(), id.to_string(), cancel.clone());
    tokio::spawn(async move {
        tokio::select! {
            _ = tokio::time::sleep(Duration::from_secs(5)) => {}
            _ = c.cancelled() => return,
        }
        set_udp(&st, &id, |u| {
            if let Some(x) = u.as_mut().filter(|x| x.state == from) {
                x.state = to.into();
            }
        });
    });
}

pub fn parse_udp_ready(msg: &Value) -> (Option<UdpChannel>, Option<UdpChannel>, Vec<UdpDenied>) {
    let ch = |name: &str| -> Option<UdpChannel> {
        let c = msg["channels"].get(name)?;
        let port = c["port"].as_u64().and_then(|p| u16::try_from(p).ok())?;
        let address = c["address"].as_str().unwrap_or_default().to_string();
        let host = c["host"].as_str().map(str::to_string).unwrap_or_else(|| split_host_port(&address).0);
        Some(UdpChannel { host, port, address })
    };
    let denied = msg["denied"]
        .as_object()
        .map(|o| o.iter().map(|(k, v)| UdpDenied { channel: k.clone(), code: v["code"].as_str().unwrap_or("disabled").to_string() }).collect())
        .unwrap_or_default();
    (ch("voice"), ch("bedrock"), denied)
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

/// Mojang-Sessionserver: Beitritt bestätigen (der Relay prüft danach `hasJoined`).
async fn mojang_join(state: &Core, token: &str, uuid: &str, server_id: &str) -> AppResult<()> {
    let body = json!({ "accessToken": token, "selectedProfile": uuid, "serverId": server_id });
    let r = state.net.client.post("https://sessionserver.mojang.com/session/minecraft/join").json(&body).send().await?;
    if !r.status().is_success() {
        return Err(AppError::Auth(format!("Mojang-Sitzung abgelehnt (HTTP {})", r.status())));
    }
    Ok(())
}

/// Eine Control-Sitzung. `Ok(Some(text))` = endgültiger Fehler (kein neuer Versuch).
async fn session(state: &Core, id: &str, cancel: &CancellationToken) -> AppResult<Option<String>> {
    let server = state.servers.get(id)?;
    let acc = match state.host.relay_identity(id).await {
        Ok(a) => a,
        Err(AppError::Unreachable(e)) => return Err(AppError::Unreachable(e)),
        Err(e) if crate::product::get().client == "agent" => return Ok(Some(format!("Vibe-Relay: {e}"))),
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
        "mod": format!("{}-{}", crate::product::get().slug, crate::product::get().version),
        "slot": server.relay_slot.max(1), "kind": "server", "client": crate::product::get().client,
        "version": crate::product::get().version,
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
    let local_udp = super::extras::local_ports(id);
    let mut wanted: Vec<&str> = Vec::new();
    if server.voice && local_udp.voice.is_some() {
        wanted.push("voice");
    }
    if server.bedrock && local_udp.bedrock.is_some() {
        wanted.push("bedrock");
    }
    let udp_cancel = cancel.child_token();
    let _udp_guard = udp_cancel.clone().drop_guard();
    let mut udp_host: Option<super::udp::UdpHost> = None;
    let mut udp_asked = false;
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
                if let Some(t) = &acc.ticket {
                    let _ = tx.send(json!({ "t": "auth", "ticket": t }));
                    continue;
                }
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
                ticket_retries().lock().remove(id);
                let addr = msg["address"].as_str().map(str::to_string);
                if let Some(a) = &addr {
                    state.server_mgr.launcher_line(id, LogLevel::Launcher, format!("Vibe-Relay: Freunde verbinden sich mit {a}"));
                }
                status(state, id, TunnelState::Online, addr, None);
                if !wanted.is_empty() && !udp_asked {
                    udp_asked = true;
                    let has_udp = msg["features"].as_array().is_some_and(|f| f.iter().any(|x| x.as_str() == Some("udp")));
                    if has_udp {
                        let _ = tx.send(json!({ "t": "udp", "channels": wanted }));
                        set_udp(state, id, |u| *u = Some(udp("waiting")));
                        udp_timeout(state, id, &udp_cancel, "waiting", "unavailable");
                    } else {
                        state.server_mgr.launcher_line(id, LogLevel::Warn, "Vibe-Relay: Sprachchat/Bedrock über den Relay ist hier nicht verfügbar (Relay zu alt).".to_string());
                        set_udp(state, id, |u| *u = Some(udp("unavailable")));
                    }
                }
            }
            "udp_ready" => {
                let token = msg["token"].as_str().unwrap_or_default();
                let (voice, bedrock, denied) = parse_udp_ready(&msg);
                for d in &denied {
                    state.server_mgr.launcher_line(id, LogLevel::Warn, format!("Vibe-Relay: Kanal {} abgelehnt ({})", d.channel, d.code));
                }
                let tok = super::udp::parse_token(token);
                let tunnel_port = msg["tunnel"]["port"].as_u64().and_then(|p| u16::try_from(p).ok());
                match (tok, tunnel_port) {
                    (Some(tok), Some(tp)) if voice.is_some() || bedrock.is_some() => {
                        match &udp_host {
                            Some(h) => h.update(token.to_string(), tp),
                            None => match super::udp::start(host.clone(), tp, tok, local_udp, &udp_cancel).await {
                                Ok(h) => udp_host = Some(h),
                                Err(e) => state.server_mgr.launcher_line(id, LogLevel::Warn, format!("UDP-Tunnel nicht gestartet: {e}")),
                            },
                        }
                        if let Some(b) = &bedrock {
                            state.server_mgr.launcher_line(id, LogLevel::Launcher, format!("Bedrock: Adresse {} · Port {}", b.host, b.port));
                        }
                        let ok_before = udp_states().lock().get(id).is_some_and(|u| u.state == "ok");
                        let st = if ok_before { "ok" } else { "connecting" };
                        set_udp(state, id, |u| *u = Some(UdpStatus { state: st.into(), voice, bedrock, denied }));
                        if !ok_before {
                            udp_timeout(state, id, &udp_cancel, "connecting", "blocked");
                        }
                    }
                    _ => {
                        udp_host = None;
                        set_udp(state, id, |u| *u = Some(UdpStatus { denied, ..udp("off") }));
                    }
                }
            }
            "udp_ok" => {
                state.server_mgr.launcher_line(id, LogLevel::Launcher, "Vibe-Relay: UDP-Tunnel steht (Sprachchat/Bedrock).".to_string());
                set_udp(state, id, |u| {
                    if let Some(x) = u.as_mut() {
                        x.state = "ok".into();
                    }
                });
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
                if acc.ticket.is_some() {
                    return ticket_error(id, code, text);
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
    fn udp_ready_parsing() {
        let m: serde_json::Value = serde_json::from_str(
            r#"{"t":"udp_ready","token":"9f","tunnel":{"port":24454},
            "channels":{"voice":{"port":24454,"address":"mossy-otter-27.axolite.cc:24454","voiceHost":"24454"},
            "bedrock":{"port":19207,"address":"mossy-otter-27.axolite.cc:19207","host":"mossy-otter-27.axolite.cc"}},
            "denied":{"x":{"code":"no_port","msg":"m"}}}"#,
        )
        .unwrap();
        let (v, b, d) = super::parse_udp_ready(&m);
        assert_eq!(v.unwrap().host, "mossy-otter-27.axolite.cc");
        let b = b.unwrap();
        assert_eq!((b.host.as_str(), b.port), ("mossy-otter-27.axolite.cc", 19207));
        assert_eq!(d[0].code, "no_port");
        let empty: serde_json::Value = serde_json::from_str(r#"{"t":"udp_ready","token":"","channels":{},"denied":{"bedrock":{"code":"disabled"}}}"#).unwrap();
        let (v, b, d) = super::parse_udp_ready(&empty);
        assert!(v.is_none() && b.is_none() && d.len() == 1);
    }

    #[test]
    fn host_port() {
        assert_eq!(super::split_host_port("relay.axolite.cc:25565"), ("relay.axolite.cc".into(), 25565));
        assert_eq!(super::split_host_port("localhost"), ("localhost".into(), 25565));
        assert_eq!(super::split_host_port("127.0.0.1:25599"), ("127.0.0.1".into(), 25599));
    }
}
