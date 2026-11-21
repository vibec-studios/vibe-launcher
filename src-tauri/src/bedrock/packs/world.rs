use super::*;

/// Eintrag in `world_*_packs.json`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct WorldPackRef {
    pub pack_id: String,
    pub version: Vec<u64>,
}

pub fn world_pack_file(world: &Path, kind: PackKind) -> Option<PathBuf> {
    match kind {
        PackKind::Resource => Some(world.join("world_resource_packs.json")),
        PackKind::Behavior => Some(world.join("world_behavior_packs.json")),
        _ => None,
    }
}

pub fn read_world_packs(world: &Path, kind: PackKind) -> Vec<WorldPackRef> {
    let Some(f) = world_pack_file(world, kind) else { return Vec::new() };
    let Ok(text) = std::fs::read_to_string(f) else { return Vec::new() };
    let Ok(v) = serde_json::from_str::<serde_json::Value>(&manifest::relax_json(&text)) else { return Vec::new() };
    v.as_array()
        .map(|a| {
            a.iter()
                .filter_map(|x| {
                    Some(WorldPackRef {
                        pack_id: x.get("pack_id")?.as_str()?.to_ascii_lowercase(),
                        version: x.get("version").and_then(|v| v.as_array()).map(|a| a.iter().map(|n| n.as_u64().unwrap_or(0)).collect()).unwrap_or_default(),
                    })
                })
                .collect()
        })
        .unwrap_or_default()
}

/// Pack in einer Welt ein-/ausschalten. Neue Einträge kommen nach vorn (= höchste Priorität im Spiel).
/// Unbekannte Felder vorhandener Einträge bleiben erhalten.
pub fn set_world_pack(world: &Path, kind: PackKind, uuid: &str, version: &[u64], enabled: bool) -> AppResult<()> {
    let f = world_pack_file(world, kind).ok_or_else(|| AppError::Invalid("Nur Ressourcen- und Verhaltenspakete lassen sich je Welt aktivieren".into()))?;
    if !world.join("level.dat").is_file() {
        return Err(AppError::NotFound("Welt".into()));
    }
    let uuid = uuid.to_ascii_lowercase();
    let mut arr: Vec<serde_json::Value> = std::fs::read_to_string(&f)
        .ok()
        .and_then(|t| serde_json::from_str::<serde_json::Value>(&manifest::relax_json(&t)).ok())
        .and_then(|v| v.as_array().cloned())
        .unwrap_or_default();
    arr.retain(|x| x.get("pack_id").and_then(|p| p.as_str()).map(|p| p.to_ascii_lowercase()) != Some(uuid.clone()));
    if enabled {
        arr.insert(0, serde_json::json!({ "pack_id": uuid, "version": version }));
    }
    crate::util::write_json_atomic(&f, &arr)
}
