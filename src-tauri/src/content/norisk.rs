//! Import aus dem NoRisk Client Launcher (NoRiskClient/noriskclient-launcher). Nur lesend.
//!
//! - Wurzel: Windows `%APPDATA%\norisk\NoRiskClientV3`, macOS `~/Library/Application Support/gg.norisk.NoRiskClientV3`,
//!   Linux `~/.local/share/noriskclientv3` (`directories::ProjectDirs("gg","norisk","NoRiskClientV3")`).
//! - Profile: SQLite `meta/app.db` (Tabellen `profiles`, `profile_mods`, `profile_disabled_norisk_mods`, Sync Packs),
//!   ältere Versionen `profiles.json` (JSON-Liste). Die DB wird vor dem Lesen samt WAL kopiert, Spalten werden
//!   per `PRAGMA table_info` abgefragt (ältere Schemata).
//! - Spielordner: `<profiles>/<profile.path>`; mit `use_shared_minecraft_folder` (nicht in den Gruppen
//!   SERVER/MODPACKS) der Gruppenordner `noriskclient/new|legacy` bzw. `groups/<gruppe>`.
//!   `<profiles>` = `data/profiles` (Windows) bzw. `profiles`, oder `<custom_game_directory>/profiles`.
//! - Inhalte: Mods der Profil-Mod-Liste (Modrinth- und CurseForge-Quelle), des gewählten NoRisk-Packs
//!   (`norisk_modpacks.json`, `compatibility[mc][loader].identifier` = Modrinth-Versions-ID, mit
//!   `inheritsFrom`/`excludeMods`) und der abonnierten Sync Packs werden per Modrinth/CurseForge installiert.
//!   Pack-Mods aus dem NoRisk-Maven bzw. per URL (NoRisk-Client-Mods, OptiFine) laufen nur im NoRisk-Launcher.
//!   Lose JARs aus `mods/`, `custom_mods/`, `mods/nrc-<mc>-<loader>[-<xxxx>]` und `sync_packs/<id>/mods/` werden
//!   kopiert, wenn sie zu Version/Loader passen und keine NoRisk-Mods sind.
//! - Globale Einstellungen: [`global`] (nur benannte Felder aus `launcher_config.json`), Sync Packs: [`sync`],
//!   [`syncplan`]; Details in docs/IMPORT-SETTINGS.md.
//! - `accounts.json` (Tokens) wird nie gelesen.
pub mod banner;
pub mod global;
pub mod mods;
pub mod options;
mod run;
pub mod sync;
pub mod syncplan;

pub use run::run_import;

use super::external::{norm, Found};
use super::extsettings::{select_rows, Row};
use super::{deps, ContentKind, Source};
use crate::error::{AppError, AppResult};
use crate::instance::{Loader, LoaderKind, PackSource};
use banner::Banner;
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};

pub const WARN_NRC: &str = "NoRisk-Client-Mods werden nicht übernommen – sie laufen nur im NoRisk-Launcher.";

fn skip_top(name: &str) -> bool {
    super::gamedata::skip_top(super::LauncherKind::Norisk, super::gamedata::Purpose::Import, name)
}

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

pub fn profiles_dir(root: &Path) -> PathBuf {
    profiles_dir_with(root, global::read(root).custom_dir.as_deref())
}

fn profiles_dir_with(root: &Path, custom: Option<&Path>) -> PathBuf {
    if let Some(c) = custom.filter(|c| c.join("profiles").is_dir()) {
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
    pub file_override: Option<String>,
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
    pub banner: Value,
    pub modpack_info: Value,
    pub pack_id: Option<String>,
    pub description: Option<String>,
    pub mods: Vec<NrMod>,
    pub disabled_pack_mods: Vec<(String, String, String, String)>,
}

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

fn str_of(v: Option<&Value>) -> Option<String> {
    v.and_then(|x| x.as_str()).map(str::to_string).filter(|s| !s.is_empty())
}

fn parse_json(v: Option<&Value>) -> Value {
    match v {
        Some(Value::String(t)) => serde_json::from_str(t).unwrap_or(Value::Null),
        Some(v) => v.clone(),
        None => Value::Null,
    }
}

fn int(r: &Row, k: &str) -> i64 {
    r.get(k).and_then(|v| v.as_i64().or_else(|| v.as_str().and_then(|s| s.parse().ok()))).unwrap_or(0)
}

fn col(r: &Row, k: &str) -> Option<String> {
    str_of(r.get(k))
}

pub const PROFILE_COLS: &[&str] = &[
    "id",
    "name",
    "path",
    "game_version",
    "loader",
    "loader_version",
    "last_played",
    "selected_norisk_pack_id",
    "group_name",
    "use_shared_minecraft_folder",
    "is_standard_version",
    "playtime_seconds",
    "settings",
    "banner",
    "description",
    "modpack_info",
];
pub const MOD_COLS: &[&str] = &["profile_id", "ordinal", "source_type", "project_id", "version_id", "file_name", "enabled", "display_name", "file_name_override"];

fn profile_of(r: &Row) -> Option<NrProfile> {
    Some(NrProfile {
        id: col(r, "id")?,
        name: col(r, "name").unwrap_or_default(),
        path: col(r, "path").unwrap_or_default(),
        game_version: col(r, "game_version").unwrap_or_default(),
        loader: col(r, "loader").unwrap_or_else(|| "vanilla".into()),
        loader_version: col(r, "loader_version"),
        last_played_ms: to_ms(int(r, "last_played")),
        pack_id: col(r, "selected_norisk_pack_id"),
        group: col(r, "group_name"),
        use_shared: int(r, "use_shared_minecraft_folder") != 0,
        is_standard: int(r, "is_standard_version") != 0,
        playtime_secs: int(r, "playtime_seconds").max(0) as u64,
        settings: parse_json(r.get("settings")),
        banner: parse_json(r.get("banner")),
        modpack_info: parse_json(r.get("modpack_info")),
        description: col(r, "description"),
        ..Default::default()
    })
}

pub fn read_db(c: &rusqlite::Connection) -> AppResult<Vec<NrProfile>> {
    let rows = select_rows(c, "profiles", PROFILE_COLS);
    if rows.is_empty() && c.prepare("SELECT 1 FROM profiles LIMIT 1").is_err() {
        return Err(AppError::msg("NoRisk-Datenbank: Tabelle profiles fehlt"));
    }
    let mut list: Vec<NrProfile> = rows.iter().filter_map(profile_of).collect();
    let mut mod_rows = select_rows(c, "profile_mods", MOD_COLS);
    mod_rows.sort_by_key(|r| int(r, "ordinal"));
    let mut mods: HashMap<String, Vec<NrMod>> = HashMap::new();
    for r in mod_rows {
        let Some(pid) = col(&r, "profile_id") else { continue };
        mods.entry(pid).or_default().push(NrMod {
            source_type: col(&r, "source_type").unwrap_or_default(),
            project_id: col(&r, "project_id"),
            version_id: col(&r, "version_id"),
            file_name: col(&r, "file_name"),
            enabled: r.get("enabled").map_or(true, |v| v.as_i64() != Some(0)),
            name: col(&r, "display_name"),
            file_override: col(&r, "file_name_override"),
        });
    }
    let mut disabled: HashMap<String, Vec<(String, String, String, String)>> = HashMap::new();
    for r in select_rows(c, "profile_disabled_norisk_mods", &["profile_id", "pack_id", "mod_id", "game_version", "loader"]) {
        if let (Some(p), Some(a), Some(b), Some(g), Some(l)) = (col(&r, "profile_id"), col(&r, "pack_id"), col(&r, "mod_id"), col(&r, "game_version"), col(&r, "loader")) {
            disabled.entry(p).or_default().push((a, b, g, l));
        }
    }
    for p in list.iter_mut() {
        p.mods = mods.remove(&p.id).unwrap_or_default();
        p.disabled_pack_mods = disabled.remove(&p.id).unwrap_or_default();
    }
    Ok(list)
}

fn json_mod(m: &Value) -> NrMod {
    let src = m.get("source").cloned().unwrap_or(Value::Null);
    let id = |k: &str| src.get(k).and_then(|x| x.as_str().map(str::to_string).or_else(|| x.as_u64().map(|n| n.to_string()))).filter(|s| !s.is_empty());
    NrMod {
        source_type: str_of(src.get("type")).unwrap_or_default(),
        project_id: id("project_id"),
        version_id: id("version_id").or_else(|| id("file_id")),
        file_name: str_of(src.get("file_name")),
        name: str_of(m.get("display_name")),
        enabled: m.get("enabled").and_then(|e| e.as_bool()).unwrap_or(true),
        file_override: str_of(m.get("file_name_override")),
    }
}

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
            let mods = p.get("mods").and_then(|m| m.as_array()).map(|a| a.iter().map(json_mod).collect()).unwrap_or_default();
            let disabled = p
                .get("disabled_norisk_mods_detailed")
                .and_then(|d| d.as_array())
                .map(|a| a.iter().filter_map(|d| Some((str_of(d.get("pack_id"))?, str_of(d.get("mod_id"))?, str_of(d.get("game_version"))?, str_of(d.get("loader"))?))).collect())
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
                banner: p.get("banner").cloned().unwrap_or(Value::Null),
                modpack_info: p.get("modpack_info").cloned().unwrap_or(Value::Null),
                pack_id: str_of(p.get("selected_norisk_pack_id")),
                description: str_of(p.get("description")),
                mods,
                disabled_pack_mods: disabled,
            })
        })
        .collect())
}

#[derive(Debug, Clone, Default)]
pub struct NrRoot {
    pub profiles: Vec<NrProfile>,
    pub meta: PathBuf,
    pub sync: sync::SyncDb,
}

pub fn read_root(root: &Path, custom: Option<&Path>, tmp: &Path) -> AppResult<NrRoot> {
    let mut dbs = vec![root.join("meta")];
    if let Some(c) = custom {
        dbs.push(c.join("meta"));
        dbs.push(c.to_path_buf());
    }
    for d in dbs {
        if d.join("app.db").is_file() {
            if let Some(c) = super::external::open_db_copy_named(&d, tmp, "norisk-db") {
                return Ok(NrRoot { profiles: read_db(&c)?, sync: sync::read(&c), meta: d });
            }
        }
    }
    let profiles = match std::fs::read(root.join("profiles.json")) {
        Ok(b) => read_json(&b)?,
        Err(_) => vec![],
    };
    Ok(NrRoot { profiles, meta: root.join("meta"), sync: Default::default() })
}

pub fn read_profiles(root: &Path, tmp: &Path) -> AppResult<Vec<NrProfile>> {
    Ok(read_root(root, global::read(root).custom_dir.as_deref(), tmp)?.profiles)
}

// ------------------------------------------------------------------ Spielordner

fn is_legacy(mc: &str) -> bool {
    let mut it = mc.split('.').map(|x| x.parse::<u32>().unwrap_or(0));
    matches!((it.next(), it.next()), (Some(1), Some(minor)) if minor < 13)
}

fn sanitize(s: &str) -> String {
    s.to_lowercase().chars().map(|c| if c.is_control() || "<>:\"/\\|?*".contains(c) { '_' } else { c }).collect::<String>().trim().trim_end_matches('.').to_string()
}

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

#[derive(Debug, Clone, PartialEq)]
pub struct PlanMod {
    pub source: Source,
    pub project_id: String,
    pub version_id: Option<String>,
    pub enabled: bool,
    pub name: String,
}

#[derive(Debug, Clone, PartialEq)]
pub struct PlanJar {
    pub path: PathBuf,
    pub name: String,
    pub mod_id: Option<String>,
}

#[derive(Debug, Clone, Default)]
pub struct Plan {
    pub profile_id: String,
    pub mods: Vec<PlanMod>,
    pub skipped: Vec<String>,
    pub jars: Vec<PlanJar>,
    pub group: Option<String>,
    pub banner: Option<Banner>,
    pub description: Option<String>,
    pub sync_packs: Vec<String>,
}

impl Plan {
    fn add_mod(&mut self, m: PlanMod) {
        if !self.mods.iter().any(|x| x.source == m.source && x.project_id == m.project_id) {
            self.mods.push(m);
        }
    }

    fn add_jar(&mut self, j: PlanJar) {
        let dup = self.jars.iter().any(|x| x.name.eq_ignore_ascii_case(&j.name) || (x.mod_id.is_some() && x.mod_id == j.mod_id));
        if !dup {
            self.jars.push(j);
        }
    }

    pub fn count(&self, s: Source) -> usize {
        self.mods.iter().filter(|m| m.source == s).count()
    }
}

fn is_nrc_id(id: &str) -> bool {
    let l = id.to_ascii_lowercase();
    l.starts_with("nrc") || l.starts_with("norisk")
}

pub enum JarClass {
    Fits(Option<String>),
    Norisk(String),
    Unfit,
}

pub fn jar_class(f: &Path, name: &str, mc: &str, loader: LoaderKind, icons: &Path) -> JarClass {
    let lower = name.to_ascii_lowercase();
    let meta = super::meta::read_entry(f, ContentKind::Mod, icons);
    let id = meta.mod_id.clone().unwrap_or_default();
    if is_nrc_id(&id) || lower.starts_with("nrc-") || lower.starts_with("norisk") {
        return JarClass::Norisk(meta.name.clone().unwrap_or_else(|| name.to_string()));
    }
    let loader_ok = match meta.loader.as_deref().and_then(LoaderKind::parse) {
        Some(l) => l == loader || (loader == LoaderKind::Quilt && l == LoaderKind::Fabric),
        None => true,
    };
    let mc_ok = meta.deps.iter().find(|d| d.id == "minecraft").and_then(|d| d.range.as_deref()).and_then(|r| deps::satisfies(r, mc)).unwrap_or(true);
    if loader_ok && mc_ok {
        JarClass::Fits(meta.mod_id.filter(|m| !m.is_empty()))
    } else {
        JarClass::Unfit
    }
}

fn nrc_dir(name: &str, mc: &str, loader: LoaderKind) -> bool {
    let base = format!("nrc-{}-{}", mc, loader.as_str()).to_ascii_lowercase();
    let l = name.to_ascii_lowercase();
    l == base || l.strip_prefix(&format!("{base}-")).is_some_and(|r| r.len() == 4 && r.chars().all(|c| c.is_ascii_hexdigit()))
}

fn mod_dirs(game: &Path, mc: &str, loader: LoaderKind) -> Vec<PathBuf> {
    let mut v = vec![game.join("mods"), game.join("custom_mods")];
    let mut nrc: Vec<PathBuf> = std::fs::read_dir(game.join("mods"))
        .into_iter()
        .flatten()
        .flatten()
        .filter(|e| e.path().is_dir() && nrc_dir(&e.file_name().to_string_lossy(), mc, loader))
        .map(|e| e.path())
        .collect();
    nrc.sort();
    v.extend(nrc);
    v
}

pub fn loose_jars(game: &Path, mc: &str, loader: LoaderKind, icons: &Path, known: &HashSet<String>) -> (Vec<PlanJar>, Vec<String>) {
    let mut ok: Vec<PlanJar> = Vec::new();
    let mut skipped = Vec::new();
    let mut seen = HashSet::new();
    for dir in mod_dirs(game, mc, loader) {
        let Ok(rd) = std::fs::read_dir(dir) else { continue };
        let mut files: Vec<PathBuf> = rd.flatten().map(|e| e.path()).filter(|p| p.is_file()).collect();
        files.sort();
        for f in files {
            let name = f.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
            let lower = name.to_ascii_lowercase();
            let base = lower.trim_end_matches(".disabled").to_string();
            if !(lower.ends_with(".jar") || lower.ends_with(".jar.disabled")) || known.contains(&base) || !seen.insert(base) {
                continue;
            }
            match jar_class(&f, &name, mc, loader, icons) {
                JarClass::Fits(mod_id) => {
                    if mod_id.is_none() || !ok.iter().any(|j| j.mod_id == mod_id) {
                        ok.push(PlanJar { path: f, name, mod_id });
                    }
                }
                JarClass::Norisk(n) => skipped.push(n),
                JarClass::Unfit => {}
            }
        }
    }
    (ok, skipped)
}

fn mod_name(m: &NrMod) -> String {
    m.name.clone().or_else(|| m.file_name.clone()).or_else(|| m.project_id.clone()).unwrap_or_default()
}

fn profile_mod(m: &NrMod) -> Option<PlanMod> {
    let source = match m.source_type.as_str() {
        "modrinth" => Source::Modrinth,
        "curse_forge" | "curseforge" => Source::Curseforge,
        _ => return None,
    };
    Some(PlanMod { source, project_id: m.project_id.clone()?, version_id: m.version_id.clone(), enabled: m.enabled, name: mod_name(m) })
}

pub fn plan_for(p: &NrProfile, packs: &Value, game: &Path, icons: &Path) -> Plan {
    let mut plan = Plan { profile_id: p.id.clone(), group: p.group.clone(), description: p.description.clone(), ..Default::default() };
    let mut known: HashSet<String> = HashSet::new();
    for m in &p.mods {
        match profile_mod(m) {
            Some(pm) => {
                known.extend([&m.file_name, &m.file_override].into_iter().flatten().map(|f| f.to_ascii_lowercase()));
                plan.add_mod(pm);
            }
            None if matches!(m.source_type.as_str(), "maven" | "embedded") => plan.skipped.push(mod_name(m)),
            None => {}
        }
    }
    for pm in pack_mods(packs, p) {
        match pm {
            PackMod::Modrinth { project_id, version_id, name, .. } => plan.add_mod(PlanMod { source: Source::Modrinth, project_id, version_id: Some(version_id), enabled: true, name }),
            PackMod::Skipped { name, .. } => plan.skipped.push(name),
        }
    }
    let loader = LoaderKind::parse(&p.loader).unwrap_or(LoaderKind::Vanilla);
    if loader != LoaderKind::Vanilla {
        let (jars, skipped) = loose_jars(game, &p.game_version, loader, icons, &known);
        plan.jars = jars;
        plan.skipped.extend(skipped);
    }
    plan
}

pub fn add_sync(plan: &mut Plan, s: syncplan::SyncPlan, loader: LoaderKind) {
    plan.sync_packs = s.packs;
    if loader == LoaderKind::Vanilla {
        return;
    }
    for m in s.mods {
        plan.add_mod(m);
    }
    for j in s.jars {
        plan.add_jar(j);
    }
    plan.skipped.extend(s.skipped);
}

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

type Policy = (HashMap<String, Value>, HashMap<String, HashMap<String, Value>>);

fn merged_policy(packs: &serde_json::Map<String, Value>, id: &str, visited: &mut HashSet<String>) -> Policy {
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

fn pack_of(p: &NrProfile) -> Option<PackSource> {
    let mut s = banner::pack_source(&p.modpack_info)?;
    s.name = Some(if p.name.trim().is_empty() { "NoRisk Client".into() } else { p.name.clone() });
    Some(s)
}

pub fn scan(root: &Path, tmp: &Path, icons: &Path) -> Vec<Found> {
    let g = global::read(root);
    let nr = match read_root(root, g.custom_dir.as_deref(), tmp) {
        Ok(p) => p,
        Err(e) => {
            tracing::warn!("NoRisk-Profile nicht lesbar: {e}");
            return vec![];
        }
    };
    let packs = read_packs(root);
    let pdir = profiles_dir_with(root, g.custom_dir.as_deref());
    let dirs: HashMap<String, PathBuf> = nr.profiles.iter().map(|p| (p.id.clone(), game_dir(&pdir, p))).collect();
    let roots: Vec<PathBuf> = [Some(root.to_path_buf()), g.custom_dir.clone(), Some(pdir.clone())].into_iter().flatten().collect();
    let ctx = syncplan::Ctx { db: &nr.sync, meta: &nr.meta, tmp, icons, dirs: &dirs };
    nr.profiles
        .iter()
        .map(|p| {
            let game = dirs[&p.id].clone();
            let loader = loader_of(p, &packs);
            let mut plan = plan_for(p, &packs, &game, icons);
            let sync = syncplan::plan(&ctx, &p.id, &p.game_version, loader.kind, &game);
            let overlays = sync.overlays.clone();
            add_sync(&mut plan, sync, loader.kind);
            plan.banner = banner::parse(&p.banner, root, &game, &roots, icons);
            let icon_path = match &plan.banner {
                Some(Banner::File(f)) => Some(f.clone()),
                _ => None,
            };
            let mut f = super::external::found(
                if p.name.trim().is_empty() { p.id.clone() } else { p.name.clone() },
                game.clone(),
                Path::new(&source_path(&game, &p.id)),
                p.game_version.clone(),
                loader,
                icon_path,
            );
            if let Some(Banner::Url(u)) = &plan.banner {
                f.info.icon = Some(u.clone());
            }
            f.info.mod_count = (plan.mods.len() + plan.jars.len()) as u32;
            f.info.last_played = p.last_played_ms;
            f.info.play_time_secs = Some(p.playtime_secs).filter(|v| *v > 0);
            if !plan.skipped.is_empty() {
                f.info.warning = Some(format!("{WARN_NRC} ({})", plan.skipped.len()));
            }
            f.settings = super::extsettings::norisk(&p.settings, plan.group.clone(), plan.description.clone(), p.is_standard, &g);
            f.pack = pack_of(p);
            f.overlays = overlays;
            f.norisk = Some(plan);
            f
        })
        .collect()
}

pub fn describe(source: &str, tmp: &Path, icons: &Path) -> Option<Found> {
    let me = norm(source);
    roots_for(source).iter().find_map(|r| scan(r, tmp, icons).into_iter().find(|f| norm(&f.info.source_path) == me))
}

pub fn roots_for(source: &str) -> Vec<PathBuf> {
    let mut roots = roots();
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

#[cfg(test)]
mod tests;
