//! Import aus dem NoRisk Client Launcher (NoRiskClient/noriskclient-launcher). Nur lesend.
//!
//! - Wurzel: Windows `%APPDATA%\norisk\NoRiskClientV3`, macOS `~/Library/Application Support/gg.norisk.NoRiskClientV3`,
//!   Linux `~/.local/share/noriskclientv3` (`directories::ProjectDirs("gg","norisk","NoRiskClientV3")`).
//! - Profile: SQLite `meta/app.db` (Tabellen `profiles`, `profile_mods`, `profile_disabled_norisk_mods`),
//!   ältere Versionen `profiles.json` (JSON-Liste). Die DB wird vor dem Lesen samt WAL kopiert.
//! - Spielordner: `<profiles>/<profile.path>`; mit `use_shared_minecraft_folder` (nicht in den Gruppen
//!   SERVER/MODPACKS) der Gruppenordner `noriskclient/new|legacy` bzw. `groups/<gruppe>`.
//!   `<profiles>` = `data/profiles` (Windows) bzw. `profiles`, oder `<custom_game_directory>/profiles`.
//! - Inhalte: Mods der Profil-Mod-Liste (Modrinth-Quelle) und des gewählten NoRisk-Packs
//!   (`norisk_modpacks.json`, `compatibility[mc][loader].identifier` = Modrinth-Versions-ID, mit
//!   `inheritsFrom`/`excludeMods`) werden per Modrinth installiert. Pack-Mods aus dem NoRisk-Maven bzw.
//!   per URL (NoRisk-Client-Mods, OptiFine) laufen nur im NoRisk-Launcher und werden nicht übernommen.
//!   Lose JARs aus `mods/` und `custom_mods/` werden kopiert, wenn sie zu Version/Loader passen.
//! - `accounts.json` (Tokens) wird nie gelesen.
use super::external::{norm, Found};
use super::{deps, index::ContentIndex, install, ContentKind, Source};
use crate::error::{AppError, AppResult};
use crate::instance::{InstallState, Instance, Loader, LoaderKind, PackSource, PackSourceKind};
use crate::state::AppState;
use crate::tasks::TaskHandle;
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};

pub const WARN_NRC: &str = "NoRisk-Client-Mods werden nicht übernommen – sie laufen nur im NoRisk-Launcher.";

/// Einträge auf oberster Ebene des Spielordners, die NICHT übernommen werden: NoRisk-eigene Daten (laufen nur im
/// NoRisk-Launcher), Mods (kommen über Modrinth bzw. als passende lose JARs) und Laufzeit-Reste.
/// Alles andere (Configs, Welten, Packs, Optionen, Daten anderer Mods wie `xaero/`, `journeymap/` …) kommt mit.
const SKIP: &[&str] = &[
    "mods",
    "custom_mods",
    "NoRiskClient",
    "optionsNRC.json",
    "logs",
    "crash-reports",
    "debug",
    "cache",
    "downloads",
    "backups",
    "usercache.json",
    "realms_persistence.json",
    "command_history.txt",
    ".fabric",
    ".mixin.out",
];

/// Wird dieser Eintrag (oberste Ebene) beim Import übersprungen?
fn skip_top(name: &str) -> bool {
    let l = name.to_ascii_lowercase();
    SKIP.iter().any(|s| s.eq_ignore_ascii_case(name)) || (l.starts_with("hs_err_pid") && l.ends_with(".log")) || l.ends_with(".dat_old")
}

/// Wurzelordner des NoRisk-Launchers (je OS).
pub fn default_root() -> Option<PathBuf> {
    let d = dirs::data_dir()?;
    Some(if cfg!(windows) {
        d.join("norisk").join("NoRiskClientV3")
    } else if cfg!(target_os = "macos") {
        d.join("gg.norisk.NoRiskClientV3")
    } else {
        d.join("noriskclientv3")
    })
}

pub fn roots() -> Vec<PathBuf> {
    default_root().into_iter().filter(|r| is_root(r)).collect()
}

pub fn is_root(r: &Path) -> bool {
    r.join("meta").join("app.db").is_file() || r.join("profiles.json").is_file() || r.join("norisk_modpacks.json").is_file()
}

/// `custom_game_directory` aus `launcher_config.json` (nur dieses Feld).
fn custom_dir(root: &Path) -> Option<PathBuf> {
    let v: Value = serde_json::from_slice(&std::fs::read(root.join("launcher_config.json")).ok()?).ok()?;
    v.get("custom_game_directory")?.as_str().filter(|s| !s.trim().is_empty()).map(PathBuf::from)
}

pub fn profiles_dir(root: &Path) -> PathBuf {
    if let Some(c) = custom_dir(root).filter(|c| c.join("profiles").is_dir()) {
        return c.join("profiles");
    }
    if root.join("data").join("profiles").is_dir() || cfg!(windows) {
        root.join("data").join("profiles")
    } else {
        root.join("profiles")
    }
}

// ------------------------------------------------------------------ Profile

#[derive(Debug, Clone, Default, PartialEq)]
pub struct NrMod {
    pub source_type: String,
    pub project_id: Option<String>,
    pub version_id: Option<String>,
    pub file_name: Option<String>,
    pub name: Option<String>,
    pub enabled: bool,
}

#[derive(Debug, Clone, Default)]
pub struct NrProfile {
    pub id: String,
    pub name: String,
    pub path: String,
    pub game_version: String,
    pub loader: String,
    pub loader_version: Option<String>,
    pub last_played_ms: Option<i64>,
    pub group: Option<String>,
    pub use_shared: bool,
    pub is_standard: bool,
    pub playtime_secs: u64,
    pub settings: Value,
    pub banner_url: Option<String>,
    pub pack_id: Option<String>,
    pub description: Option<String>,
    pub mods: Vec<NrMod>,
    /// (pack_id, mod_id, game_version, loader)
    pub disabled_pack_mods: Vec<(String, String, String, String)>,
}

/// Zeitstempel unbekannter Einheit (s/ms/Âµs/ns) nach ms.
pub fn to_ms(v: i64) -> Option<i64> {
    if v <= 0 {
        return None;
    }
    Some(if v >= 100_000_000_000_000_000 {
        v / 1_000_000
    } else if v >= 100_000_000_000_000 {
        v / 1_000
    } else if v >= 100_000_000_000 {
        v
    } else {
        v * 1000
    })
}

fn banner_url(v: &Value) -> Option<String> {
    let src = v.get("source")?;
    (src.get("type")?.as_str()? == "url").then(|| src.get("url").and_then(|u| u.as_str()).map(str::to_string)).flatten().filter(|u| u.starts_with("https://"))
}

fn parse_json<T: serde::de::DeserializeOwned>(s: Option<String>) -> Option<T> {
    s.and_then(|s| serde_json::from_str(&s).ok())
}

/// Profile aus der (kopierten) Datenbank.
pub fn read_db(c: &rusqlite::Connection) -> AppResult<Vec<NrProfile>> {
    let mut st = c
        .prepare(
            "SELECT id, name, path, game_version, loader, loader_version, last_played, selected_norisk_pack_id, group_name,
                    use_shared_minecraft_folder, is_standard_version, playtime_seconds, settings, banner, description
             FROM profiles",
        )
        .map_err(|e| AppError::msg(format!("NoRisk-Datenbank: {e}")))?;
    let mut list: Vec<NrProfile> = st
        .query_map([], |r| {
            Ok(NrProfile {
                id: r.get(0)?,
                name: r.get(1)?,
                path: r.get(2)?,
                game_version: r.get(3)?,
                loader: r.get(4)?,
                loader_version: r.get(5)?,
                last_played_ms: r.get::<_, Option<i64>>(6)?.and_then(to_ms),
                pack_id: r.get(7)?,
                group: r.get(8)?,
                use_shared: r.get::<_, i64>(9)? != 0,
                is_standard: r.get::<_, i64>(10)? != 0,
                playtime_secs: r.get::<_, i64>(11)?.max(0) as u64,
                settings: parse_json(r.get(12)?).unwrap_or(Value::Null),
                banner_url: parse_json::<Value>(r.get(13)?).as_ref().and_then(banner_url),
                description: r.get(14)?,
                ..Default::default()
            })
        })
        .map_err(|e| AppError::msg(e.to_string()))?
        .flatten()
        .collect();
    let mut mods: HashMap<String, Vec<NrMod>> = HashMap::new();
    if let Ok(mut st) = c.prepare("SELECT profile_id, source_type, project_id, version_id, file_name, enabled, display_name FROM profile_mods ORDER BY profile_id, ordinal") {
        if let Ok(rows) = st.query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                NrMod {
                    source_type: r.get(1)?,
                    project_id: r.get(2)?,
                    version_id: r.get(3)?,
                    file_name: r.get(4)?,
                    enabled: r.get::<_, i64>(5)? != 0,
                    name: r.get(6)?,
                },
            ))
        }) {
            for (pid, m) in rows.flatten() {
                mods.entry(pid).or_default().push(m);
            }
        }
    }
    let mut disabled: HashMap<String, Vec<(String, String, String, String)>> = HashMap::new();
    if let Ok(mut st) = c.prepare("SELECT profile_id, pack_id, mod_id, game_version, loader FROM profile_disabled_norisk_mods") {
        if let Ok(rows) = st.query_map([], |r| Ok((r.get::<_, String>(0)?, (r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)))) {
            for (pid, d) in rows.flatten() {
                disabled.entry(pid).or_default().push(d);
            }
        }
    }
    for p in list.iter_mut() {
        p.mods = mods.remove(&p.id).unwrap_or_default();
        p.disabled_pack_mods = disabled.remove(&p.id).unwrap_or_default();
    }
    Ok(list)
}

fn str_of(v: Option<&Value>) -> Option<String> {
    v.and_then(|x| x.as_str()).map(str::to_string).filter(|s| !s.is_empty())
}

/// Ältere Launcher-Versionen: `profiles.json` (Liste oder `{ profiles: {...} }`).
pub fn read_json(b: &[u8]) -> AppResult<Vec<NrProfile>> {
    let v: Value = serde_json::from_slice(b).map_err(|e| AppError::msg(format!("NoRisk-Profile unlesbar: {e}")))?;
    let items: Vec<Value> = match &v {
        Value::Array(a) => a.clone(),
        Value::Object(o) => match o.get("profiles") {
            Some(Value::Array(a)) => a.clone(),
            Some(Value::Object(m)) => m.values().cloned().collect(),
            _ => vec![],
        },
        _ => vec![],
    };
    Ok(items
        .iter()
        .filter_map(|p| {
            let last = match p.get("last_played") {
                Some(Value::Number(n)) => n.as_i64().and_then(to_ms),
                Some(Value::String(s)) => chrono::DateTime::parse_from_rfc3339(s).ok().map(|d| d.timestamp_millis()),
                _ => None,
            };
            let mods = p
                .get("mods")
                .and_then(|m| m.as_array())
                .map(|a| {
                    a.iter()
                        .map(|m| {
                            let src = m.get("source").cloned().unwrap_or(Value::Null);
                            NrMod {
                                source_type: str_of(src.get("type")).unwrap_or_default(),
                                project_id: str_of(src.get("project_id")),
                                version_id: str_of(src.get("version_id")),
                                file_name: str_of(src.get("file_name")),
                                name: str_of(m.get("display_name")),
                                enabled: m.get("enabled").and_then(|e| e.as_bool()).unwrap_or(true),
                            }
                        })
                        .collect()
                })
                .unwrap_or_default();
            let disabled = p
                .get("disabled_norisk_mods_detailed")
                .and_then(|d| d.as_array())
                .map(|a| {
                    a.iter()
                        .filter_map(|d| Some((str_of(d.get("pack_id"))?, str_of(d.get("mod_id"))?, str_of(d.get("game_version"))?, str_of(d.get("loader"))?)))
                        .collect()
                })
                .unwrap_or_default();
            Some(NrProfile {
                id: str_of(p.get("id"))?,
                name: str_of(p.get("name")).unwrap_or_default(),
                path: str_of(p.get("path")).unwrap_or_default(),
                game_version: str_of(p.get("game_version")).unwrap_or_default(),
                loader: str_of(p.get("loader")).unwrap_or_else(|| "vanilla".into()),
                loader_version: str_of(p.get("loader_version")),
                last_played_ms: last,
                group: str_of(p.get("group")),
                use_shared: p.get("use_shared_minecraft_folder").and_then(|x| x.as_bool()).unwrap_or(false),
                is_standard: p.get("is_standard_version").and_then(|x| x.as_bool()).unwrap_or(false),
                playtime_secs: p.get("playtime_seconds").and_then(|x| x.as_u64()).unwrap_or(0),
                settings: p.get("settings").cloned().unwrap_or(Value::Null),
                banner_url: p.get("banner").and_then(banner_url),
                pack_id: str_of(p.get("selected_norisk_pack_id")),
                description: str_of(p.get("description")),
                mods,
                disabled_pack_mods: disabled,
            })
        })
        .collect())
}

/// Alle Profile der Wurzel (DB bevorzugt, sonst profiles.json).
pub fn read_profiles(root: &Path, tmp: &Path) -> AppResult<Vec<NrProfile>> {
    let mut dbs = vec![root.join("meta")];
    if let Some(c) = custom_dir(root) {
        dbs.push(c.join("meta"));
        dbs.push(c.clone());
    }
    for d in dbs {
        if d.join("app.db").is_file() {
            if let Some(c) = super::external::open_db_copy_named(&d, tmp, "norisk-db") {
                return read_db(&c);
            }
        }
    }
    match std::fs::read(root.join("profiles.json")) {
        Ok(b) => read_json(&b),
        Err(_) => Ok(vec![]),
    }
}

// ------------------------------------------------------------------ Spielordner

fn is_legacy(mc: &str) -> bool {
    // < 1.13
    let mut it = mc.split('.').map(|x| x.parse::<u32>().unwrap_or(0));
    matches!((it.next(), it.next()), (Some(1), Some(minor)) if minor < 13)
}

fn sanitize(s: &str) -> String {
    s.to_lowercase().chars().map(|c| if c.is_control() || "<>:\"/\\|?*".contains(c) { '_' } else { c }).collect::<String>().trim().trim_end_matches('.').to_string()
}

/// Spielordner wie im NoRisk-Launcher (`calculate_instance_path_for_profile`).
pub fn game_dir(profiles: &Path, p: &NrProfile) -> PathBuf {
    let isolated_group = p.group.as_deref().is_some_and(|g| matches!(g.to_lowercase().as_str(), "server" | "modpacks"));
    if p.use_shared && !isolated_group {
        if let Some(g) = &p.group {
            let gl = g.to_lowercase();
            if gl == "nrc" || gl == "noriskclient" || gl == "norisk client" {
                return profiles.join("noriskclient").join(if is_legacy(&p.game_version) { "legacy" } else { "new" });
            }
            return profiles.join("groups").join(sanitize(g));
        }
    }
    let mut d = profiles.to_path_buf();
    for seg in p.path.split('/').filter(|s| !s.is_empty() && *s != "..") {
        d.push(seg);
    }
    d
}

// ------------------------------------------------------------------ Packs

/// Pack-Mod: installierbar (Modrinth-Version) oder nicht (NoRisk-Maven, URL …).
#[derive(Debug, Clone, PartialEq)]
pub enum PackMod {
    Modrinth { id: String, name: String, project_id: String, version_id: String },
    Skipped { id: String, name: String },
}

fn resolve_pack(packs: &serde_json::Map<String, Value>, id: &str, visited: &mut HashSet<String>) -> Vec<Value> {
    if !visited.insert(id.to_string()) {
        return vec![];
    }
    let Some(def) = packs.get(id) else { return vec![] };
    let mut map: Vec<(String, Value)> = Vec::new();
    let put = |m: Value, map: &mut Vec<(String, Value)>| {
        let mid = m.get("id").and_then(|x| x.as_str()).unwrap_or_default().to_string();
        map.retain(|(k, _)| *k != mid);
        map.push((mid, m));
    };
    if let Some(parents) = def.get("inheritsFrom").and_then(|x| x.as_array()) {
        for p in parents.iter().filter_map(|p| p.as_str()) {
            for m in resolve_pack(packs, p, visited) {
                put(m, &mut map);
            }
        }
    }
    for m in def.get("mods").and_then(|x| x.as_array()).cloned().unwrap_or_default() {
        put(m, &mut map);
    }
    if let Some(ex) = def.get("excludeMods").and_then(|x| x.as_array()) {
        let ex: HashSet<&str> = ex.iter().filter_map(|e| e.as_str()).collect();
        map.retain(|(k, _)| !ex.contains(k.as_str()));
    }
    visited.remove(id);
    map.into_iter().map(|(_, m)| m).collect()
}

/// Mods eines NoRisk-Packs für Version + Loader (ohne vom Profil deaktivierte).
pub fn pack_mods(packs_json: &Value, p: &NrProfile) -> Vec<PackMod> {
    let Some(pack_id) = &p.pack_id else { return vec![] };
    let Some(packs) = packs_json.get("packs").and_then(|x| x.as_object()) else { return vec![] };
    let loader = p.loader.to_lowercase();
    let disabled: HashSet<&str> = p
        .disabled_pack_mods
        .iter()
        .filter(|(pk, _, gv, l)| pk == pack_id && *gv == p.game_version && l.eq_ignore_ascii_case(&loader))
        .map(|(_, m, _, _)| m.as_str())
        .collect();
    let mut out = Vec::new();
    for m in resolve_pack(packs, pack_id, &mut HashSet::new()) {
        let id = m.get("id").and_then(|x| x.as_str()).unwrap_or_default().to_string();
        if disabled.contains(id.as_str()) {
            continue;
        }
        let name = m.get("displayName").and_then(|x| x.as_str()).unwrap_or(&id).to_string();
        // Gibt es diesen Mod für Version + Loader?
        let Some(compat) = m.get("compatibility").and_then(|c| c.get(&p.game_version)).and_then(|c| c.get(&loader)) else { continue };
        let src = m.get("source").cloned().unwrap_or(Value::Null);
        let ident = compat.get("identifier").and_then(|x| x.as_str()).map(str::to_string);
        match (src.get("type").and_then(|x| x.as_str()), str_of(src.get("projectId")), ident) {
            (Some("modrinth"), Some(project_id), Some(version_id)) => out.push(PackMod::Modrinth { id, name, project_id, version_id }),
            _ => out.push(PackMod::Skipped { id, name }),
        }
    }
    out
}

// ------------------------------------------------------------------ Plan + Scan

/// Was beim Import passiert (wird beim Scan berechnet, beim Import erneut gelesen).
#[derive(Debug, Clone, Default)]
pub struct Plan {
    pub profile_id: String,
    /// (project_id, version_id, enabled)
    pub modrinth: Vec<(String, String, bool)>,
    /// Nicht übernommene NoRisk-eigene Mods (Namen)
    pub skipped: Vec<String>,
    /// Lose JARs (Quelle, Zielname)
    pub jars: Vec<(PathBuf, String)>,
    pub group: Option<String>,
    pub banner_url: Option<String>,
    pub settings: Value,
    pub description: Option<String>,
}

fn is_nrc_id(id: &str) -> bool {
    let l = id.to_ascii_lowercase();
    l.starts_with("nrc") || l.starts_with("norisk")
}

/// Lose JARs aus `mods/` und `custom_mods/`, die zu Version + Loader passen und keine NoRisk-Mods sind.
pub fn loose_jars(game: &Path, mc: &str, loader: LoaderKind, icons: &Path) -> (Vec<(PathBuf, String)>, Vec<String>) {
    let mut ok = Vec::new();
    let mut skipped = Vec::new();
    let mut seen = HashSet::new();
    for sub in ["mods", "custom_mods"] {
        let Ok(rd) = std::fs::read_dir(game.join(sub)) else { continue };
        let mut files: Vec<PathBuf> = rd.flatten().map(|e| e.path()).filter(|p| p.is_file()).collect();
        files.sort();
        for f in files {
            let name = f.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
            let lower = name.to_ascii_lowercase();
            if !(lower.ends_with(".jar") || lower.ends_with(".jar.disabled")) || !seen.insert(lower.trim_end_matches(".disabled").to_string()) {
                continue;
            }
            let meta = super::meta::read_entry(&f, ContentKind::Mod, icons);
            let id = meta.mod_id.clone().unwrap_or_default();
            if is_nrc_id(&id) || lower.starts_with("nrc-") || lower.starts_with("norisk") {
                skipped.push(meta.name.clone().unwrap_or(name));
                continue;
            }
            let loader_ok = match meta.loader.as_deref().and_then(LoaderKind::parse) {
                Some(l) => l == loader || (loader == LoaderKind::Quilt && l == LoaderKind::Fabric),
                None => true,
            };
            let mc_ok = meta.deps.iter().find(|d| d.id == "minecraft").and_then(|d| d.range.as_deref()).and_then(|r| deps::satisfies(r, mc)).unwrap_or(true);
            if loader_ok && mc_ok {
                ok.push((f, name));
            }
        }
    }
    (ok, skipped)
}

fn modrinth_version_name(m: &NrMod) -> String {
    m.name.clone().or_else(|| m.file_name.clone()).or_else(|| m.project_id.clone()).unwrap_or_default()
}

pub fn plan_for(p: &NrProfile, packs: &Value, game: &Path, icons: &Path) -> Plan {
    let mut plan = Plan {
        profile_id: p.id.clone(),
        group: p.group.clone(),
        banner_url: p.banner_url.clone(),
        settings: p.settings.clone(),
        description: p.description.clone(),
        ..Default::default()
    };
    let mut have: HashSet<String> = HashSet::new();
    for m in &p.mods {
        match (m.source_type.as_str(), &m.project_id, &m.version_id) {
            ("modrinth", Some(pid), Some(vid)) => {
                if have.insert(pid.clone()) {
                    plan.modrinth.push((pid.clone(), vid.clone(), m.enabled));
                }
            }
            _ => plan.skipped.push(modrinth_version_name(m)),
        }
    }
    for pm in pack_mods(packs, p) {
        match pm {
            PackMod::Modrinth { project_id, version_id, .. } => {
                if have.insert(project_id.clone()) {
                    plan.modrinth.push((project_id, version_id, true));
                }
            }
            PackMod::Skipped { name, .. } => plan.skipped.push(name),
        }
    }
    let loader = LoaderKind::parse(&p.loader).unwrap_or(LoaderKind::Vanilla);
    if loader != LoaderKind::Vanilla {
        let (jars, skipped) = loose_jars(game, &p.game_version, loader, icons);
        plan.jars = jars;
        plan.skipped.extend(skipped);
    }
    plan
}

/// Kennung je Profil: `<spielordner>#<profil-id>` (mehrere Profile teilen sich einen Ordner).
pub fn source_path(game: &Path, id: &str) -> String {
    format!("{}#{id}", game.to_string_lossy())
}

pub fn split_source(s: &str) -> (&str, Option<&str>) {
    match s.rsplit_once('#') {
        Some((a, b)) if !b.is_empty() && !b.contains(['\\', '/']) => (a, Some(b)),
        _ => (s, None),
    }
}

fn read_packs(root: &Path) -> Value {
    std::fs::read(root.join("norisk_modpacks.json")).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or(Value::Null)
}

/// `loaderPolicy` eines Packs samt Eltern (Kind überschreibt Eltern), wie `resolve_loader_policy_for_pack`.
fn merged_policy(packs: &serde_json::Map<String, Value>, id: &str, visited: &mut HashSet<String>) -> (HashMap<String, Value>, HashMap<String, HashMap<String, Value>>) {
    let mut default: HashMap<String, Value> = HashMap::new();
    let mut by_mc: HashMap<String, HashMap<String, Value>> = HashMap::new();
    if !visited.insert(id.to_string()) {
        return (default, by_mc);
    }
    let Some(def) = packs.get(id) else { return (default, by_mc) };
    let merge = |d: HashMap<String, Value>, b: HashMap<String, HashMap<String, Value>>, default: &mut HashMap<String, Value>, by_mc: &mut HashMap<String, HashMap<String, Value>>| {
        default.extend(d);
        for (pat, m) in b {
            by_mc.entry(pat).or_default().extend(m);
        }
    };
    for parent in def.get("inheritsFrom").and_then(|x| x.as_array()).into_iter().flatten().filter_map(|p| p.as_str()) {
        let (d, b) = merged_policy(packs, parent, visited);
        merge(d, b, &mut default, &mut by_mc);
    }
    if let Some(pol) = def.get("loaderPolicy").filter(|p| p.is_object()) {
        let d: HashMap<String, Value> = pol.get("default").and_then(|x| x.as_object()).map(|o| o.clone().into_iter().collect()).unwrap_or_default();
        let b: HashMap<String, HashMap<String, Value>> = pol
            .get("byMinecraft")
            .and_then(|x| x.as_object())
            .map(|o| o.iter().map(|(k, v)| (k.clone(), v.as_object().map(|m| m.clone().into_iter().collect()).unwrap_or_default())).collect())
            .unwrap_or_default();
        merge(d, b, &mut default, &mut by_mc);
    }
    visited.remove(id);
    (default, by_mc)
}

/// Loader-Version laut Pack-Policy: exakte MC-Version, dann `x.y.*`, dann Präfix, dann `default`.
pub fn pack_loader_version(packs_json: &Value, pack_id: &str, mc: &str, loader: &str) -> Option<String> {
    let packs = packs_json.get("packs")?.as_object()?;
    let (default, by_mc) = merged_policy(packs, pack_id, &mut HashSet::new());
    let ver = |m: &HashMap<String, Value>| m.get(loader).and_then(|s| s.get("version")).and_then(|v| v.as_str()).map(str::to_string);
    if let Some(v) = by_mc.get(mc).and_then(ver) {
        return Some(v);
    }
    let mut pats: Vec<&String> = by_mc.keys().collect();
    pats.sort();
    for p in &pats {
        if let Some(prefix) = p.strip_suffix(".*") {
            if mc.starts_with(prefix) {
                if let Some(v) = ver(&by_mc[*p]) {
                    return Some(v);
                }
            }
        }
    }
    for p in &pats {
        if !p.ends_with(".*") && mc.starts_with(p.as_str()) {
            if let Some(v) = ver(&by_mc[*p]) {
                return Some(v);
            }
        }
    }
    ver(&default)
}

/// Loader + Version wie im NoRisk-Launcher: Nutzer-Override > Pack-Policy > Profilangabe.
pub fn loader_of(p: &NrProfile, packs: &Value) -> Loader {
    let kind = LoaderKind::parse(&p.loader).unwrap_or(LoaderKind::Vanilla);
    if kind == LoaderKind::Vanilla {
        return Loader { kind, version: None };
    }
    let key = p.loader.to_lowercase();
    let s = &p.settings;
    let over = if s.get("use_overwrite_loader_version").and_then(|x| x.as_bool()) == Some(true) {
        match s.get("overwrite_loader_versions").and_then(|m| m.as_object()).filter(|m| !m.is_empty()) {
            Some(m) => str_of(m.get(&key)),
            None => str_of(s.get("overwrite_loader_version")),
        }
    } else {
        None
    };
    let policy = p.pack_id.as_deref().and_then(|id| pack_loader_version(packs, id, &p.game_version, &key));
    Loader { kind, version: over.or(policy).or_else(|| p.loader_version.clone()).filter(|v| !v.is_empty()) }
}

pub fn scan(root: &Path, tmp: &Path, icons: &Path) -> Vec<Found> {
    let profiles = match read_profiles(root, tmp) {
        Ok(p) => p,
        Err(e) => {
            tracing::warn!("NoRisk-Profile nicht lesbar: {e}");
            return vec![];
        }
    };
    let packs = read_packs(root);
    let pdir = profiles_dir(root);
    profiles
        .iter()
        .map(|p| {
            let game = game_dir(&pdir, p);
            let plan = plan_for(p, &packs, &game, icons);
            let mut f = super::external::found(
                if p.name.trim().is_empty() { p.id.clone() } else { p.name.clone() },
                game.clone(),
                Path::new(&source_path(&game, &p.id)),
                p.game_version.clone(),
                loader_of(p, &packs),
                None,
            );
            f.info.icon = p.banner_url.clone();
            f.info.mod_count = (plan.modrinth.len() + plan.jars.len()) as u32;
            f.info.last_played = p.last_played_ms;
            f.info.play_time_secs = Some(p.playtime_secs).filter(|v| *v > 0);
            if !plan.skipped.is_empty() {
                f.info.warning = Some(format!("{WARN_NRC} ({})", plan.skipped.len()));
            }
            f.settings = super::extsettings::norisk(&plan.settings, plan.group.clone(), plan.description.clone());
            f.norisk = Some(plan);
            f
        })
        .collect()
}

/// Ein Profil anhand seiner Kennung erneut lesen.
pub fn describe(source: &str, tmp: &Path, icons: &Path) -> Option<Found> {
    let me = norm(source);
    roots_for(source).iter().find_map(|r| scan(r, tmp, icons).into_iter().find(|f| norm(&f.info.source_path) == me))
}

/// Mögliche Wurzeln zu einer Profil-Kennung (aus dem Pfad abgeleitet, dann der Standardort).
pub fn roots_for(source: &str) -> Vec<PathBuf> {
    let mut roots = roots();
    // Wurzel aus dem Pfad ableiten (…\data\profiles\… bzw. …\profiles\…)
    let (dir, _) = split_source(source);
    let mut cur = Path::new(dir).parent();
    while let Some(c) = cur {
        if is_root(c) && !roots.iter().any(|r| norm(&r.to_string_lossy()) == norm(&c.to_string_lossy())) {
            roots.insert(0, c.to_path_buf());
        }
        cur = c.parent();
    }
    roots
}

// ------------------------------------------------------------------ Import

#[allow(clippy::too_many_arguments)]
pub async fn run_import(
    state: AppState,
    task: TaskHandle,
    f: Found,
    source_path: String,
    name: Option<String>,
    mc_version: Option<String>,
    loader: Option<Loader>,
    keys: HashSet<String>,
) -> AppResult<()> {
    let plan = f.norisk.clone().unwrap_or_default();
    let mc = mc_version.filter(|v| !v.trim().is_empty()).unwrap_or_else(|| f.info.mc_version.clone());
    if mc.trim().is_empty() {
        return Err(AppError::Invalid(format!("{}: Minecraft-Version unbekannt – bitte angeben", f.info.name)));
    }
    let loader = loader.unwrap_or_else(|| f.info.loader.clone());
    let name = name.filter(|n| !n.trim().is_empty()).unwrap_or_else(|| f.info.name.clone());
    task.set_title(format!("{name} übernehmen"));

    let mut inst = Instance {
        id: String::new(),
        name: name.clone(),
        icon: None,
        accent: None,
        group: None,
        mc_version: mc,
        loader,
        java: Default::default(),
        window: Default::default(),
        hooks: Default::default(),
        source: Some(PackSource { kind: PackSourceKind::Local, project_id: None, version_id: None, name: Some("NoRisk Client".into()), version_name: None }),
        install_state: InstallState::NotInstalled,
        version_id: None,
        created_at: crate::util::now_ms(),
        last_played: f.info.last_played,
        play_time_secs: f.info.play_time_secs.unwrap_or(0),
        notes: None,
        auto_update_content: None,
        bedrock: None,
    };
    let (prepared, java_note) = super::extsettings::prepare(&state.settings(), &f.settings, &inst.mc_version, keys.contains("java")).await;
    super::extsettings::apply(&mut inst, &prepared, &keys);
    let inst = state.instances.insert_new(inst)?;
    task.set_instance(inst.id.clone());

    let res: AppResult<Vec<String>> = async {
        super::external::write_mark(&state, &inst.id, super::LauncherKind::Norisk, &source_path)?;
        let dst = state.paths.game_dir(&inst.id);
        // 1. Spieldaten (alles außer SKIP) + lose JARs kopieren
        task.stage("Kopiere Spieldaten …", Some(0.0));
        let src = f.game_dir.clone();
        let jars = plan.jars.clone();
        let t2 = task.clone();
        let d2 = dst.clone();
        let copied = tokio::task::spawn_blocking(move || -> AppResult<u64> {
            let mut files: Vec<(PathBuf, PathBuf)> = Vec::new();
            let mut top: Vec<std::fs::DirEntry> = std::fs::read_dir(&src)?.flatten().collect();
            top.sort_by_key(|e| e.file_name());
            for e in top {
                let name = e.file_name().to_string_lossy().to_string();
                if skip_top(&name) {
                    continue;
                }
                let p = e.path();
                if p.is_file() {
                    files.push((p, PathBuf::from(&name)));
                } else if p.is_dir() {
                    for w in walkdir::WalkDir::new(&p).follow_links(false).into_iter().flatten().filter(|w| w.file_type().is_file()) {
                        if let Ok(rel) = w.path().strip_prefix(&src) {
                            files.push((w.path().to_path_buf(), rel.to_path_buf()));
                        }
                    }
                }
            }
            for (j, n) in &jars {
                files.push((j.clone(), Path::new("mods").join(n)));
            }
            let total = files.len().max(1);
            for (i, (from, rel)) in files.iter().enumerate() {
                if i % 32 == 0 {
                    t2.check()?;
                    t2.progress(i as f64 / total as f64 * 0.5);
                }
                let to = d2.join(rel);
                if let Some(p) = to.parent() {
                    std::fs::create_dir_all(p)?;
                }
                std::fs::copy(from, &to).map_err(|e| AppError::msg(format!("{} konnte nicht kopiert werden: {e}", rel.display())))?;
            }
            Ok(files.len() as u64)
        })
        .await??;
        task.message(format!("{copied} Dateien übernommen"));

        // 2. Mods per Modrinth installieren
        let mut warnings = Vec::new();
        if !plan.modrinth.is_empty() && inst.loader.kind != LoaderKind::Vanilla {
            task.stage(format!("Installiere {} Mods von Modrinth …", plan.modrinth.len()), Some(0.5));
            let idx = ContentIndex::load(&state.paths, &inst.id);
            let mut all: Vec<install::Planned> = Vec::new();
            let mut seen: HashSet<String> = HashSet::new();
            for (pid, vid, _) in &plan.modrinth {
                task.check()?;
                match install::plan(&state, &inst, &idx, vec![(Source::Modrinth, pid.clone(), Some(vid.clone()))], &mut warnings).await {
                    Ok(list) => {
                        for p in list {
                            if seen.insert(p.brief.id.clone()) {
                                all.push(p);
                            }
                        }
                    }
                    Err(e) => warnings.push(format!("{pid}: {e}")),
                }
            }
            install::apply(&state, &inst, all, &task.sub(0.5, 0.95)).await?;
            // Im NoRisk-Launcher deaktivierte Mods auch hier deaktivieren
            let idx = ContentIndex::load(&state.paths, &inst.id);
            for (pid, _, enabled) in &plan.modrinth {
                if *enabled {
                    continue;
                }
                for k in idx.keys_of_project(Source::Modrinth, pid) {
                    let p = dst.join(&k);
                    if p.is_file() {
                        let mut d = p.clone().into_os_string();
                        d.push(".disabled");
                        let _ = std::fs::rename(&p, PathBuf::from(d));
                    }
                }
            }
        }
        // 3. Icon (Banner-URL)
        if let Some(url) = &plan.banner_url {
            match state.net.get_bytes(url).await {
                Ok(b) if b.len() < 4 * 1024 * 1024 => {
                    if let Err(e) = super::import::set_icon_bytes(&state, &inst.id, &b).await {
                        tracing::warn!("NoRisk-Icon nicht übernommen: {e}");
                    }
                }
                Ok(_) => {}
                Err(e) => tracing::warn!("NoRisk-Icon nicht ladbar: {e}"),
            }
        }
        Ok(warnings)
    }
    .await;
    match res {
        Ok(warnings) => {
            let mut msg = format!("{} Mods von Modrinth, {} lokale JARs übernommen", plan.modrinth.len(), plan.jars.len());
            if !plan.skipped.is_empty() {
                msg.push_str(&format!(", {} NoRisk-Mods ausgelassen", plan.skipped.len()));
            }
            if let Some(n) = &java_note {
                msg.push_str(&format!(" · {n}"));
            }
            if let Some(w) = warnings.first() {
                msg.push_str(&format!(" – Hinweis: {w}"));
            }
            task.message(msg);
            state.content.emit_changed(&inst.id);
            Ok(())
        }
        Err(e) => {
            if let Err(de) = state.instances.delete(&inst.id) {
                tracing::warn!("Halb importierte Instanz {} nicht entfernt: {de}", inst.id);
            }
            Err(e)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixtures() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("src").join("content").join("testdata").join("norisk")
    }

    fn tmp() -> PathBuf {
        let d = std::env::temp_dir().join(format!("vl-nr-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    /// Wurzel wie im NoRisk-Launcher: meta/app.db (Schema aus migrations/0002_profiles.sql), Packs, Spielordner.
    fn make_root() -> PathBuf {
        let root = tmp();
        std::fs::create_dir_all(root.join("meta")).unwrap();
        std::fs::copy(fixtures().join("norisk_modpacks.json"), root.join("norisk_modpacks.json")).unwrap();
        let c = rusqlite::Connection::open(root.join("meta/app.db")).unwrap();
        c.execute_batch(&std::fs::read_to_string(fixtures().join("app.sql")).unwrap()).unwrap();
        drop(c);
        let g = root.join("data/profiles/noriskclient/new");
        std::fs::create_dir_all(g.join("mods/nrc-26.3-fabric")).unwrap();
        std::fs::create_dir_all(g.join("saves/Welt/region")).unwrap();
        std::fs::create_dir_all(g.join("NoRiskClient")).unwrap();
        std::fs::write(g.join("options.txt"), "fov:0.5\n").unwrap();
        std::fs::write(g.join("saves/Welt/level.dat"), "x").unwrap();
        // lose JARs: passend, falsche MC-Version, NoRisk-Mod
        let jar = |p: &Path, json: &str| {
            let f = std::fs::File::create(p).unwrap();
            let mut w = zip::ZipWriter::new(f);
            w.start_file("fabric.mod.json", zip::write::SimpleFileOptions::default()).unwrap();
            use std::io::Write;
            w.write_all(json.as_bytes()).unwrap();
            w.finish().unwrap();
        };
        jar(&g.join("mods/ok-mod.jar"), r#"{"id":"okmod","name":"OK Mod","version":"1","depends":{"minecraft":">=26.3"}}"#);
        jar(&g.join("mods/old-mod.jar"), r#"{"id":"oldmod","name":"Old","version":"1","depends":{"minecraft":"~1.21.5"}}"#);
        jar(&g.join("mods/nrc-thing.jar"), r#"{"id":"nrc-thing","name":"NRC Thing","version":"1"}"#);
        std::fs::create_dir_all(root.join("data/profiles/groups/meine gruppe")).unwrap();
        root
    }

    #[test]
    fn times() {
        assert_eq!(to_ms(1_794_687_657_678_095_000), Some(1_794_687_657_678));
        assert_eq!(to_ms(1_794_687_657_678), Some(1_794_687_657_678));
        assert_eq!(to_ms(1_794_687_657), Some(1_794_687_657_000));
        assert_eq!(to_ms(0), None);
    }

    #[test]
    fn game_dirs() {
        let pd = Path::new("P");
        let mut p = NrProfile { path: "noriskclient/hypixel".into(), game_version: "1.21.5".into(), group: Some("SERVER".into()), use_shared: true, ..Default::default() };
        // SERVER ist isoliert -> eigener Pfad trotz shared
        assert_eq!(game_dir(pd, &p), pd.join("noriskclient").join("hypixel"));
        p.group = Some("NORISK CLIENT".into());
        assert_eq!(game_dir(pd, &p), pd.join("noriskclient").join("new"));
        p.game_version = "1.8.9".into();
        assert_eq!(game_dir(pd, &p), pd.join("noriskclient").join("legacy"));
        p.group = Some("Meine Gruppe".into());
        assert_eq!(game_dir(pd, &p), pd.join("groups").join("meine gruppe"));
        p.use_shared = false;
        assert_eq!(game_dir(pd, &p), pd.join("noriskclient").join("hypixel"));
        p.path = "../../evil".into();
        assert_eq!(game_dir(pd, &p), pd.join("evil"));
    }

    #[test]
    fn copies_mod_data_but_not_norisk_internals() {
        for keep in ["config", "saves", "xaero", "journeymap", "options.txt", "servers.dat", "data", "schematics"] {
            assert!(!skip_top(keep), "{keep} muss mitkommen");
        }
        for skip in ["mods", "custom_mods", "NoRiskClient", "noriskclient", "optionsNRC.json", "logs", "crash-reports", "hs_err_pid31768.log", "servers.dat_old", "usercache.json"] {
            assert!(skip_top(skip), "{skip} darf nicht mitkommen");
        }
    }

    #[test]
    fn packs_inherit_exclude_disable() {
        let packs: Value = serde_json::from_slice(&std::fs::read(fixtures().join("norisk_modpacks.json")).unwrap()).unwrap();
        let p = NrProfile {
            game_version: "26.3".into(),
            loader: "fabric".into(),
            pack_id: Some("child".into()),
            disabled_pack_mods: vec![("child".into(), "appleskin".into(), "26.3".into(), "fabric".into())],
            ..Default::default()
        };
        let mods = pack_mods(&packs, &p);
        let ids: Vec<String> = mods
            .iter()
            .map(|m| match m {
                PackMod::Modrinth { id, version_id, .. } => format!("{id}={version_id}"),
                PackMod::Skipped { id, .. } => format!("{id}!"),
            })
            .collect();
        // nrc-client (maven) + optifine (url) übersprungen, sodium aus dem Eltern-Pack überschrieben,
        // lithium per excludeMods entfernt, appleskin vom Profil deaktiviert, iris ohne 26.3-Eintrag
        assert!(ids.contains(&"nrc-client!".to_string()), "{ids:?}");
        assert!(ids.contains(&"optifine!".to_string()));
        assert!(ids.contains(&"sodium=CHILDVER".to_string()));
        assert!(ids.contains(&"fabric-api=FAPI263".to_string()));
        assert!(!ids.iter().any(|i| i.starts_with("lithium") || i.starts_with("appleskin") || i.starts_with("iris")));
    }

    #[test]
    fn loader_policy() {
        let packs: Value = serde_json::from_slice(&std::fs::read(fixtures().join("norisk_modpacks.json")).unwrap()).unwrap();
        assert_eq!(pack_loader_version(&packs, "child", "26.3", "fabric").as_deref(), Some("0.20.1"));
        assert_eq!(pack_loader_version(&packs, "child", "1.21.5", "fabric").as_deref(), Some("0.18.0"));
        assert_eq!(pack_loader_version(&packs, "child", "1.21", "fabric").as_deref(), Some("0.17.0"));
        assert_eq!(pack_loader_version(&packs, "child", "26.3", "forge"), None);
        let mut p = NrProfile { loader: "fabric".into(), loader_version: Some("0.19.5".into()), game_version: "26.3".into(), pack_id: Some("child".into()), ..Default::default() };
        assert_eq!(loader_of(&p, &packs).version.as_deref(), Some("0.20.1"));
        p.settings = serde_json::json!({"use_overwrite_loader_version": true, "overwrite_loader_versions": {"fabric": "0.21.0"}, "overwrite_loader_version": "0.1"});
        assert_eq!(loader_of(&p, &packs).version.as_deref(), Some("0.21.0"));
        p.pack_id = None;
        p.settings = Value::Null;
        assert_eq!(loader_of(&p, &packs).version.as_deref(), Some("0.19.5"));
    }

    #[test]
    fn scan_fixture_root() {
        let root = make_root();
        let icons = root.join("icons");
        let found = scan(&root, &root.join("tmp"), &icons);
        assert_eq!(found.len(), 3);
        let main = found.iter().find(|f| f.info.name == "NRC 26.3").unwrap();
        assert_eq!(main.info.mc_version, "26.3");
        // Pack-Policy (geerbt vom Eltern-Pack) schlägt die Profilangabe 0.19.5
        assert_eq!(main.info.loader, Loader { kind: LoaderKind::Fabric, version: Some("0.20.1".into()) });
        assert_eq!(main.info.last_played, Some(1_793_476_074_136));
        assert_eq!(main.info.play_time_secs, Some(291_260));
        assert!(main.info.warning.as_deref().unwrap().contains("NoRisk"));
        assert!(main.info.source_path.ends_with("#p-main"));
        assert_eq!(main.game_dir, root.join("data/profiles/noriskclient/new"));
        let plan = main.norisk.as_ref().unwrap();
        // Profil-Mod (deaktiviert) + Pack-Mods
        assert!(plan.modrinth.contains(&("MODMENU".into(), "MMV".into(), false)));
        assert!(plan.modrinth.iter().any(|(p, v, _)| p == "AANobbMI" && v == "CHILDVER"));
        // nur der passende lose Mod, NRC-JAR übersprungen
        assert_eq!(plan.jars.iter().map(|(_, n)| n.as_str()).collect::<Vec<_>>(), vec!["ok-mod.jar"]);
        assert!(plan.skipped.iter().any(|s| s == "NRC Thing"));
        assert_eq!(plan.settings["memory"]["max"], 3584);
        // Einstellungen für den Import-Dialog / das nachträgliche Übernehmen
        assert_eq!(main.settings.max_memory_mb, Some(3584));
        assert_eq!(main.settings.min_memory_mb, Some(1024));
        assert!(main.settings.java_path.is_none(), "use_custom_java_path = false");
        assert_eq!(plan.banner_url.as_deref(), Some("https://cdn.example.invalid/icon.png"));
        assert_eq!(main.info.mod_count as usize, plan.modrinth.len() + 1);
        // Loader-Version überschrieben
        let ov = found.iter().find(|f| f.info.name == "Eigene Gruppe").unwrap();
        assert_eq!(ov.info.loader.version.as_deref(), Some("0.20.1"));
        assert_eq!(ov.game_dir, root.join("data/profiles/groups/meine gruppe"));
        assert!(ov.info.warning.is_none());
        // Beschreiben über die Kennung
        let again = describe(&main.info.source_path, &root.join("tmp"), &icons);
        assert_eq!(again.unwrap().info.name, "NRC 26.3");
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn legacy_json() {
        let b = std::fs::read(fixtures().join("profiles.json")).unwrap();
        let v = read_json(&b).unwrap();
        assert_eq!(v.len(), 1);
        let p = &v[0];
        assert_eq!(p.name, "Hypixel Skyblock");
        assert_eq!(p.group.as_deref(), Some("SERVER"));
        assert_eq!(p.pack_id.as_deref(), Some("hypixel-skyblock"));
        assert_eq!(p.last_played_ms, Some(1_790_000_000_000));
        assert_eq!(p.mods[0], NrMod { source_type: "modrinth".into(), project_id: Some("P7dR8mSH".into()), version_id: Some("V1".into()), file_name: Some("fabric-api.jar".into()), name: Some("Fabric API".into()), enabled: true });
        assert_eq!(p.disabled_pack_mods, vec![("hypixel-skyblock".into(), "sodium".into(), "1.21.5".into(), "fabric".into())]);
        assert_eq!(p.banner_url.as_deref(), Some("https://cdn.norisk.gg/misc/hypixel-skyblock-icon.png"));
    }

    #[test]
    fn source_ids() {
        assert_eq!(split_source(r"C:\x\noriskclient\new#abc-123"), (r"C:\x\noriskclient\new", Some("abc-123")));
        assert_eq!(split_source(r"C:\x\new"), (r"C:\x\new", None));
    }
}
