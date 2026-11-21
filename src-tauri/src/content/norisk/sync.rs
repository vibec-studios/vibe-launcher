use super::super::extsettings::{select_rows, Row};
use super::super::Source;
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::path::PathBuf;

#[derive(Debug, Clone, PartialEq)]
pub enum Kind {
    DirLink { adopt: String },
    FileMerge { format: Option<String>, local_keys: Vec<String> },
    FileCopy,
    Mods,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Target {
    pub path: String,
    pub kind: Kind,
    pub external: Option<PathBuf>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct PackMod {
    pub mod_id: String,
    pub source: Source,
    pub project_id: String,
    pub own_version: Option<String>,
    pub game_versions: Vec<String>,
    pub enabled: bool,
    pub name: String,
    pub overrides: HashMap<String, Value>,
}

#[derive(Debug, Clone, Default)]
pub struct Pack {
    pub id: String,
    pub name: String,
    pub targets: Vec<Target>,
    pub mods: Vec<PackMod>,
    pub resolved: HashMap<(String, String, String), String>,
    pub files: HashMap<(String, String, String), String>,
}

#[derive(Debug, Clone, Default)]
pub struct SyncDb {
    pub packs: HashMap<String, Pack>,
    pub subs: HashMap<String, Vec<String>>,
    pub excluded: HashMap<(String, String), HashSet<String>>,
}

fn s(r: &Row, k: &str) -> Option<String> {
    r.get(k).and_then(|v| v.as_str()).map(str::to_string).filter(|x| !x.is_empty())
}

fn on(r: &Row, k: &str) -> bool {
    r.get(k).and_then(|v| v.as_i64()) != Some(0)
}

fn json(r: &Row, k: &str) -> Value {
    s(r, k).and_then(|t| serde_json::from_str(&t).ok()).unwrap_or(Value::Null)
}

pub fn kind_of(v: &Value) -> Option<Kind> {
    let v = match v {
        Value::String(t) => serde_json::from_str::<Value>(t).ok().unwrap_or_else(|| serde_json::json!({ "type": t })),
        v => v.clone(),
    };
    let text = |k: &str| v.get(k).and_then(|x| x.as_str()).map(str::to_string);
    Some(match text("type")?.as_str() {
        "dir_link" => Kind::DirLink { adopt: text("adopt").unwrap_or_else(|| "backup_local".into()) },
        "file_merge" => Kind::FileMerge {
            format: text("format"),
            local_keys: match v.get("local_keys").and_then(|x| x.as_array()) {
                Some(a) => a.iter().filter_map(|x| x.as_str().map(str::to_string)).collect(),
                None => vec!["resourcePacks".into(), "incompatibleResourcePacks".into()],
            },
        },
        "file_copy" => Kind::FileCopy,
        "mods" => Kind::Mods,
        _ => return None,
    })
}

pub fn mod_of(mod_id_col: Option<String>, data: &Value, overrides: Value) -> Option<PackMod> {
    let src = data.get("source")?;
    let st = |k: &str| src.get(k).and_then(|x| x.as_str().map(str::to_string).or_else(|| x.as_u64().map(|n| n.to_string()))).filter(|x| !x.is_empty());
    let (source, version) = match src.get("type")?.as_str()? {
        "modrinth" => (Source::Modrinth, st("version_id")),
        "curse_forge" | "curseforge" => (Source::Curseforge, st("file_id")),
        _ => return None,
    };
    let project_id = st("project_id")?;
    let mod_id = data.get("id").and_then(|x| x.as_str()).map(str::to_string).or(mod_id_col).unwrap_or_default();
    Some(PackMod {
        name: data.get("display_name").and_then(|x| x.as_str()).map(str::to_string).unwrap_or_else(|| project_id.clone()),
        mod_id,
        source,
        project_id,
        own_version: version,
        game_versions: data.get("game_versions").and_then(|x| x.as_array()).map(|a| a.iter().filter_map(|g| g.as_str().map(str::to_string)).collect()).unwrap_or_default(),
        enabled: data.get("enabled").and_then(|x| x.as_bool()).unwrap_or(true),
        overrides: overrides.as_object().map(|o| o.clone().into_iter().collect()).unwrap_or_default(),
    })
}

pub fn read(c: &rusqlite::Connection) -> SyncDb {
    let mut db = SyncDb::default();
    for r in select_rows(c, "sync_packs", &["id", "name", "enabled"]) {
        let Some(id) = s(&r, "id") else { continue };
        if on(&r, "enabled") {
            db.packs.insert(id.clone(), Pack { name: s(&r, "name").unwrap_or_else(|| id.clone()), id, ..Default::default() });
        }
    }
    for r in select_rows(c, "sync_pack_targets", &["pack_id", "path", "enabled", "kind", "external_path"]) {
        let (Some(pid), Some(path)) = (s(&r, "pack_id"), s(&r, "path")) else { continue };
        let (Some(p), Some(kind)) = (db.packs.get_mut(&pid), r.get("kind").and_then(kind_of)) else { continue };
        if on(&r, "enabled") {
            let external = s(&r, "external_path").map(|e| PathBuf::from(e.strip_prefix(r"\\?\").unwrap_or(&e)));
            p.targets.push(Target { path, kind, external });
        }
    }
    for r in select_rows(c, "sync_pack_mods", &["pack_id", "mod_id", "data", "version_overrides"]) {
        let Some(p) = s(&r, "pack_id").and_then(|id| db.packs.get_mut(&id)) else { continue };
        if let Some(m) = mod_of(s(&r, "mod_id"), &json(&r, "data"), json(&r, "version_overrides")) {
            p.mods.push(m);
        }
    }
    for r in select_rows(c, "sync_pack_mod_resolutions", &["pack_id", "project_key", "mc_version", "loader", "version_id", "filename"]) {
        let Some(p) = s(&r, "pack_id").and_then(|id| db.packs.get_mut(&id)) else { continue };
        if let (Some(k), Some(mc), Some(l), Some(v)) = (s(&r, "project_key"), s(&r, "mc_version"), s(&r, "loader"), s(&r, "version_id")) {
            let key = (k, mc, l.to_lowercase());
            if let Some(f) = s(&r, "filename") {
                p.files.insert(key.clone(), f);
            }
            p.resolved.insert(key, v);
        }
    }
    let mut subs: Vec<(String, i64, String)> = select_rows(c, "profile_sync_packs", &["profile_id", "pack_id", "ordinal"])
        .into_iter()
        .filter_map(|r| Some((s(&r, "profile_id")?, r.get("ordinal").and_then(|v| v.as_i64()).unwrap_or(0), s(&r, "pack_id")?)))
        .collect();
    subs.sort();
    for (profile, _, pack) in subs {
        db.subs.entry(profile).or_default().push(pack);
    }
    for r in select_rows(c, "profile_sync_mod_exclusions", &["profile_id", "pack_id", "mod_key"]) {
        if let (Some(pr), Some(pa), Some(k)) = (s(&r, "profile_id"), s(&r, "pack_id"), s(&r, "mod_key")) {
            db.excluded.entry((pr, pa)).or_default().insert(k);
        }
    }
    db
}

pub fn project_key(m: &PackMod) -> String {
    format!("{}:{}", m.source.as_string(), m.project_id)
}

pub fn pick_version(m: &PackMod, p: &Pack, mc: &str, loader: &str) -> Option<Option<String>> {
    match m.overrides.get(mc) {
        Some(o) if o.get("type").and_then(|t| t.as_str()) == Some("disabled") => return None,
        Some(o) if o.get("type").and_then(|t| t.as_str()) == Some("pin") => {
            if let Some(v) = o.get("version_id").and_then(|x| x.as_str()) {
                return Some(Some(v.to_string()));
            }
        }
        _ => {}
    }
    if let Some(v) = p.resolved.get(&(project_key(m), mc.to_string(), loader.to_lowercase())) {
        return Some(Some(v.clone()));
    }
    Some(m.own_version.clone().filter(|_| m.game_versions.iter().any(|g| g == mc)))
}
