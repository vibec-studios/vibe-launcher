//! Sprachchat und Bedrock-Freunde für Server aus dem Launcher (Vertrag 04/28): Simple Voice Chat bzw. Geyser +
//! Floodgate über die vorhandene Plugin/Mod-Schicht (Modrinth) installieren und vor jedem Start konfigurieren.
//! Über den Vibe-Relay laufen beide auf 127.0.0.1 (der Launcher tunnelt UDP), sonst gelten die normalen Standardports.
use super::plugins::{self, AddonSource};
use super::{server_dir, Server, ServerConnection};
use crate::error::{AppError, AppResult};
use crate::model::LoaderKind;
use crate::Core;
use parking_lot::Mutex;
use serde::Serialize;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

pub const SVC: &str = "simple-voice-chat";
pub const GEYSER: &str = "geyser";
pub const FLOODGATE: &str = "floodgate";
pub const SVC_DEFAULT_PORT: u16 = 24454;
pub const GEYSER_DEFAULT_PORT: u16 = 19132;
pub const RELAY_VOICE_HOST: &str = "24454";

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq, Default)]
pub struct LocalPorts {
    pub voice: Option<u16>,
    pub bedrock: Option<u16>,
}

fn ports() -> &'static Mutex<HashMap<String, LocalPorts>> {
    static P: OnceLock<Mutex<HashMap<String, LocalPorts>>> = OnceLock::new();
    P.get_or_init(Default::default)
}

pub fn local_ports(id: &str) -> LocalPorts {
    ports().lock().get(id).copied().unwrap_or_default()
}

pub fn voice_supported(s: &Server) -> bool {
    match &s.platform {
        Some(p) => p.kind != super::platform::PlatformKind::Folia,
        None => matches!(s.loader.kind, LoaderKind::Fabric | LoaderKind::Quilt | LoaderKind::Neoforge | LoaderKind::Forge),
    }
}

pub fn bedrock_supported(s: &Server) -> bool {
    match &s.platform {
        Some(p) => p.kind != super::platform::PlatformKind::Folia,
        None => matches!(s.loader.kind, LoaderKind::Fabric | LoaderKind::Neoforge),
    }
}

fn plugins_mode(s: &Server) -> bool {
    s.platform.is_some()
}

pub fn svc_config(s: &Server, dir: &Path) -> PathBuf {
    if plugins_mode(s) { dir.join("plugins").join("voicechat") } else { dir.join("config").join("voicechat") }.join("voicechat-server.properties")
}

pub fn geyser_config(s: &Server, dir: &Path) -> PathBuf {
    let folder = match (&s.platform, s.loader.kind) {
        (Some(_), _) => return dir.join("plugins").join("Geyser-Spigot").join("config.yml"),
        (None, LoaderKind::Neoforge) => "Geyser-NeoForge",
        _ => "Geyser-Fabric",
    };
    dir.join("config").join(folder).join("config.yml")
}

pub fn free_udp_port(preferred: u16, taken: &[u16]) -> u16 {
    if !taken.contains(&preferred) && std::net::UdpSocket::bind(("127.0.0.1", preferred)).is_ok() {
        return preferred;
    }
    for _ in 0..8 {
        if let Ok(p) = std::net::UdpSocket::bind(("127.0.0.1", 0)).and_then(|s| s.local_addr()).map(|a| a.port()) {
            if !taken.contains(&p) {
                return p;
            }
        }
    }
    preferred
}

fn top_key(line: &str) -> Option<&str> {
    if line.starts_with([' ', '\t', '#', '-']) {
        return None;
    }
    line.split_once(':').map(|(k, _)| k.trim())
}

/// Einfache YAML-Änderung: Schlüssel direkt unter einem Abschnitt der obersten Ebene setzen (Kommentare bleiben).
pub fn yaml_set(text: &str, section: &str, values: &[(&str, String)]) -> String {
    let mut lines: Vec<String> = text.lines().map(str::to_string).collect();
    let start = lines.iter().position(|l| top_key(l) == Some(section));
    let start = match start {
        Some(i) => i,
        None => {
            if !lines.is_empty() && !lines.last().is_some_and(|l| l.trim().is_empty()) {
                lines.push(String::new());
            }
            lines.push(format!("{section}:"));
            lines.len() - 1
        }
    };
    let end = (start + 1..lines.len()).find(|&i| top_key(&lines[i]).is_some()).unwrap_or(lines.len());
    let indent = lines[start + 1..end]
        .iter()
        .find(|l| !l.trim().is_empty() && !l.trim_start().starts_with('#'))
        .map(|l| l.len() - l.trim_start().len())
        .filter(|n| *n > 0)
        .unwrap_or(2);
    let mut insert_at = end;
    while insert_at > start + 1 && lines[insert_at - 1].trim().is_empty() {
        insert_at -= 1;
    }
    let mut extra = Vec::new();
    for (k, v) in values {
        let hit = (start + 1..end).find(|&i| {
            let l = &lines[i];
            let ind = l.len() - l.trim_start().len();
            ind == indent && l.trim_start().split_once(':').is_some_and(|(key, _)| key.trim() == *k)
        });
        let line = format!("{}{k}: {v}", " ".repeat(indent));
        match hit {
            Some(i) => lines[i] = line,
            None => extra.push(line),
        }
    }
    for (n, l) in extra.into_iter().enumerate() {
        lines.insert(insert_at + n, l);
    }
    let mut out = lines.join("\n");
    out.push('\n');
    out
}

fn yaml_quote(s: &str) -> String {
    format!("\"{}\"", s.replace('\\', "\\\\").replace('"', "\\\""))
}

pub fn write_geyser(path: &Path, relay: bool, local_port: u16, server_port: u16, motd: &str) -> AppResult<()> {
    let text = std::fs::read_to_string(path).unwrap_or_default();
    let (addr, port) = if relay { ("127.0.0.1".to_string(), local_port) } else { ("0.0.0.0".to_string(), GEYSER_DEFAULT_PORT) };
    let mut out = yaml_set(
        &text,
        "bedrock",
        &[("address", addr), ("port", port.to_string()), ("clone-remote-port", "false".into()), ("motd1", yaml_quote(motd))],
    );
    let remote_section = if text.lines().any(|l| top_key(l) == Some("java")) { "java" } else { "remote" };
    out = yaml_set(&out, remote_section, &[("address", "127.0.0.1".into()), ("port", server_port.to_string()), ("auth-type", "floodgate".into())]);
    if let Some(p) = path.parent() {
        std::fs::create_dir_all(p)?;
    }
    std::fs::write(path, out)?;
    Ok(())
}

pub fn write_svc(path: &Path, relay: bool, local_port: u16) -> AppResult<()> {
    let values: Vec<(String, String)> = if relay {
        vec![("port".into(), local_port.to_string()), ("bind_address".into(), "127.0.0.1".into()), ("voice_host".into(), RELAY_VOICE_HOST.into())]
    } else {
        vec![("port".into(), SVC_DEFAULT_PORT.to_string()), ("bind_address".into(), String::new()), ("voice_host".into(), String::new())]
    };
    super::props::set(path, &values)
}

/// Vor jedem Start: Ports wählen und Konfigurationen schreiben (nur für eingeschaltete Extras).
pub fn before_start(state: &Core, s: &Server) -> Vec<String> {
    let dir = server_dir(&state.paths, &s.id);
    let relay = s.connection == ServerConnection::Relay;
    let mut lines = Vec::new();
    let taken: Vec<u16> = ports().lock().iter().filter(|(k, _)| *k != &s.id).flat_map(|(_, p)| [p.voice, p.bedrock]).flatten().collect();
    let mut lp = LocalPorts::default();
    if s.voice && voice_supported(s) {
        let port = if relay { free_udp_port(SVC_DEFAULT_PORT, &taken) } else { SVC_DEFAULT_PORT };
        match write_svc(&svc_config(s, &dir), relay, port) {
            Ok(()) => {
                lp.voice = Some(port);
                lines.push(format!("Sprachchat (Simple Voice Chat): lokaler UDP-Port {port}"));
            }
            Err(e) => lines.push(format!("Sprachchat-Einstellungen nicht geschrieben: {e}")),
        }
    }
    if s.bedrock && bedrock_supported(s) {
        let mut t = taken.clone();
        t.extend(lp.voice);
        let port = if relay { free_udp_port(GEYSER_DEFAULT_PORT, &t) } else { GEYSER_DEFAULT_PORT };
        match write_geyser(&geyser_config(s, &dir), relay, port, s.port, &s.name) {
            Ok(()) => {
                lp.bedrock = Some(port);
                lines.push(format!("Bedrock (Geyser): lokaler UDP-Port {port}"));
            }
            Err(e) => lines.push(format!("Geyser-Einstellungen nicht geschrieben: {e}")),
        }
    }
    ports().lock().insert(s.id.clone(), lp);
    lines
}

#[derive(Debug, Clone, Serialize)]
pub struct ExtrasInfo {
    pub voice: bool,
    pub bedrock: bool,
    pub voice_supported: bool,
    pub bedrock_supported: bool,
    pub voice_installed: bool,
    pub bedrock_installed: bool,
}

fn matches(a: &plugins::Addon, slugs: &[&str]) -> bool {
    let slug = a.slug.as_deref().unwrap_or("").to_ascii_lowercase();
    let base = plugins::base_name(&a.file_name).to_ascii_lowercase();
    slugs.iter().any(|s| slug == *s || base.starts_with(&s.replace("simple-voice-chat", "voicechat")))
}

pub async fn info(state: &Core, s: &Server) -> ExtrasInfo {
    let items = if s.addon_dir().is_some() { plugins::list(state, s).await.map(|l| l.items).unwrap_or_default() } else { Vec::new() };
    let has = |slug: &str| items.iter().any(|a| a.enabled && matches(a, &[slug]));
    ExtrasInfo {
        voice: s.voice,
        bedrock: s.bedrock,
        voice_supported: voice_supported(s),
        bedrock_supported: bedrock_supported(s),
        voice_installed: has(SVC),
        bedrock_installed: has(GEYSER) && has(FLOODGATE),
    }
}

async fn ensure(state: &Core, s: &Server, slugs: &[&str], on: bool) -> AppResult<()> {
    let items = plugins::list(state, s).await?.items;
    for slug in slugs {
        let found: Vec<&plugins::Addon> = items.iter().filter(|a| matches(a, &[slug])).collect();
        if on {
            if found.is_empty() {
                plugins::install(state, s, AddonSource::Modrinth, slug).await?;
            } else {
                for a in found.iter().filter(|a| !a.enabled) {
                    plugins::set_enabled(state, s, &a.file_name, true)?;
                }
            }
        } else {
            for a in found.iter().filter(|a| a.enabled) {
                plugins::set_enabled(state, s, &a.file_name, false)?;
            }
        }
    }
    Ok(())
}

pub async fn set(state: &Core, id: &str, voice: Option<bool>, bedrock: Option<bool>) -> AppResult<ExtrasInfo> {
    let s = state.servers.get(id)?;
    if state.server_mgr.is_active(id) {
        return Err(AppError::Invalid("Bitte den Server zuerst stoppen.".into()));
    }
    if voice == Some(true) && !voice_supported(&s) {
        return Err(AppError::Invalid("Sprachchat braucht einen Server mit Paper, Purpur, Fabric, Quilt, NeoForge oder Forge.".into()));
    }
    if bedrock == Some(true) && !bedrock_supported(&s) {
        return Err(AppError::Invalid("Bedrock-Freunde brauchen einen Server mit Paper, Purpur, Fabric oder NeoForge.".into()));
    }
    if let Some(v) = voice {
        ensure(state, &s, &[SVC], v).await?;
    }
    if let Some(b) = bedrock {
        ensure(state, &s, &[GEYSER, FLOODGATE], b).await?;
    }
    let s = state.servers.modify(id, |x| {
        if let Some(v) = voice {
            x.voice = v;
        }
        if let Some(b) = bedrock {
            x.bedrock = b;
        }
    })?;
    Ok(info(state, &s).await)
}

#[cfg(test)]
mod tests;
