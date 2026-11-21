use super::*;

pub(super) fn parse_fabric(v: &Value) -> Parsed {
    let authors = v
        .get("authors")
        .and_then(|a| a.as_array())
        .map(|a| {
            a.iter()
                .filter_map(|x| x.as_str().map(str::to_string).or_else(|| x.get("name").and_then(|n| n.as_str()).map(str::to_string)))
                .collect()
        })
        .unwrap_or_default();
    let mut deps = Vec::new();
    for (key, kind) in [("depends", "required"), ("recommends", "optional"), ("suggests", "optional"), ("breaks", "breaks"), ("conflicts", "breaks")] {
        if let Some(o) = v.get(key).and_then(|d| d.as_object()) {
            for (id, r) in o {
                deps.push(dep(id, fabric_range(r), kind));
            }
        }
    }
    let provides = v.get("provides").and_then(|p| p.as_array()).map(|a| a.iter().filter_map(|x| x.as_str().map(str::to_string)).collect()).unwrap_or_default();
    let nested = v
        .get("jars")
        .and_then(|j| j.as_array())
        .map(|a| a.iter().filter_map(|x| x.get("file").and_then(|f| f.as_str()).map(str::to_string)).collect())
        .unwrap_or_default();
    Parsed {
        mod_id: str_of(v.get("id")),
        name: str_of(v.get("name")),
        version: str_of(v.get("version")),
        description: str_of(v.get("description")),
        authors,
        icon_path: icon_of(v.get("icon")),
        loader: Some("fabric".into()),
        deps,
        provides,
        environment: v.get("environment").and_then(|e| e.as_str()).map(str::to_string),
        nested,
    }
}



pub(super) fn parse_quilt(v: &Value) -> Parsed {
    let ql = v.get("quilt_loader").cloned().unwrap_or(Value::Null);
    let md = ql.get("metadata").cloned().unwrap_or(Value::Null);
    let authors = md
        .get("contributors")
        .and_then(|c| c.as_object())
        .map(|o| o.keys().cloned().collect())
        .unwrap_or_default();
    let mut deps = Vec::new();
    for (key, kind) in [("depends", "required"), ("breaks", "breaks")] {
        if let Some(a) = ql.get(key).and_then(|d| d.as_array()) {
            for d in a {
                match d {
                    Value::String(id) => deps.push(dep(id, None, kind)),
                    Value::Object(o) => {
                        let Some(id) = o.get("id").and_then(|x| x.as_str()) else { continue };
                        let optional = o.get("optional").and_then(|x| x.as_bool()).unwrap_or(false);
                        let range = o.get("versions").and_then(fabric_range);
                        deps.push(dep(id, range, if kind == "required" && optional { "optional" } else { kind }));
                    }
                    _ => {}
                }
            }
        }
    }
    let provides = ql
        .get("provides")
        .and_then(|p| p.as_array())
        .map(|a| a.iter().filter_map(|x| x.as_str().map(str::to_string).or_else(|| x.get("id").and_then(|i| i.as_str()).map(str::to_string))).collect())
        .unwrap_or_default();
    Parsed {
        mod_id: str_of(ql.get("id")),
        name: str_of(md.get("name")),
        version: str_of(ql.get("version")),
        description: str_of(md.get("description")),
        authors,
        icon_path: icon_of(md.get("icon")),
        loader: Some("quilt".into()),
        deps,
        provides,
        environment: v.get("minecraft").and_then(|m| m.get("environment")).and_then(|e| e.as_str()).map(str::to_string),
        nested: vec![],
    }
}



pub(super) fn toml_fallback(text: &str, key: &str) -> Option<String> {
    let re = regex::Regex::new(&format!(r#"(?m)^\s*{key}\s*=\s*["']([^"'\n]*)["']"#)).ok()?;
    re.captures(text).map(|c| c[1].to_string()).filter(|s| !s.is_empty())
}



/// `[[dependencies.<modid>]]` aus mods.toml / neoforge.mods.toml.
pub(super) fn toml_deps(t: &toml::Table, own: Option<&str>) -> Vec<MetaDep> {
    let mut out = Vec::new();
    let Some(deps) = t.get("dependencies").and_then(|d| d.as_table()) else { return out };
    for (owner, list) in deps {
        if own.is_some_and(|o| o != owner) {
            continue;
        }
        let Some(arr) = list.as_array() else { continue };
        for d in arr.iter().filter_map(|x| x.as_table()) {
            let Some(id) = d.get("modId").and_then(|x| x.as_str()) else { continue };
            let kind = match d.get("type").and_then(|x| x.as_str()).map(|s| s.to_ascii_lowercase()) {
                Some(t) if t == "required" => "required",
                Some(t) if t == "incompatible" => "breaks",
                Some(_) => "optional",
                None => {
                    if d.get("mandatory").and_then(|x| x.as_bool()).unwrap_or(false) {
                        "required"
                    } else {
                        "optional"
                    }
                }
            };
            let range = d.get("versionRange").and_then(|x| x.as_str()).map(str::to_string);
            out.push(dep(id, range, kind));
        }
    }
    out
}



pub(super) fn parse_mods_toml(text: &str, manifest_version: Option<&str>) -> Parsed {
    let fix_version = |v: Option<String>| -> Option<String> {
        match v {
            Some(v) if v.contains("${file.jarVersion}") => manifest_version.map(|m| v.replace("${file.jarVersion}", m)),
            Some(v) if v.starts_with("${") => manifest_version.map(str::to_string),
            other => other,
        }
    };
    match text.parse::<toml::Table>() {
        Ok(t) => {
            let first = t.get("mods").and_then(|m| m.as_array()).and_then(|a| a.first()).and_then(|m| m.as_table()).cloned().unwrap_or_default();
            let get = |tbl: &toml::Table, k: &str| tbl.get(k).and_then(|v| v.as_str()).map(strip_formatting).filter(|s| !s.is_empty());
            let authors = get(&first, "authors")
                .or_else(|| get(&t, "authors"))
                .map(|a| a.split(',').map(|s| s.trim().to_string()).filter(|s| !s.is_empty()).collect())
                .unwrap_or_default();
            let mod_id = get(&first, "modId");
            let provides = t
                .get("mods")
                .and_then(|m| m.as_array())
                .map(|a| a.iter().skip(1).filter_map(|m| m.get("modId").and_then(|x| x.as_str()).map(str::to_string)).collect())
                .unwrap_or_default();
            Parsed {
                deps: toml_deps(&t, mod_id.as_deref()),
                mod_id,
                name: get(&first, "displayName"),
                version: fix_version(get(&first, "version")),
                description: get(&first, "description"),
                authors,
                icon_path: get(&first, "logoFile").or_else(|| get(&t, "logoFile")),
                provides,
                ..Default::default()
            }
        }
        Err(_) => Parsed {
            mod_id: toml_fallback(text, "modId"),
            name: toml_fallback(text, "displayName"),
            version: fix_version(toml_fallback(text, "version")),
            description: toml_fallback(text, "description"),
            authors: toml_fallback(text, "authors").map(|a| vec![a]).unwrap_or_default(),
            icon_path: toml_fallback(text, "logoFile"),
            ..Default::default()
        },
    }
}



pub(super) fn parse_mcmod_info(v: &Value) -> Parsed {
    let first = match v {
        Value::Array(a) => a.first().cloned(),
        Value::Object(o) => o.get("modList").and_then(|m| m.as_array()).and_then(|a| a.first()).cloned(),
        _ => None,
    }
    .unwrap_or(Value::Null);
    let authors = first
        .get("authorList")
        .or_else(|| first.get("authors"))
        .and_then(|a| a.as_array())
        .map(|a| a.iter().filter_map(|x| x.as_str().map(str::to_string)).collect())
        .unwrap_or_default();
    Parsed {
        mod_id: str_of(first.get("modid")),
        name: str_of(first.get("name")),
        version: str_of(first.get("version")),
        description: str_of(first.get("description")),
        authors,
        icon_path: str_of(first.get("logoFile")),
        loader: Some("forge".into()),
        ..Default::default()
    }
}



pub(super) fn parse_pack_mcmeta(bytes: &[u8]) -> Parsed {
    let desc = lenient_json(bytes).and_then(|v| v.get("pack").and_then(|p| p.get("description")).map(component_text));
    Parsed {
        description: desc.map(|d| strip_formatting(&d)).filter(|d| !d.is_empty()),
        icon_path: Some("pack.png".into()),
        ..Default::default()
    }
}



pub(super) fn manifest_impl_version(text: &str) -> Option<String> {
    text.lines()
        .find_map(|l| l.strip_prefix("Implementation-Version:"))
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
}
