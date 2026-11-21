use super::extsettings::Row;
use serde_json::Value;
use std::collections::HashMap;

fn put(row: &mut Row, k: &str, v: Option<&Value>) {
    if let Some(v) = v.filter(|v| !v.is_null()) {
        row.insert(format!("override_{k}"), v.clone());
    }
}

pub fn to_row(o: &Value) -> Row {
    let mut r = Row::new();
    put(&mut r, "java_path", o.get("java_path"));
    put(&mut r, "extra_launch_args", o.get("extra_launch_args"));
    put(&mut r, "custom_env_vars", o.get("custom_env_vars"));
    put(&mut r, "mc_force_fullscreen", o.get("force_fullscreen"));
    let mem = o.get("memory");
    put(&mut r, "mc_memory_max", mem.and_then(|m| m.get("maximum")).or_else(|| mem.filter(|m| m.is_number())));
    if let Some(res) = o.get("game_resolution") {
        let (w, h) = match res {
            Value::Array(a) if a.len() == 2 => (a.first(), a.get(1)),
            Value::Object(m) => (m.get("width").or(m.get("x")), m.get("height").or(m.get("y"))),
            _ => (None, None),
        };
        put(&mut r, "mc_game_resolution_x", w);
        put(&mut r, "mc_game_resolution_y", h);
    }
    if let Some(h) = o.get("hooks") {
        for k in ["pre_launch", "wrapper", "post_exit"] {
            put(&mut r, &format!("hook_{k}"), h.get(k));
        }
    }
    r
}

pub fn read(c: &rusqlite::Connection) -> HashMap<String, Row> {
    let sql = "SELECT i.path, CASE WHEN typeof(o.overrides) = 'blob' THEN json(o.overrides) ELSE o.overrides END
               FROM instances i JOIN instance_launch_overrides o ON o.instance_id = i.id";
    let Ok(mut st) = c.prepare(sql) else { return HashMap::new() };
    let rows = st.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, Option<String>>(1)?)));
    let Ok(rows) = rows else { return HashMap::new() };
    rows.flatten().filter_map(|(path, json)| Some((path.to_lowercase(), to_row(&serde_json::from_str::<Value>(&json?).ok()?)))).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn jsonb_overrides() {
        let c = rusqlite::Connection::open_in_memory().unwrap();
        c.execute_batch(
            "CREATE TABLE instances (id TEXT, path TEXT);
             CREATE TABLE instance_launch_overrides (instance_id TEXT, overrides BLOB);
             INSERT INTO instances VALUES ('a','Performium'), ('b','Leer');
             INSERT INTO instance_launch_overrides VALUES
              ('a', jsonb('{\"memory\":{\"maximum\":29440},\"extra_launch_args\":[\"-Xss4M\"],\"custom_env_vars\":[[\"A\",\"1\"]],\"game_resolution\":[1600,900],\"hooks\":{\"pre_launch\":null,\"wrapper\":\"prime-run\",\"post_exit\":null}}')),
              ('b', jsonb('{\"java_path\":null,\"memory\":null,\"hooks\":{\"pre_launch\":\"\",\"wrapper\":\"\",\"post_exit\":\"\"}}'));",
        )
        .unwrap();
        let m = read(&c);
        let p = &m["performium"];
        assert_eq!(p["override_mc_memory_max"], 29440);
        assert_eq!(p["override_mc_game_resolution_x"], 1600);
        assert_eq!(p["override_hook_wrapper"], "prime-run");
        assert!(!p.contains_key("override_hook_pre_launch"));
        let s = super::super::extsettings::modrinth(p, &Row::new(), &HashMap::new());
        assert_eq!(s.max_memory_mb, Some(29440));
        assert_eq!(s.jvm_args.as_deref(), Some("-Xss4M"));
        assert_eq!(s.env.get("A").map(String::as_str), Some("1"));
        assert_eq!((s.width, s.height), (Some(1600), Some(900)));
        assert!(!m["leer"].contains_key("override_mc_memory_max"));
    }
}
