use super::*;

// ------------------------------------------------------------------ Hilfen für die Leser

/// Prism/ATLauncher-Variablen (`$INST_DIR`, `${INST_JAVA}`) unter Windows für `cmd` umschreiben (`%INST_DIR%`).
/// Vibe setzt dieselben Umgebungsvariablen (siehe `minecraft::hooks`).
pub fn shell_vars(cmd: &str) -> String {
    if !cfg!(windows) {
        return cmd.to_string();
    }
    let re = regex::Regex::new(r"\$\{(INST_[A-Z_]+)\}|\$(INST_[A-Z_]+)").expect("regex");
    re.replace_all(cmd, |c: &regex::Captures| format!("%{}%", c.get(1).or(c.get(2)).map(|m| m.as_str()).unwrap_or_default())).to_string()
}

/// Argumentliste zu einer Zeile (Argumente mit Leerzeichen in Anführungszeichen).
pub(super) fn join_args(a: &[String]) -> String {
    a.iter().map(|x| if x.contains(char::is_whitespace) && !x.contains('"') { format!("\"{x}\"") } else { x.clone() }).collect::<Vec<_>>().join(" ")
}

/// Umgebungsvariablen aus JSON: `{"K":"V"}`, `[["K","V"]]` oder `[{"key":..,"value":..}]`.
pub(super) fn env_of(v: &Value) -> Option<BTreeMap<String, String>> {
    let sv = |x: &Value| x.as_str().map(str::to_string).or_else(|| (x.is_number() || x.is_boolean()).then(|| x.to_string()));
    match v {
        Value::Object(m) => Some(m.iter().filter_map(|(k, v)| Some((k.clone(), sv(v)?))).collect()),
        Value::Array(a) => Some(
            a.iter()
                .filter_map(|e| match e {
                    Value::Array(p) if p.len() == 2 => Some((p[0].as_str()?.to_string(), sv(&p[1])?)),
                    Value::Object(o) => Some((o.get("key").or(o.get("name"))?.as_str()?.to_string(), sv(o.get("value")?)?)),
                    _ => None,
                })
                .collect(),
        ),
        Value::String(s) => serde_json::from_str::<Value>(s).ok().filter(|v| !v.is_string()).and_then(|v| env_of(&v)),
        _ => None,
    }
}

pub(super) fn args_of(v: &Value) -> Option<String> {
    match v {
        Value::Array(a) => Some(join_args(&a.iter().filter_map(|x| x.as_str().map(str::to_string)).collect::<Vec<_>>())),
        Value::String(s) => match serde_json::from_str::<Value>(s) {
            Ok(inner @ Value::Array(_)) => args_of(&inner),
            _ => Some(s.clone()),
        },
        _ => None,
    }
}

pub(super) fn num(v: Option<&Value>) -> Option<u32> {
    let v = v?;
    v.as_u64().or_else(|| v.as_f64().map(|f| f as u64)).or_else(|| v.as_str().and_then(|s| s.trim().parse().ok())).and_then(|n| u32::try_from(n).ok())
}

pub(super) fn boolean(v: Option<&Value>) -> Option<bool> {
    match v? {
        Value::Bool(b) => Some(*b),
        Value::Number(n) => n.as_i64().map(|n| n != 0),
        Value::String(s) => match s.trim() {
            "true" | "1" => Some(true),
            "false" | "0" => Some(false),
            _ => None,
        },
        _ => None,
    }
}

pub(super) fn text(v: Option<&Value>) -> Option<String> {
    v.and_then(|x| x.as_str()).map(str::to_string).filter(|s| !s.trim().is_empty())
}
