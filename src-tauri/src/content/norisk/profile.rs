use super::*;

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

pub(super) fn str_of(v: Option<&Value>) -> Option<String> {
    v.and_then(|x| x.as_str()).map(str::to_string).filter(|s| !s.is_empty())
}

pub(super) fn parse_json(v: Option<&Value>) -> Value {
    match v {
        Some(Value::String(t)) => serde_json::from_str(t).unwrap_or(Value::Null),
        Some(v) => v.clone(),
        None => Value::Null,
    }
}

pub(super) fn int(r: &Row, k: &str) -> i64 {
    r.get(k).and_then(|v| v.as_i64().or_else(|| v.as_str().and_then(|s| s.parse().ok()))).unwrap_or(0)
}

pub(super) fn col(r: &Row, k: &str) -> Option<String> {
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

pub(super) fn profile_of(r: &Row) -> Option<NrProfile> {
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

pub(super) fn json_mod(m: &Value) -> NrMod {
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
