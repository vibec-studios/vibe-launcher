use super::*;

/// Claim-Ablauf: Link anzeigen, auf Bestätigung warten, Secret speichern.
pub(super) async fn claim(state: &Core, id: &str, cancel: &CancellationToken) -> AppResult<String> {
    let dir = playit_dir(state, id);
    tokio::fs::create_dir_all(&dir).await?;
    let code_file = dir.join("claim-code.txt");
    let code = match std::fs::read_to_string(&code_file).ok().map(|c| c.trim().to_string()).filter(|c| hex::decode(c).is_ok() && c.len() == 10) {
        Some(c) => c,
        None => {
            let c = hex::encode(&uuid::Uuid::new_v4().as_bytes()[..5]);
            std::fs::write(&code_file, &c)?;
            c
        }
    };
    let url = format!("https://playit.gg/claim/{code}");
    state.server_mgr.launcher_line(id, LogLevel::Launcher, format!("playit.gg: Bitte im Browser bestätigen: {url}"));
    let version = format!("{} {}", crate::product::get().display, crate::product::get().version);
    loop {
        if cancel.is_cancelled() {
            return Err(AppError::Cancelled);
        }
        match api(state, "/claim/setup", json!({ "code": code, "agent_type": "assignable", "version": version }), None).await {
            Ok(v) => match v.as_str().unwrap_or_default() {
                "UserAccepted" => break,
                "UserRejected" => {
                    let _ = std::fs::remove_file(&code_file);
                    return Err(AppError::msg("Die Verknüpfung wurde im Browser abgelehnt. „Agent zurücksetzen“ erzeugt einen neuen Link."));
                }
                "WaitingForUser" => set(state, id, TunnelState::Claim, None, Some(url.clone()), Some("Im Browser bestätigen …".into())),
                _ => set(state, id, TunnelState::Claim, None, Some(url.clone()), None),
            },
            Err(e) => {
                let m = e.to_string();
                if m.contains("CodeExpired") || m.contains("InvalidCode") {
                    let _ = std::fs::remove_file(&code_file);
                    return Err(AppError::msg("Der Claim-Link ist abgelaufen – „Agent zurücksetzen“ erzeugt einen neuen."));
                }
                set(state, id, TunnelState::Claim, None, Some(url.clone()), Some(m));
            }
        }
        tokio::select! {
            _ = tokio::time::sleep(Duration::from_secs(2)) => {}
            _ = cancel.cancelled() => return Err(AppError::Cancelled),
        }
    }
    set(state, id, TunnelState::Connecting, None, None, Some("Verknüpfung wird abgeschlossen …".into()));
    let secret = loop {
        match api(state, "/claim/exchange", json!({ "code": code }), None).await {
            Ok(v) => break v["secret_key"].as_str().ctx("playit: Secret fehlt")?.to_string(),
            Err(_) if !cancel.is_cancelled() => tokio::time::sleep(Duration::from_secs(2)).await,
            Err(e) => return Err(e),
        }
    };
    std::fs::write(secret_file(state, id), format!("secret_key = \"{secret}\"\n"))?;
    let _ = std::fs::remove_file(&code_file);
    Ok(secret)
}

/// Tunnel-Adresse aus den Agent-Daten (passender lokaler Port bevorzugt).
pub(super) fn pick_address(run: &Value, port: u16) -> Option<String> {
    let tunnels = run["tunnels"].as_array()?;
    let local_port = |t: &Value| -> Option<u16> {
        t["agent_config"]["fields"].as_array()?.iter().find(|f| f["name"].as_str() == Some("local_port"))?["value"].as_str()?.parse().ok()
    };
    tunnels
        .iter()
        .find(|t| local_port(t) == Some(port))
        .or_else(|| tunnels.iter().find(|t| t["tunnel_type"].as_str() == Some("minecraft-java")))
        .or_else(|| tunnels.first())
        .and_then(|t| t["display_address"].as_str().map(str::to_string))
}

pub fn spawn(state: Core, id: String, cancel: CancellationToken) {
    crate::rt::spawn(async move {
        if let Err(e) = run(&state, &id, &cancel).await {
            if !matches!(e, AppError::Cancelled) {
                let m = e.to_string();
                state.server_mgr.launcher_line(&id, LogLevel::Error, format!("playit.gg: {m}"));
                set(&state, &id, TunnelState::Error, None, None, Some(m));
            }
        }
        if cancel.is_cancelled() && state.server_mgr.status(&id).and_then(|s| s.tunnel).is_some_and(|t| t.kind == ServerConnection::Playit) {
            state.server_mgr.set_tunnel(&id, None);
        }
    });
}

pub(super) async fn run(state: &Core, id: &str, cancel: &CancellationToken) -> AppResult<()> {
    set(state, id, TunnelState::Connecting, None, None, Some("playit-Agent wird vorbereitet …".into()));
    let agent = ensure_agent(state).await?;
    let sfile = secret_file(state, id);
    let secret = match read_secret(&sfile) {
        Some(s) => s,
        None => claim(state, id, cancel).await?,
    };
    // Agent starten
    let dir = playit_dir(state, id);
    let socket = if cfg!(windows) { format!(r"\\.\pipe\vibe-playit-{id}") } else { dir.join("playitd.sock").to_string_lossy().to_string() };
    let mut cmd = tokio::process::Command::new(&agent);
    cmd.arg("--secret-path")
        .arg(&sfile)
        .arg("--socket-path")
        .arg(&socket)
        .arg("--log-path")
        .arg(dir.join("playitd.log"))
        .current_dir(&dir)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .kill_on_drop(true);
    #[cfg(windows)]
    cmd.creation_flags(crate::minecraft::java::CREATE_NO_WINDOW);
    let mut child = cmd.spawn().map_err(|e| AppError::msg(format!("playit-Agent startet nicht: {e}")))?;
    state.server_mgr.launcher_line(id, LogLevel::Launcher, "playit.gg: Agent gestartet.");
    for (stream, err) in [(child.stdout.take().map(|s| Box::new(s) as Box<dyn tokio::io::AsyncRead + Unpin + Send>), false), (child.stderr.take().map(|s| Box::new(s) as Box<dyn tokio::io::AsyncRead + Unpin + Send>), true)] {
        let Some(s) = stream else { continue };
        let st = state.clone();
        let id2 = id.to_string();
        tokio::spawn(async move {
            let mut lines = tokio::io::BufReader::new(s).lines();
            while let Ok(Some(l)) = lines.next_line().await {
                let l = l.trim();
                if !l.is_empty() {
                    st.server_mgr.launcher_line(&id2, if err { LogLevel::Warn } else { LogLevel::Launcher }, format!("playit: {}", l.chars().take(300).collect::<String>()));
                }
            }
        });
    }
    let port = state.servers.get(id)?.port;
    let mut tried_create = false;
    let mut last_addr: Option<String> = None;
    loop {
        if let Ok(Some(status)) = child.try_wait() {
            return Err(AppError::msg(format!("playit-Agent wurde beendet ({status}). Details in playit/playitd.log.")));
        }
        match api(state, "/v1/agents/rundata", json!({}), Some(&secret)).await {
            Ok(run) => match pick_address(&run, port) {
                Some(addr) => {
                    if last_addr.as_deref() != Some(addr.as_str()) {
                        state.server_mgr.launcher_line(id, LogLevel::Launcher, format!("playit.gg: Freunde verbinden sich mit {addr}"));
                        last_addr = Some(addr.clone());
                    }
                    set(state, id, TunnelState::Online, Some(addr), None, None);
                }
                None => {
                    if !tried_create {
                        tried_create = true;
                        let name = state.servers.get(id).map(|s| s.name).unwrap_or_else(|_| "Minecraft".into());
                        let body = json!({
                            "name": name, "tunnel_type": "minecraft-java", "port_type": "tcp", "port_count": 1,
                            "origin": { "type": "agent", "data": { "agent_id": run["agent_id"], "local_ip": "127.0.0.1", "local_port": port } },
                            "enabled": true, "alloc": null, "firewall_id": null, "proxy_protocol": null,
                        });
                        match api(state, "/tunnels/create", body, Some(&secret)).await {
                            Ok(_) => continue,
                            Err(e) => tracing::info!("playit: Tunnel nicht automatisch anlegbar: {e}"),
                        }
                    }
                    set(
                        state,
                        id,
                        TunnelState::Connecting,
                        None,
                        Some("https://playit.gg/account/tunnels".into()),
                        Some(format!("Agent verbunden. Lege auf playit.gg einen Tunnel „Minecraft Java“ für 127.0.0.1:{port} an.")),
                    );
                }
            },
            Err(e) => {
                let m = e.to_string();
                if m.contains("Auth") || m.contains("auth") {
                    let _ = child.kill().await;
                    return Err(AppError::msg("Der playit-Agent ist nicht mehr gültig – „Agent zurücksetzen“ und neu verknüpfen."));
                }
                set(state, id, TunnelState::Connecting, last_addr.clone(), None, Some(m));
            }
        }
        tokio::select! {
            _ = tokio::time::sleep(Duration::from_secs(if last_addr.is_some() { 30 } else { 8 })) => {}
            _ = cancel.cancelled() => {
                let _ = child.kill().await;
                return Ok(());
            }
        }
    }
}
