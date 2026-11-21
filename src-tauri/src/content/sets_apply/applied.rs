use super::*;

// ------------------------------------------------------------------ Angewendete Sets je Instanz

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(default)]
pub struct AppliedSet {
    pub applied_at: i64,
    /// Einträge (Schlüssel), die beim Anwenden schon im Set waren oder als „gesehen“ markiert wurden
    pub known: BTreeSet<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(default)]
pub struct Applied {
    pub sets: BTreeMap<String, AppliedSet>,
}

pub(super) fn applied_path(state_paths: &crate::paths::Paths, instance_id: &str) -> PathBuf {
    state_paths.instance_dir(instance_id).join("mod_sets_applied.json")
}

pub fn load_applied(paths: &crate::paths::Paths, instance_id: &str) -> Applied {
    std::fs::read(applied_path(paths, instance_id)).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default()
}

pub(super) fn save_applied(paths: &crate::paths::Paths, instance_id: &str, a: &Applied) -> AppResult<()> {
    crate::util::write_json_atomic(&applied_path(paths, instance_id), a)
}

/// Neue Einträge seit dem Anwenden (noch nicht bekannt und nicht installiert).
pub fn new_entries<'a>(set: &'a sets::ModSet, applied: &AppliedSet, idx: &ContentIndex) -> Vec<&'a SetEntry> {
    set.entries.iter().filter(|e| !applied.known.contains(&e.key()) && !idx.has_project(e.source, &e.project_id)).collect()
}

/// Instanz -> angewendete Sets.
pub fn usage(state: &AppState) -> Vec<(String, Vec<String>)> {
    state.instances.list().into_iter().map(|i| (i.id.clone(), load_applied(&state.paths, &i.id).sets.into_keys().collect::<Vec<_>>())).filter(|(_, s)| !s.is_empty()).collect()
}

#[derive(Debug, Clone, Serialize)]
pub struct SetNews {
    pub set_id: String,
    pub name: String,
    pub new_entries: Vec<SetEntry>,
}

pub fn news(state: &AppState, instance_id: &str) -> AppResult<Vec<SetNews>> {
    state.instances.get(instance_id)?;
    let applied = load_applied(&state.paths, instance_id);
    if applied.sets.is_empty() {
        return Ok(vec![]);
    }
    let idx = ContentIndex::load(&state.paths, instance_id);
    let all = sets::all(&state.paths);
    Ok(applied
        .sets
        .iter()
        .filter_map(|(sid, a)| {
            let set = all.iter().find(|s| &s.id == sid)?;
            let n: Vec<SetEntry> = new_entries(set, a, &idx).into_iter().cloned().collect();
            (!n.is_empty()).then(|| SetNews { set_id: sid.clone(), name: set.name.clone(), new_entries: n })
        })
        .collect())
}

/// Alle aktuellen Einträge als gesehen markieren („Nicht installieren“). `forget`: Set nicht mehr verfolgen.
pub fn dismiss_news(state: &AppState, instance_id: &str, set_id: &str, forget: bool) -> AppResult<()> {
    let mut applied = load_applied(&state.paths, instance_id);
    if forget {
        applied.sets.remove(set_id);
    } else if let Ok(set) = sets::get(&state.paths, set_id) {
        let a = applied.sets.entry(set_id.to_string()).or_default();
        a.known.extend(set.entries.iter().map(SetEntry::key));
    }
    save_applied(&state.paths, instance_id, &applied)
}

pub(super) fn record_applied(state: &AppState, instance_id: &str, set_ids: &[String]) -> AppResult<()> {
    let mut applied = load_applied(&state.paths, instance_id);
    let all = sets::all(&state.paths);
    for sid in set_ids {
        let Some(set) = all.iter().find(|s| &s.id == sid) else { continue };
        let a = applied.sets.entry(sid.clone()).or_default();
        a.applied_at = crate::util::now_ms();
        a.known.extend(set.entries.iter().map(SetEntry::key));
    }
    save_applied(&state.paths, instance_id, &applied)
}
