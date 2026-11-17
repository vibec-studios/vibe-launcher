//! playit.gg-Tunnel: offizieller Agent (`playitd`, GitHub playit-cloud/playit-agent, SHA-256 geprüft) je Server
//! mit eigener Secret-Datei (`servers/<id>/playit/playit.toml`). Verknüpfung über den Claim-Link
//! (playit-API `/claim/setup` + `/claim/exchange`, wie `playit setup`), Adresse aus `/v1/agents/rundata`.
use super::run::{TunnelState, TunnelStatus};
use super::{server_dir, ServerConnection};
use crate::error::{AppError, AppResult, Ctx};
use crate::minecraft::LogLevel;
use crate::state::AppState;
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::time::Duration;
use tokio::io::AsyncBufReadExt;
use tokio_util::sync::CancellationToken;

const API: &str = "https://api.playit.gg";
const RELEASES: &str = "https://api.github.com/repos/playit-cloud/playit-agent/releases/latest";

fn playit_dir(state: &AppState, id: &str) -> PathBuf {
    server_dir(&state.paths, id).join("playit")
}

fn secret_file(state: &AppState, id: &str) -> PathBuf {
    playit_dir(state, id).join("playit.toml")
}

fn read_secret(path: &Path) -> Option<String> {
    let text = std::fs::read_to_string(path).ok()?;
    let t = text.trim();
    if !t.is_empty() && hex::decode(t).is_ok() {
        return Some(t.to_string());
    }
    let v: toml::Table = text.parse().ok()?;
    v.get("secret_key").and_then(|s| s.as_str()).map(|s| s.trim().to_string()).filter(|s| !s.is_empty())
}

/// Name des Agent-Assets für diese Plattform.
fn asset_name() -> Option<&'static str> {
    match (crate::minecraft::meta::os_name(), crate::minecraft::meta::arch_name()) {
        ("windows", "x86_64") => Some("playitd-windows-x86_64-signed.exe"),
        ("windows", "x86") => Some("playitd-windows-x86-signed.exe"),
        _ => None,
    }
}

/// Agent laden (neueste Version, SHA-256 aus der GitHub-API). Offline: vorhandene Version.
pub async fn ensure_agent(state: &AppState) -> AppResult<PathBuf> {
    let asset = asset_name().ok_or_else(|| AppError::msg("playit.gg wird vom Launcher derzeit nur unter Windows unterstützt."))?;
    let root = state.paths.root.join("tools").join("playit");
    let existing = || -> Option<PathBuf> {
        let mut v: Vec<PathBuf> = std::fs::read_dir(&root).ok()?.flatten().map(|e| e.path().join(asset)).filter(|p| p.is_file()).collect();
        v.sort();
        v.pop()
    };
    let rel: Value = match state.net.get_json(RELEASES).await {
        Ok(v) => v,
        Err(e) => return existing().ok_or_else(|| AppError::msg(format!("playit-Agent konnte nicht geladen werden: {e}"))),
    };
    let tag = rel["tag_name"].as_str().ctx("playit: Version unbekannt")?.to_string();
    let target = root.join(crate::paths::sanitize_file_name(&tag)).join(asset);
    if target.is_file() {
        return Ok(target);
    }
    let a = rel["assets"]
        .as_array()
        .and_then(|l| l.iter().find(|a| a["name"].as_str() == Some(asset)))
        .ok_or_else(|| AppError::msg("playit: passende Agent-Datei fehlt im Release"))?;
    let url = a["browser_download_url"].as_str().ctx("playit: Download-Link fehlt")?.to_string();
    let digest = a["digest"].as_str().and_then(|d| d.strip_prefix("sha256:")).map(str::to_string);
    let size = a["size"].as_u64();
    let tmp = target.with_extension("download");
    let _ = tokio::fs::remove_file(&tmp).await;
    state.net.download_all(vec![crate::net::DownloadItem::new(url, &tmp).size(size)], None).await?;
    let t2 = tmp.clone();
    let got = tokio::task::spawn_blocking(move || crate::net::sha256_file(&t2)).await??;
    match digest {
        Some(d) if d.eq_ignore_ascii_case(&got) => {}
        Some(_) => {
            let _ = tokio::fs::remove_file(&tmp).await;
            return Err(AppError::msg("playit-Agent: Prüfsumme stimmt nicht – Download verworfen."));
        }
        None => return Err(AppError::msg("playit-Agent: keine Prüfsumme veröffentlicht – Download verworfen.")),
    }
    tokio::fs::rename(&tmp, &target).await?;
    Ok(target)
}

async fn api(state: &AppState, path: &str, body: Value, secret: Option<&str>) -> AppResult<Value> {
    let mut req = state.net.client.post(format!("{API}{path}")).json(&body);
    if let Some(s) = secret {
        req = req.header("Authorization", format!("Agent-Key {s}"));
    }
    let r = req.send().await?;
    let v: Value = r.json().await.map_err(|e| AppError::msg(format!("playit: ungültige Antwort ({e})")))?;
    match v["status"].as_str() {
        Some("success") => Ok(v["data"].clone()),
        Some("fail") => Err(AppError::msg(format!("playit: {}", v["data"]))),
        _ => Err(AppError::msg(format!("playit-Fehler: {}", v["data"]))),
    }
}

fn set(state: &AppState, id: &str, st: TunnelState, address: Option<String>, claim: Option<String>, msg: Option<String>) {
    state
        .server_mgr
        .set_tunnel(id, Some(TunnelStatus { kind: ServerConnection::Playit, state: st, address, claim_url: claim, message: msg }));
}

/// Claim-Ablauf: Link anzeigen, auf Bestätigung warten, Secret speichern.
async fn claim(state: &AppState, id: &str, cancel: &CancellationToken) -> AppResult<String> {
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
    let version = format!("Vibe Launcher {}", env!("CARGO_PKG_VERSION"));
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
fn pick_address(run: &Value, port: u16) -> Option<String> {
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

pub fn spawn(state: AppState, id: String, cancel: CancellationToken) {
    tauri::async_runtime::spawn(async move {
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

async fn run(state: &AppState, id: &str, cancel: &CancellationToken) -> AppResult<()> {
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

/// Verknüpfung löschen (neuer Claim-Link beim nächsten Start).
pub fn reset(state: &AppState, id: &str) -> AppResult<()> {
    let dir = playit_dir(state, id);
    for f in ["playit.toml", "claim-code.txt"] {
        let _ = std::fs::remove_file(dir.join(f));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    #[test]
    fn address() {
        let run = serde_json::json!({ "tunnels": [
            { "display_address": "a.gl.joinmc.link", "tunnel_type": "minecraft-java", "agent_config": { "fields": [ { "name": "local_port", "value": "25570" } ] } },
            { "display_address": "b.gl.joinmc.link", "tunnel_type": "minecraft-java", "agent_config": { "fields": [ { "name": "local_port", "value": "25565" } ] } }
        ]});
        assert_eq!(super::pick_address(&run, 25565).as_deref(), Some("b.gl.joinmc.link"));
        assert_eq!(super::pick_address(&run, 1).as_deref(), Some("a.gl.joinmc.link"));
        assert_eq!(super::pick_address(&serde_json::json!({ "tunnels": [] }), 1), None);
    }
}
