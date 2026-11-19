//! „Spiel mit mir“-Links (Vertrag: docs/PLAY-LINKS.md).
//!
//! - `<spielordner>/.vibe/instance.json` schreibt der Launcher vor jedem Start (§2), der Vibey Client liest sie.
//! - `<spielordner>/.vibe/session.json` schreibt der Client, solange das Spiel läuft; der Launcher liest sie für den
//!   Discord-Status und „Einladungslink kopieren“.
//! - `join`: Link laden, passende Instanz finden oder anlegen, danach startet das Frontend per Quick Play.
pub mod join;

use crate::content::index::ContentIndex;
use crate::content::Source;
use crate::error::AppResult;
use crate::instance::{Instance, PackSourceKind};
use crate::state::AppState;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

/// Ab diesem Alter (Sekunden) gilt `session.json` als veraltet.
pub const SESSION_STALE_SECS: i64 = 60;

// ------------------------------------------------------------------ Formate

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct LinkLoader {
    pub kind: String,
    #[serde(default)]
    pub version: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct LinkPack {
    pub source: String,
    pub project_id: String,
    pub version_id: String,
    #[serde(default)]
    pub title: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct LinkMod {
    pub source: String,
    pub project_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub version_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub kind: Option<String>,
    /// Nur lokal in `instance.json` (nicht ans Backend): Dateiname im Ordner, damit der Client manuelle Mods erkennt
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub file: Option<String>,
}

/// `<spielordner>/.vibe/instance.json` (schema 1).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct InstanceFile {
    pub schema: u32,
    pub name: String,
    pub mc_version: String,
    pub loader: LinkLoader,
    pub pack: Option<LinkPack>,
    pub mods: Vec<LinkMod>,
    pub client_pack: Option<String>,
    /// Nur lokal: weitere Dateien mit bekannter Quelle (Pfade relativ zum Spielordner). Bei Modpacks leer, weil
    /// Override-Dateien nicht im Index stehen – der Client zeigt dann keinen Hinweis auf manuelle Mods.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub known_files: Vec<String>,
}

/// `<spielordner>/.vibe/session.json` (schema 1), geschrieben vom Vibey Client.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub struct Session {
    pub schema: u32,
    /// menu | singleplayer | hosting | multiplayer
    pub state: String,
    #[serde(default)]
    pub server: Option<String>,
    #[serde(default)]
    pub world: Option<String>,
    #[serde(default)]
    pub play_link: Option<String>,
    #[serde(default)]
    pub players: Option<u32>,
    #[serde(default)]
    pub max_players: Option<u32>,
    #[serde(default)]
    pub updated_at: i64,
}

/// Spiel-Link vom Backend (`GET /api/v1/play-links/<code>`).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct PlayLink {
    pub code: String,
    pub url: String,
    pub host: LinkHost,
    pub relay_host: String,
    pub mc_version: String,
    pub loader: LinkLoader,
    #[serde(default)]
    pub pack: Option<LinkPack>,
    #[serde(default)]
    pub mods: Vec<LinkMod>,
    #[serde(default)]
    pub client_pack: Option<String>,
    #[serde(default)]
    pub world_name: Option<String>,
    #[serde(default)]
    pub max_players: Option<u32>,
    #[serde(default)]
    pub active: bool,
    pub expires_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct LinkHost {
    pub uuid: String,
    pub name: String,
}

// ------------------------------------------------------------------ Pfade

pub fn vibe_dir(state: &AppState, id: &str) -> PathBuf {
    state.paths.game_dir(id).join(".vibe")
}

/// Ist der Code gültig? 6–8 Zeichen aus `[a-z0-9]` ohne 0/1/i/l/o.
pub fn valid_code(code: &str) -> bool {
    (6..=8).contains(&code.len()) && code.bytes().all(|c| matches!(c, b'2'..=b'9' | b'a'..=b'h' | b'j' | b'k' | b'm' | b'n' | b'p'..=b'z'))
}

// ------------------------------------------------------------------ instance.json

fn loader_kind_str(i: &Instance) -> String {
    serde_json::to_value(i.loader.kind).ok().and_then(|v| v.as_str().map(str::to_string)).unwrap_or_else(|| "vanilla".into())
}

/// Ordner -> `kind` im Vertrag.
fn kind_of_key(key: &str) -> Option<&'static str> {
    match key.split('/').next()? {
        "mods" => Some("mod"),
        "resourcepacks" => Some("resourcepack"),
        "shaderpacks" => Some("shader"),
        "datapacks" => Some("datapack"),
        _ => None,
    }
}

/// Inhalt von `instance.json` aus Instanz, Content-Index und Client-Packs.
pub fn build_instance_file(inst: &Instance, idx: &ContentIndex, client_pack: Option<String>) -> InstanceFile {
    let pack = inst.source.as_ref().and_then(|s| {
        let source = match s.kind {
            PackSourceKind::Modrinth => "modrinth",
            PackSourceKind::Curseforge => "curseforge",
            _ => return None,
        };
        Some(LinkPack { source: source.into(), project_id: s.project_id.clone()?, version_id: s.version_id.clone()?, title: s.name.clone() })
    });
    let mut mods: Vec<LinkMod> = idx
        .files
        .iter()
        .filter(|(_, e)| matches!(e.source, Source::Modrinth | Source::Curseforge))
        .filter_map(|(k, e)| {
            Some(LinkMod {
                source: e.source.as_string(),
                project_id: e.project_id.clone(),
                version_id: Some(e.version_id.clone()).filter(|v| !v.is_empty()),
                kind: Some(kind_of_key(k)?.to_string()),
                file: if pack.is_none() { k.split_once('/').map(|(_, f)| f.to_string()) } else { None },
            })
        })
        .collect();
    // gleiche Projekte (z. B. ein Mod in zwei Dateien) nur einmal
    mods.sort_by(|a, b| (&a.source, &a.project_id).cmp(&(&b.source, &b.project_id)));
    mods.dedup_by(|a, b| a.source == b.source && a.project_id == b.project_id);
    mods.truncate(500);
    let known_files = if pack.is_none() { idx.files.keys().take(2000).cloned().collect() } else { Vec::new() };
    InstanceFile {
        schema: 1,
        name: inst.name.clone(),
        mc_version: inst.mc_version.clone(),
        loader: LinkLoader { kind: loader_kind_str(inst), version: inst.loader.version.clone() },
        pack,
        mods,
        client_pack,
        known_files,
    }
}

/// Client-Pack für den Vertrag: zuerst einer aus der Gruppe „Client“ (Vibey, NoRisk …), sonst das erste.
fn main_client_pack(ids: &[String]) -> Option<String> {
    ids.iter()
        .find(|id| crate::client_packs::def(id).is_some_and(|d| d.group == Some("client")))
        .or(ids.first())
        .cloned()
}

/// Vor jedem Start: `.vibe/instance.json` schreiben.
pub fn write_instance_file(state: &AppState, id: &str) -> AppResult<()> {
    let inst = state.instances.get(id)?;
    let idx = ContentIndex::load(&state.paths, id);
    let file = build_instance_file(&inst, &idx, main_client_pack(&crate::client_packs::installed_ids(state, id)));
    crate::util::write_json_atomic(&vibe_dir(state, id).join("instance.json"), &file)
}

// ------------------------------------------------------------------ session.json

/// Gültige, nicht veraltete `session.json` lesen.
pub fn read_session_file(path: &Path, now_secs: i64) -> Option<Session> {
    let bytes = std::fs::read(path).ok()?;
    if bytes.len() > 64 * 1024 {
        return None;
    }
    parse_session(&bytes, now_secs)
}

pub fn parse_session(bytes: &[u8], now_secs: i64) -> Option<Session> {
    let s: Session = serde_json::from_slice(bytes).ok()?;
    if s.schema != 1 || !matches!(s.state.as_str(), "menu" | "singleplayer" | "hosting" | "multiplayer") {
        return None;
    }
    // Sekunden oder (falls ein Client Millisekunden schreibt) Millisekunden
    let at = if s.updated_at > 100_000_000_000 { s.updated_at / 1000 } else { s.updated_at };
    if now_secs - at > SESSION_STALE_SECS {
        return None;
    }
    Some(s)
}

pub fn read_session(state: &AppState, id: &str) -> Option<Session> {
    read_session_file(&vibe_dir(state, id).join("session.json"), chrono::Utc::now().timestamp())
}

/// Ist `url` ein Spiel-Link unseres Backends (`<base>/j/<code>`)? Nur solche Links zeigen wir an.
/// Beim offiziellen Backend zählen auch `https://axolite.cc/j/<code>` und die alte Adresse
/// `https://vibe.henny.dev/j/<code>` (ältere Vibey Clients schreiben sie in `session.json`).
pub fn is_play_link_url(api_base: &str, url: &str) -> bool {
    if crate::domains::is_official(api_base) && crate::domains::official_invite_code(url).is_some() {
        return true;
    }
    let (Ok(b), Ok(u)) = (url::Url::parse(api_base), url::Url::parse(url)) else { return false };
    let scheme_ok = u.scheme() == "https" || (u.scheme() == "http" && b.scheme() == "http");
    let code = u.path().strip_prefix("/j/").unwrap_or("");
    scheme_ok && u.host_str() == b.host_str() && u.port_or_known_default() == b.port_or_known_default() && valid_code(code) && u.query().is_none()
}

// ------------------------------------------------------------------ Passende Instanz

/// Passt eine vorhandene Instanz zum Link? Gleiches Modpack in gleicher Version bzw. gleiche Version + Loader mit allen
/// Inhalten. Liefert die Anzahl fehlender Inhalte (bei Modpacks: zusätzliche Inhalte des Hosts).
pub fn match_score(link: &PlayLink, inst: &Instance, idx: &ContentIndex) -> Option<usize> {
    if inst.mc_version != link.mc_version || loader_kind_str(inst) != link.loader.kind {
        return None;
    }
    let missing = missing_mods(link, idx).len();
    match &link.pack {
        Some(p) => {
            let s = inst.source.as_ref()?;
            let kind_ok = matches!((s.kind, p.source.as_str()), (PackSourceKind::Modrinth, "modrinth") | (PackSourceKind::Curseforge, "curseforge"));
            (kind_ok && s.project_id.as_deref() == Some(p.project_id.as_str()) && s.version_id.as_deref() == Some(p.version_id.as_str())).then_some(missing)
        }
        None => {
            // Ohne Modpack: Loader-Version muss passen (wenn angegeben), und alle Inhalte müssen da sein
            if let (Some(want), Some(have)) = (&link.loader.version, &inst.loader.version) {
                if want != have {
                    return None;
                }
            }
            (missing == 0).then_some(0)
        }
    }
}

/// Inhalte aus dem Link, die in der Instanz fehlen.
pub fn missing_mods<'a>(link: &'a PlayLink, idx: &ContentIndex) -> Vec<&'a LinkMod> {
    link.mods
        .iter()
        .filter(|m| Source::parse(&m.source).is_some_and(|s| matches!(s, Source::Modrinth | Source::Curseforge) && !idx.has_project(s, &m.project_id)))
        .collect()
}

/// Beste passende Instanz (wenigste fehlende Inhalte, zuletzt gespielt).
pub fn find_match(state: &AppState, link: &PlayLink) -> Option<Instance> {
    let mut best: Option<(usize, i64, Instance)> = None;
    for inst in state.instances.list() {
        let idx = ContentIndex::load(&state.paths, &inst.id);
        let Some(missing) = match_score(link, &inst, &idx) else { continue };
        let played = inst.last_played.unwrap_or(0);
        if best.as_ref().map_or(true, |(m, p, _)| missing < *m || (missing == *m && played > *p)) {
            best = Some((missing, played, inst));
        }
    }
    best.map(|b| b.2)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::content::index::IndexEntry;
    use crate::instance::{Loader, LoaderKind, PackSource};

    fn inst(mc: &str, kind: LoaderKind, ver: Option<&str>, source: Option<PackSource>) -> Instance {
        let mut i: Instance = serde_json::from_value(serde_json::json!({
            "id": "a", "name": "Cobblemon Abenteuer", "mc_version": mc,
            "loader": { "kind": "fabric", "version": null }, "created_at": 0
        }))
        .unwrap();
        i.loader = Loader { kind, version: ver.map(str::to_string) };
        i.source = source;
        i
    }

    fn entry(source: Source, pid: &str, vid: &str) -> IndexEntry {
        serde_json::from_value(serde_json::json!({ "source": source.as_string(), "project_id": pid, "version_id": vid })).unwrap()
    }

    fn mrpack() -> PackSource {
        PackSource { kind: PackSourceKind::Modrinth, project_id: Some("abc".into()), version_id: Some("def".into()), name: Some("Cobblemon Official".into()), version_name: None }
    }

    fn link(pack: bool) -> PlayLink {
        serde_json::from_value(serde_json::json!({
            "code": "k3x9q2", "url": "https://axolite.cc/j/k3x9q2",
            "host": { "uuid": "u", "name": "Henny" }, "relay_host": "mossy-otter-27.axolite.cc",
            "mc_version": "1.21.1", "loader": { "kind": "fabric", "version": "0.16.9" },
            "pack": if pack { serde_json::json!({ "source": "modrinth", "project_id": "abc", "version_id": "def", "title": "Cobblemon Official" }) } else { serde_json::Value::Null },
            "mods": [ { "source": "modrinth", "project_id": "AANobbMI", "version_id": "xyz", "kind": "mod" } ],
            "client_pack": "vibey", "world_name": "Neue Welt", "max_players": 8, "active": true, "expires_at": "2026-11-19T12:00:00Z"
        }))
        .unwrap()
    }

    #[test]
    fn instance_file_contract() {
        let i = inst("1.21.1", LoaderKind::Fabric, Some("0.16.9"), Some(mrpack()));
        let mut idx = ContentIndex::default();
        idx.files.insert("mods/sodium.jar".into(), entry(Source::Modrinth, "AANobbMI", "xyz"));
        idx.files.insert("resourcepacks/fa.zip".into(), entry(Source::Curseforge, "123", "456"));
        idx.files.insert("mods/store.jar".into(), entry(Source::store("x"), "s", "v"));
        let f = build_instance_file(&i, &idx, Some("vibey".into()));
        let v = serde_json::to_value(&f).unwrap();
        assert_eq!(
            v,
            serde_json::json!({
                "schema": 1, "name": "Cobblemon Abenteuer", "mc_version": "1.21.1",
                "loader": { "kind": "fabric", "version": "0.16.9" },
                "pack": { "source": "modrinth", "project_id": "abc", "version_id": "def", "title": "Cobblemon Official" },
                "mods": [
                    { "source": "curseforge", "project_id": "123", "version_id": "456", "kind": "resourcepack" },
                    { "source": "modrinth", "project_id": "AANobbMI", "version_id": "xyz", "kind": "mod" }
                ],
                "client_pack": "vibey"
            })
        );
        // ohne Modpack: pack = null
        let i = inst("1.21.1", LoaderKind::Fabric, None, Some(PackSource { kind: PackSourceKind::Vibe, ..mrpack() }));
        assert!(build_instance_file(&i, &idx, None).pack.is_none());
    }

    #[test]
    fn session_parse() {
        let now = 1_795_040_030;
        let ok = br#"{ "schema": 1, "state": "hosting", "world": "Neue Welt", "play_link": "https://axolite.cc/j/k3x9q2", "players": 3, "max_players": 8, "updated_at": 1795040000 }"#;
        let s = parse_session(ok, now).unwrap();
        assert_eq!(s.state, "hosting");
        assert_eq!(s.players, Some(3));
        // veraltet
        assert!(parse_session(ok, now + 61).is_none());
        // unbekannter Zustand / Schema
        assert!(parse_session(br#"{ "schema": 1, "state": "afk", "updated_at": 1795040000 }"#, now).is_none());
        assert!(parse_session(br#"{ "schema": 2, "state": "menu", "updated_at": 1795040000 }"#, now).is_none());
        assert!(parse_session(b"kaputt", now).is_none());
        // Millisekunden
        assert!(parse_session(br#"{ "schema": 1, "state": "menu", "updated_at": 1795040000000 }"#, now).is_some());
    }

    #[test]
    fn link_urls_and_codes() {
        assert!(valid_code("k3x9q2"));
        assert!(valid_code("k3x9q2ab"));
        assert!(!valid_code("k3x9q"));
        assert!(!valid_code("k3x9q0"));
        assert!(!valid_code("K3X9Q2"));
        let base = "https://vibe.axolite.app";
        assert!(is_play_link_url(base, "https://axolite.cc/j/k3x9q2"));
        assert!(is_play_link_url(base, "https://vibe.axolite.app/j/k3x9q2"));
        // Alte Links (ältere Clients) gelten weiter
        assert!(is_play_link_url(base, "https://vibe.henny.dev/j/k3x9q2"));
        assert!(!is_play_link_url(base, "http://axolite.cc/j/k3x9q2"));
        assert!(!is_play_link_url(base, "http://vibe.henny.dev/j/k3x9q2"));
        assert!(!is_play_link_url(base, "https://evil.example/j/k3x9q2"));
        assert!(!is_play_link_url(base, "https://axolite.cc/p/k3x9q2"));
        assert!(!is_play_link_url(base, "https://axolite.cc/j/k3x9q2?x=1"));
        assert!(!is_play_link_url(base, "https://vibe.henny.dev/j/k3x9q2?x=1"));
        assert!(is_play_link_url("http://127.0.0.1:3000", "http://127.0.0.1:3000/j/k3x9q2"));
        // Lokales Test-Backend: keine Links des echten Backends
        assert!(!is_play_link_url("http://127.0.0.1:3000", "https://axolite.cc/j/k3x9q2"));
    }

    #[test]
    fn matching() {
        let l = link(true);
        let mut idx = ContentIndex::default();
        let pack_inst = inst("1.21.1", LoaderKind::Fabric, Some("0.16.8"), Some(mrpack()));
        // Modpack passt, ein Zusatz-Mod fehlt noch
        assert_eq!(match_score(&l, &pack_inst, &idx), Some(1));
        idx.files.insert("mods/sodium.jar".into(), entry(Source::Modrinth, "AANobbMI", "old"));
        assert_eq!(match_score(&l, &pack_inst, &idx), Some(0));
        // andere Pack-Version → keine Übereinstimmung
        let other = inst("1.21.1", LoaderKind::Fabric, None, Some(PackSource { version_id: Some("zzz".into()), ..mrpack() }));
        assert_eq!(match_score(&l, &other, &idx), None);
        // ohne Modpack: Version + Loader + alle Mods
        let l = link(false);
        let plain = inst("1.21.1", LoaderKind::Fabric, Some("0.16.9"), None);
        assert_eq!(match_score(&l, &plain, &idx), Some(0));
        assert_eq!(match_score(&l, &plain, &ContentIndex::default()), None);
        assert_eq!(match_score(&l, &inst("1.21.1", LoaderKind::Fabric, Some("0.15.0"), None), &idx), None);
        assert_eq!(match_score(&l, &inst("1.21.1", LoaderKind::Quilt, Some("0.16.9"), None), &idx), None);
        assert_eq!(match_score(&l, &inst("1.20.1", LoaderKind::Fabric, Some("0.16.9"), None), &idx), None);
    }
}
