//! Whitelist, OPs, Banns (Dateien des Servers) und Namen -> UUID.
use super::server_dir;
use crate::error::{AppError, AppResult};
use crate::Core;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::Path;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlayerEntry {
    pub name: String,
    pub uuid: Option<String>,
    pub level: Option<u32>,
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ServerPlayers {
    pub online: Vec<String>,
    pub whitelist_enabled: bool,
    pub whitelist: Vec<PlayerEntry>,
    pub ops: Vec<PlayerEntry>,
    pub banned: Vec<PlayerEntry>,
    pub banned_ips: Vec<PlayerEntry>,
}

#[derive(Debug, Clone, Copy, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ListKind {
    Whitelist,
    Ops,
    Banned,
    BannedIps,
}

impl ListKind {
    fn file(self) -> &'static str {
        match self {
            ListKind::Whitelist => "whitelist.json",
            ListKind::Ops => "ops.json",
            ListKind::Banned => "banned-players.json",
            ListKind::BannedIps => "banned-ips.json",
        }
    }
}

fn read_list(dir: &Path, kind: ListKind) -> Vec<Value> {
    std::fs::read(dir.join(kind.file())).ok().and_then(|b| serde_json::from_slice::<Vec<Value>>(&b).ok()).unwrap_or_default()
}

fn to_entry(kind: ListKind, v: &Value) -> PlayerEntry {
    let name = if kind == ListKind::BannedIps { v["ip"].as_str() } else { v["name"].as_str() }.unwrap_or_default().to_string();
    PlayerEntry {
        name,
        uuid: v["uuid"].as_str().map(str::to_string),
        level: v["level"].as_u64().map(|l| l as u32),
        reason: v["reason"].as_str().map(str::to_string),
    }
}

pub fn read_all(state: &Core, id: &str) -> ServerPlayers {
    let dir = server_dir(&state.paths, id);
    let props = dir.join("server.properties");
    let list = |k| read_list(&dir, k).iter().map(|v| to_entry(k, v)).collect::<Vec<_>>();
    ServerPlayers {
        online: state.server_mgr.status(id).map(|s| s.players).unwrap_or_default(),
        whitelist_enabled: super::props::get(&props, "white-list").as_deref() == Some("true"),
        whitelist: list(ListKind::Whitelist),
        ops: list(ListKind::Ops),
        banned: list(ListKind::Banned),
        banned_ips: list(ListKind::BannedIps),
    }
}

/// UUID im Format mit Bindestrichen.
fn dashed(u: &str) -> String {
    let u: String = u.chars().filter(|c| c.is_ascii_hexdigit()).collect::<String>().to_lowercase();
    if u.len() != 32 {
        return u;
    }
    format!("{}-{}-{}-{}-{}", &u[0..8], &u[8..12], &u[12..16], &u[16..20], &u[20..32])
}

/// Offline-UUID wie der Server sie bei `online-mode=false` vergibt.
pub fn offline_uuid(name: &str) -> String {
    use md5::{Digest, Md5};
    let mut h: [u8; 16] = Md5::digest(format!("OfflinePlayer:{name}").as_bytes()).into();
    h[6] = (h[6] & 0x0f) | 0x30;
    h[8] = (h[8] & 0x3f) | 0x80;
    dashed(&hex::encode(h))
}

/// Name -> (Name, UUID) über Mojang bzw. offline.
async fn lookup(state: &Core, name: &str, online: bool) -> AppResult<(String, String)> {
    if !online {
        return Ok((name.to_string(), offline_uuid(name)));
    }
    let url = format!("https://api.mojang.com/users/profiles/minecraft/{}", urlencoding::encode(name));
    let resp = state.net.client.get(&url).send().await.map_err(|e| AppError::msg(format!("Mojang ist nicht erreichbar: {e}")))?;
    if resp.status().as_u16() == 404 || resp.status().as_u16() == 204 {
        return Err(AppError::Invalid(format!("Einen Minecraft-Account „{name}“ gibt es nicht.")));
    }
    if !resp.status().is_success() {
        return Err(AppError::msg(format!("Mojang-Abfrage fehlgeschlagen (HTTP {})", resp.status())));
    }
    let v: Value = resp.json().await?;
    let id = v["id"].as_str().ok_or_else(|| AppError::msg("Mojang: ungültige Antwort"))?;
    Ok((v["name"].as_str().unwrap_or(name).to_string(), dashed(id)))
}

fn valid_name(n: &str) -> bool {
    !n.is_empty() && n.len() <= 16 && n.chars().all(|c| c.is_ascii_alphanumeric() || c == '_')
}

fn valid_ip(n: &str) -> bool {
    n.parse::<std::net::IpAddr>().is_ok()
}

/// Eintrag hinzufügen/entfernen. Läuft der Server, per Konsolenbefehl (der Server schreibt die Datei).
pub async fn action(state: &Core, id: &str, kind: ListKind, add: bool, name: &str, reason: Option<String>) -> AppResult<ServerPlayers> {
    let name = name.trim();
    if kind == ListKind::BannedIps {
        if !valid_ip(name) {
            return Err(AppError::Invalid(format!("„{name}“ ist keine gültige IP-Adresse.")));
        }
    } else if !valid_name(name) {
        return Err(AppError::Invalid(format!("„{name}“ ist kein gültiger Spielername.")));
    }
    let dir = server_dir(&state.paths, id);
    let running = state.server_mgr.status(id).is_some_and(|s| s.state == super::run::RunState::Running && !s.detached);
    let offline = super::props::get(&dir.join("server.properties"), "online-mode").as_deref() == Some("false");
    // Offline-Modus: Vanilla würde für unbekannte Namen eine UUID aus dem kleingeschriebenen Namen bilden – daher
    // die Whitelist selbst schreiben und neu laden lassen.
    let via_console = running && !(offline && kind == ListKind::Whitelist);
    if via_console {
        let r = reason.clone().unwrap_or_default();
        let cmd = match (kind, add) {
            (ListKind::Whitelist, true) => format!("whitelist add {name}"),
            (ListKind::Whitelist, false) => format!("whitelist remove {name}"),
            (ListKind::Ops, true) => format!("op {name}"),
            (ListKind::Ops, false) => format!("deop {name}"),
            (ListKind::Banned, true) => format!("ban {name} {r}"),
            (ListKind::Banned, false) => format!("pardon {name}"),
            (ListKind::BannedIps, true) => format!("ban-ip {name} {r}"),
            (ListKind::BannedIps, false) => format!("pardon-ip {name}"),
        };
        state.server_mgr.command(id, cmd.trim())?;
        // Der Server schreibt die Datei kurz danach
        tokio::time::sleep(std::time::Duration::from_millis(1200)).await;
    } else {
        let mut list = read_list(&dir, kind);
        let key = if kind == ListKind::BannedIps { "ip" } else { "name" };
        if add {
            if list.iter().any(|v| v[key].as_str().is_some_and(|x| x.eq_ignore_ascii_case(name))) {
                return Ok(read_all(state, id));
            }
            let now = chrono::Local::now().format("%Y-%m-%d %H:%M:%S %z").to_string();
            let entry = if kind == ListKind::BannedIps {
                serde_json::json!({ "ip": name, "created": now, "source": "Vibe Launcher", "expires": "forever", "reason": reason.unwrap_or_else(|| "Banned by an operator.".into()) })
            } else {
                let online = super::props::get(&dir.join("server.properties"), "online-mode").as_deref() != Some("false");
                let (real, uuid) = lookup(state, name, online).await?;
                match kind {
                    ListKind::Ops => serde_json::json!({ "uuid": uuid, "name": real, "level": 4, "bypassesPlayerLimit": false }),
                    ListKind::Banned => serde_json::json!({ "uuid": uuid, "name": real, "created": now, "source": "Vibe Launcher", "expires": "forever", "reason": reason.unwrap_or_else(|| "Banned by an operator.".into()) }),
                    _ => serde_json::json!({ "uuid": uuid, "name": real }),
                }
            };
            list.push(entry);
        } else {
            list.retain(|v| !v[key].as_str().is_some_and(|x| x.eq_ignore_ascii_case(name)));
        }
        std::fs::write(dir.join(kind.file()), serde_json::to_vec_pretty(&list)?)?;
        if running && kind == ListKind::Whitelist {
            let _ = state.server_mgr.command(id, "whitelist reload");
        }
    }
    super::relay::push_access(state, id);
    Ok(read_all(state, id))
}

pub async fn set_whitelist(state: &Core, id: &str, on: bool) -> AppResult<ServerPlayers> {
    let dir = server_dir(&state.paths, id);
    let v = if on { "true" } else { "false" };
    super::props::set(&dir.join("server.properties"), &[("white-list".into(), v.into()), ("enforce-whitelist".into(), v.into())])?;
    let running = state.server_mgr.status(id).is_some_and(|s| s.state == super::run::RunState::Running && !s.detached);
    if running {
        state.server_mgr.command(id, if on { "whitelist on" } else { "whitelist off" })?;
        tokio::time::sleep(std::time::Duration::from_millis(500)).await;
    }
    super::relay::push_access(state, id);
    Ok(read_all(state, id))
}

/// Zugriffslisten für den Relay: (whitelist|None, banNames, banIps)
pub fn access_lists(state: &Core, id: &str) -> (Option<Vec<String>>, Vec<String>, Vec<String>) {
    let p = read_all(state, id);
    let wl = if p.whitelist_enabled { Some(p.whitelist.into_iter().map(|e| e.name).collect()) } else { None };
    (wl, p.banned.into_iter().map(|e| e.name).collect(), p.banned_ips.into_iter().map(|e| e.name).collect())
}

#[cfg(test)]
mod tests {
    #[test]
    fn offline() {
        // Bekannter Wert: OfflinePlayer:Notch
        assert_eq!(super::offline_uuid("Notch"), "b50ad385-829d-3141-a216-7e7d7539ba7f");
        assert_eq!(super::dashed("069a79f444e94726a5befca90e38aaf5"), "069a79f4-44e9-4726-a5be-fca90e38aaf5");
    }
}
