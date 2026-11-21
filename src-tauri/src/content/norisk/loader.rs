use super::*;

pub(super) type Policy = (HashMap<String, Value>, HashMap<String, HashMap<String, Value>>);

pub(super) fn merged_policy(packs: &serde_json::Map<String, Value>, id: &str, visited: &mut HashSet<String>) -> Policy {
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

pub(super) fn pack_of(p: &NrProfile) -> Option<PackSource> {
    let mut s = banner::pack_source(&p.modpack_info)?;
    s.name = Some(if p.name.trim().is_empty() { "NoRisk Client".into() } else { p.name.clone() });
    Some(s)
}
