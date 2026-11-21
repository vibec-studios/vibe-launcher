use super::*;

// ------------------------------------------------------------------ Packs

#[derive(Debug, Clone, PartialEq)]
pub enum PackMod {
    Modrinth { id: String, name: String, project_id: String, version_id: String },
    Skipped { id: String, name: String },
}

pub(super) fn resolve_pack(packs: &serde_json::Map<String, Value>, id: &str, visited: &mut HashSet<String>) -> Vec<Value> {
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
