use super::*;

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
pub enum PackKind {
    Resource,
    Behavior,
    Skin,
    WorldTemplate,
}

impl PackKind {
    /// Zielordner unter `com.mojang`.
    pub fn folder(&self) -> &'static str {
        match self {
            PackKind::Resource => "resource_packs",
            PackKind::Behavior => "behavior_packs",
            PackKind::Skin => "skin_packs",
            PackKind::WorldTemplate => "world_templates",
        }
    }
    pub fn all() -> [PackKind; 4] {
        [PackKind::Resource, PackKind::Behavior, PackKind::Skin, PackKind::WorldTemplate]
    }
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct Manifest {
    pub name: String,
    pub description: String,
    pub uuid: String,
    /// z. B. `[1, 2, 0]`
    pub version: Vec<u64>,
    pub kind: PackKind,
    /// Mindestversion des Spiels, falls angegeben
    pub min_engine: Option<String>,
    /// Typen aller Module (`resources`, `data`, `script` …)
    pub modules: Vec<String>,
}

impl Manifest {
    pub fn version_string(&self) -> String {
        self.version.iter().map(|v| v.to_string()).collect::<Vec<_>>().join(".")
    }
}

/// Kommentare (`//`, `/* */`) und nachgestellte Kommas entfernen – Bedrock akzeptiert beides.
pub fn relax_json(s: &str) -> String {
    let s = s.trim_start_matches('\u{feff}');
    let b: Vec<char> = s.chars().collect();
    let mut out = String::with_capacity(s.len());
    let mut i = 0;
    let mut in_str = false;
    while i < b.len() {
        let c = b[i];
        if in_str {
            out.push(c);
            if c == '\\' && i + 1 < b.len() {
                out.push(b[i + 1]);
                i += 2;
                continue;
            }
            if c == '"' {
                in_str = false;
            }
            i += 1;
            continue;
        }
        match c {
            '"' => {
                in_str = true;
                out.push(c);
            }
            '/' if b.get(i + 1) == Some(&'/') => {
                while i < b.len() && b[i] != '\n' {
                    i += 1;
                }
                continue;
            }
            '/' if b.get(i + 1) == Some(&'*') => {
                i += 2;
                while i + 1 < b.len() && !(b[i] == '*' && b[i + 1] == '/') {
                    i += 1;
                }
                i += 2;
                continue;
            }
            ',' => {
                // Komma direkt vor } oder ] weglassen
                let mut j = i + 1;
                while j < b.len() && b[j].is_whitespace() {
                    j += 1;
                }
                if !matches!(b.get(j), Some('}') | Some(']')) {
                    out.push(c);
                }
            }
            _ => out.push(c),
        }
        i += 1;
    }
    out
}

pub(super) fn parse_version(v: Option<&serde_json::Value>) -> Vec<u64> {
    match v {
        Some(serde_json::Value::Array(a)) => a.iter().map(|x| x.as_u64().unwrap_or(0)).collect(),
        Some(serde_json::Value::String(s)) => s.split(['.', '-', '+']).take(3).map(|p| p.parse().unwrap_or(0)).collect(),
        _ => vec![0, 0, 0],
    }
}

/// `§`-Formatcodes entfernen.
pub fn strip_format(s: &str) -> String {
    let mut out = String::new();
    let mut skip = false;
    for c in s.chars() {
        if skip {
            skip = false;
            continue;
        }
        if c == '§' {
            skip = true;
            continue;
        }
        out.push(c);
    }
    out.trim().to_string()
}

/// `manifest.json` auswerten. `lang`: Inhalt von `texts/en_US.lang` (für Namen wie `pack.name`).
pub fn parse(bytes: &[u8], lang: Option<&str>) -> AppResult<Manifest> {
    let text = String::from_utf8_lossy(bytes);
    let v: serde_json::Value = serde_json::from_str(&relax_json(&text)).map_err(|e| AppError::Invalid(format!("manifest.json ist kein gültiges JSON: {e}")))?;
    let header = v.get("header").ok_or_else(|| AppError::Invalid("manifest.json ohne „header“".into()))?;
    let uuid = header.get("uuid").and_then(|x| x.as_str()).unwrap_or("").trim().to_ascii_lowercase();
    if uuid.is_empty() {
        return Err(AppError::Invalid("manifest.json ohne UUID".into()));
    }
    let resolve = |key: &str| -> String {
        let raw = header.get(key).and_then(|x| x.as_str()).unwrap_or("").to_string();
        let looks_like_key = !raw.is_empty() && !raw.contains(' ') && raw.contains('.');
        if looks_like_key {
            if let Some(l) = lang {
                for line in l.lines() {
                    if let Some((k, val)) = line.split_once('=') {
                        if k.trim() == raw {
                            // Kommentare hinter dem Wert (`\t##`) abschneiden
                            let val = val.split("\t#").next().unwrap_or(val);
                            return strip_format(val);
                        }
                    }
                }
            }
        }
        strip_format(&raw)
    };
    let modules: Vec<String> = v
        .get("modules")
        .and_then(|m| m.as_array())
        .map(|a| a.iter().filter_map(|m| m.get("type").and_then(|t| t.as_str()).map(|t| t.to_ascii_lowercase())).collect())
        .unwrap_or_default();
    let has = |t: &str| modules.iter().any(|m| m == t);
    let kind = if has("world_template") {
        PackKind::WorldTemplate
    } else if has("skin_pack") {
        PackKind::Skin
    } else if has("data") || has("script") || has("javascript") || has("client_data") {
        PackKind::Behavior
    } else if has("resources") {
        PackKind::Resource
    } else {
        return Err(AppError::Invalid("Unbekannter Pack-Typ (keine bekannten Module in manifest.json)".into()));
    };
    let min_engine = header.get("min_engine_version").map(|x| parse_version(Some(x))).filter(|v| !v.is_empty()).map(|v| v.iter().map(|n| n.to_string()).collect::<Vec<_>>().join("."));
    let mut name = resolve("name");
    if name.is_empty() {
        name = "Unbenanntes Pack".into();
    }
    Ok(Manifest { name, description: resolve("description"), uuid, version: parse_version(header.get("version")), kind, min_engine, modules })
}
