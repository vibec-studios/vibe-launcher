use super::*;

/// Mojang-Sessionserver: Beitritt bestätigen (der Relay prüft danach `hasJoined`).
pub(super) async fn mojang_join(state: &Core, token: &str, uuid: &str, server_id: &str) -> AppResult<()> {
    let body = json!({ "accessToken": token, "selectedProfile": uuid, "serverId": server_id });
    let r = state.net.client.post("https://sessionserver.mojang.com/session/minecraft/join").json(&body).send().await?;
    if !r.status().is_success() {
        return Err(AppError::Auth(format!("Mojang-Sitzung abgelehnt (HTTP {})", r.status())));
    }
    Ok(())
}



/// Eine Control-Sitzung. `Ok(Some(text))` = endgültiger Fehler (kein neuer Versuch).
pub(super) async fn session(state: &Core, id: &str, cancel: &CancellationToken) -> AppResult<Option<String>> {
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
    let local_udp = crate::server::extras::local_ports(id);
    let mut wanted: Vec<&str> = Vec::new();
    if server.voice && local_udp.voice.is_some() {
        wanted.push("voice");
    }
    if server.bedrock && local_udp.bedrock.is_some() {
        wanted.push("bedrock");
    }
    let udp_cancel = cancel.child_token();
    let _udp_guard = udp_cancel.clone().drop_guard();
    let mut udp_host: Option<crate::server::udp::UdpHost> = None;
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
                let tok = crate::server::udp::parse_token(token);
                let tunnel_port = msg["tunnel"]["port"].as_u64().and_then(|p| u16::try_from(p).ok());
                match (tok, tunnel_port) {
                    (Some(tok), Some(tp)) if voice.is_some() || bedrock.is_some() => {
                        match &udp_host {
                            Some(h) => h.update(token.to_string(), tp),
                            None => match crate::server::udp::start(host.clone(), tp, tok, local_udp, &udp_cancel).await {
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
pub(super) async fn data_stream(host: &str, port: u16, sid: u64, key: &str, local_port: u16, cancel: CancellationToken) -> AppResult<()> {
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
