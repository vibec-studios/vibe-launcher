use super::*;

// ------------------------------------------------------------------ Modrinth App

/// Spaltenwerte einer Zeile (nur ausgewählte Spalten).
pub type Row = HashMap<String, Value>;

/// Profil-/Instanzzeile + globale `settings`-Zeile der Modrinth App (`override_*` fehlt/NULL = Standard der App).
pub fn modrinth(row: &Row, global: &Row, java_versions: &HashMap<String, String>) -> ExtSettings {
    let mut s = ExtSettings::default();
    let g = |k: &str| row.get(&format!("override_{k}")).filter(|v| !v.is_null());
    let gl = |k: &str| global.get(k).filter(|v| !v.is_null());
    // RAM (nur Maximum)
    if let Some(m) = num(g("mc_memory_max")) {
        s.max_memory_mb = Some(m);
    } else if let Some(m) = num(gl("mc_memory_max")) {
        s.max_memory_mb = Some(m);
        s.inherit("memory");
    }
    s.java_path = text(g("java_path"));
    if let Some(p) = &s.java_path {
        s.java_version = java_versions.get(&external::norm(p)).cloned();
    }
    if let Some(a) = g("extra_launch_args").and_then(args_of) {
        s.jvm_args = Some(a);
    } else if let Some(a) = gl("extra_launch_args").and_then(args_of).filter(|a| !a.trim().is_empty()) {
        s.jvm_args = Some(a);
        s.inherit("jvm_args");
    }
    if let Some(e) = g("custom_env_vars").and_then(env_of) {
        s.env = e;
    } else if let Some(e) = gl("custom_env_vars").and_then(env_of).filter(|e| !e.is_empty()) {
        s.env = e;
        s.inherit("env");
    }
    match (num(g("mc_game_resolution_x")), num(g("mc_game_resolution_y"))) {
        (Some(w), Some(h)) => (s.width, s.height) = (Some(w), Some(h)),
        _ => {
            if let (Some(w), Some(h)) = (num(gl("mc_game_resolution_x")), num(gl("mc_game_resolution_y"))) {
                (s.width, s.height) = (Some(w), Some(h));
                s.inherit("window");
            }
        }
    }
    if let Some(f) = boolean(g("mc_force_fullscreen")) {
        s.fullscreen = Some(f);
    } else if let Some(f) = boolean(gl("mc_force_fullscreen")) {
        s.fullscreen = Some(f);
        s.inherit("window");
    }
    let mut inherited_hook = false;
    let mut hook = |k: &str| {
        text(g(&format!("hook_{k}"))).or_else(|| {
            let v = text(gl(&format!("hook_{k}")));
            inherited_hook |= v.is_some();
            v
        })
    };
    (s.pre_launch, s.wrapper, s.post_exit) = (hook("pre_launch"), hook("wrapper"), hook("post_exit"));
    if inherited_hook {
        s.inherit("hooks");
    }
    s.group = row.get("groups").and_then(|v| match v {
        Value::String(t) => serde_json::from_str::<Value>(t).ok(),
        v => Some(v.clone()),
    })
    .and_then(|v| v.as_array().and_then(|a| a.iter().find_map(|x| text(Some(x)))));
    s.sanitize()
}

/// Sehr alte Modrinth App: `profile.json` (`java`, `memory`, `resolution`, `fullscreen`, `hooks`, `metadata.groups`).
pub fn modrinth_profile_json(v: &Value) -> ExtSettings {
    let mut s = ExtSettings::default();
    if let Some(j) = v.get("java") {
        s.java_path = text(j.get("override_version").and_then(|o| o.get("path")));
        s.java_version = text(j.get("override_version").and_then(|o| o.get("version")));
        s.jvm_args = j.get("extra_arguments").and_then(args_of);
        s.env = j.get("custom_env_args").and_then(env_of).unwrap_or_default();
    }
    s.max_memory_mb = num(v.get("memory").and_then(|m| m.get("maximum")));
    if let Some(r) = v.get("resolution").and_then(|r| r.as_array()).filter(|r| r.len() == 2) {
        (s.width, s.height) = (num(r.first()), num(r.get(1)));
    }
    s.fullscreen = boolean(v.get("fullscreen"));
    if let Some(h) = v.get("hooks") {
        (s.pre_launch, s.wrapper, s.post_exit) = (text(h.get("pre_launch")), text(h.get("wrapper")), text(h.get("post_exit")));
    }
    s.group = v.get("metadata").and_then(|m| m.get("groups")).and_then(|g| g.as_array()).and_then(|a| a.iter().find_map(|x| text(Some(x))));
    s.sanitize()
}

/// Spalten aus einer Tabelle lesen (nur vorhandene aus `wanted`; nie `SELECT *`).
pub fn select_rows(c: &rusqlite::Connection, table: &str, wanted: &[&str]) -> Vec<Row> {
    let have: Vec<String> = {
        let Ok(mut st) = c.prepare(&format!("PRAGMA table_info({table})")) else { return vec![] };
        st.query_map([], |r| r.get::<_, String>(1)).map(|it| it.flatten().collect()).unwrap_or_default()
    };
    let cols: Vec<&str> = wanted.iter().copied().filter(|w| have.iter().any(|h| h == w)).collect();
    if cols.is_empty() {
        return vec![];
    }
    let plain = format!("SELECT {} FROM {table}", cols.iter().map(|c| format!("\"{c}\"")).collect::<Vec<_>>().join(", "));
    let decoded = format!(
        "SELECT {} FROM {table}",
        cols.iter().map(|c| format!("CASE WHEN typeof(\"{c}\") = 'blob' AND json_valid(\"{c}\", 8) THEN json(\"{c}\") ELSE \"{c}\" END")).collect::<Vec<_>>().join(", ")
    );
    let Ok(mut st) = c.prepare(&decoded).or_else(|_| c.prepare(&plain)) else { return vec![] };
    let rows = st.query_map([], |r| {
        let mut m = Row::new();
        for (i, c) in cols.iter().enumerate() {
            use rusqlite::types::ValueRef;
            let v = match r.get_ref(i)? {
                ValueRef::Null => Value::Null,
                ValueRef::Integer(n) => json!(n),
                ValueRef::Real(f) => json!(f),
                ValueRef::Text(t) => Value::String(String::from_utf8_lossy(t).to_string()),
                ValueRef::Blob(_) => Value::Null,
            };
            m.insert(c.to_string(), v);
        }
        Ok(m)
    });
    rows.map(|it| it.flatten().collect()).unwrap_or_default()
}

/// Instanz-Spalten der Modrinth App (ältere `profiles`, neuere `instances`).
pub const MR_INSTANCE_COLS: &[&str] = &[
    "id",
    "path",
    "groups",
    "override_java_path",
    "override_extra_launch_args",
    "override_custom_env_vars",
    "override_mc_memory_max",
    "override_mc_force_fullscreen",
    "override_mc_game_resolution_x",
    "override_mc_game_resolution_y",
    "override_hook_pre_launch",
    "override_hook_wrapper",
    "override_hook_post_exit",
];
/// Globale Standardwerte der Modrinth App (Tabelle `settings`; nur diese Spalten).
pub const MR_GLOBAL_COLS: &[&str] = &[
    "extra_launch_args",
    "custom_env_vars",
    "mc_memory_max",
    "mc_force_fullscreen",
    "mc_game_resolution_x",
    "mc_game_resolution_y",
    "hook_pre_launch",
    "hook_wrapper",
    "hook_post_exit",
];

/// Einstellungen aller Modrinth-Profile (Schlüssel: Ordnername klein).
pub fn modrinth_all(c: &rusqlite::Connection) -> HashMap<String, ExtSettings> {
    let global = select_rows(c, "settings", MR_GLOBAL_COLS).into_iter().next().unwrap_or_default();
    let java: HashMap<String, String> = select_rows(c, "java_versions", &["path", "full_version"])
        .into_iter()
        .filter_map(|r| Some((external::norm(r.get("path")?.as_str()?), r.get("full_version")?.as_str()?.to_string())))
        .collect();
    let mut out = HashMap::new();
    let overrides = crate::content::mroverrides::read(c);
    for table in ["profiles", "instances"] {
        for mut r in select_rows(c, table, MR_INSTANCE_COLS) {
            let Some(path) = r.get("path").and_then(|p| p.as_str()).map(|p| p.to_lowercase()) else { continue };
            if table == "instances" {
                if let Some(o) = overrides.get(&path) {
                    r.extend(o.clone());
                }
            }
            out.insert(path, modrinth(&r, &global, &java));
        }
    }
    out
}
