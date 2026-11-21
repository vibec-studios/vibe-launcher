//! playit.gg-Tunnel: offizieller Agent (`playitd`, GitHub playit-cloud/playit-agent, SHA-256 geprüft) je Server
//! mit eigener Secret-Datei (`servers/<id>/playit/playit.toml`). Verknüpfung über den Claim-Link
//! (playit-API `/claim/setup` + `/claim/exchange`, wie `playit setup`), Adresse aus `/v1/agents/rundata`.
use super::run::{TunnelState, TunnelStatus};
use super::{server_dir, ServerConnection};
use crate::error::{AppError, AppResult, Ctx};
use crate::minecraft::LogLevel;
use crate::Core;
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::time::Duration;
use tokio::io::AsyncBufReadExt;
use tokio_util::sync::CancellationToken;

mod tunnel;
pub use tunnel::*;

const API: &str = "https://api.playit.gg";
const RELEASES: &str = "https://api.github.com/repos/playit-cloud/playit-agent/releases/latest";

fn playit_dir(state: &Core, id: &str) -> PathBuf {
    server_dir(&state.paths, id).join("playit")
}

fn secret_file(state: &Core, id: &str) -> PathBuf {
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
pub async fn ensure_agent(state: &Core) -> AppResult<PathBuf> {
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

async fn api(state: &Core, path: &str, body: Value, secret: Option<&str>) -> AppResult<Value> {
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

fn set(state: &Core, id: &str, st: TunnelState, address: Option<String>, claim: Option<String>, msg: Option<String>) {
    state
        .server_mgr
        .set_tunnel(id, Some(TunnelStatus { kind: ServerConnection::Playit, state: st, address, claim_url: claim, message: msg, udp: None }));
}

/// Verknüpfung löschen (neuer Claim-Link beim nächsten Start).
pub fn reset(state: &Core, id: &str) -> AppResult<()> {
    let dir = playit_dir(state, id);
    for f in ["playit.toml", "claim-code.txt"] {
        let _ = std::fs::remove_file(dir.join(f));
    }
    Ok(())
}

#[cfg(test)]
mod tests;
