use super::*;

pub(super) static LOCK: parking_lot::Mutex<()> = parking_lot::Mutex::new(());

pub(super) fn store_path(paths: &Paths) -> PathBuf {
    paths.root.join("mod_sets.json")
}

pub(super) fn load(paths: &Paths) -> Store {
    std::fs::read(store_path(paths)).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default()
}

pub(super) fn save(paths: &Paths, s: &Store) -> AppResult<()> {
    let mut s = s.clone();
    s.format = 1;
    crate::util::write_json_atomic(&store_path(paths), &s)
}

/// Lese-Ändere-Schreibe unter Sperre.
pub(super) fn modify<R>(paths: &Paths, f: impl FnOnce(&mut Store) -> AppResult<R>) -> AppResult<R> {
    let _g = LOCK.lock();
    let mut s = load(paths);
    let r = f(&mut s)?;
    save(paths, &s)?;
    Ok(r)
}

pub(super) fn check_name(name: &str) -> AppResult<String> {
    let n = name.trim();
    if n.is_empty() {
        return Err(AppError::Invalid("Bitte einen Namen angeben".into()));
    }
    Ok(n.chars().take(60).collect())
}

pub(super) fn clean_description(d: Option<String>) -> Option<String> {
    d.map(|d| d.trim().chars().take(400).collect::<String>()).filter(|d| !d.is_empty())
}

/// Einträge an eine Liste anhängen (doppelte werden übersprungen). Gibt die Zahl neuer Einträge zurück.
pub fn merge_entries(list: &mut Vec<SetEntry>, new: Vec<SetEntry>) -> usize {
    let mut seen: HashSet<String> = list.iter().map(SetEntry::key).collect();
    let now = crate::util::now_ms();
    let mut n = 0;
    for mut e in new {
        if list.len() >= MAX_ENTRIES {
            break;
        }
        if e.project_id.trim().is_empty() || !seen.insert(e.key()) {
            continue;
        }
        if e.added == 0 {
            e.added = now;
        }
        e.title = e.title.trim().chars().take(120).collect();
        if e.title.is_empty() {
            e.title = e.slug.clone().unwrap_or_else(|| e.project_id.clone());
        }
        list.push(e);
        n += 1;
    }
    n
}

pub fn get(paths: &Paths, id: &str) -> AppResult<ModSet> {
    load(paths).sets.into_iter().find(|s| s.id == id).ok_or_else(|| AppError::NotFound("Mod-Set".into()))
}

pub fn all(paths: &Paths) -> Vec<ModSet> {
    load(paths).sets
}

pub fn list(state: &AppState) -> Vec<ModSetInfo> {
    let sets = all(&state.paths);
    let usage = crate::content::sets_apply::usage(state);
    sets.into_iter()
        .map(|s| {
            let used_by = usage.iter().filter(|(_, ids)| ids.contains(&s.id)).map(|(i, _)| i.clone()).collect();
            ModSetInfo { set: s, used_by }
        })
        .collect()
}

pub fn create(paths: &Paths, name: &str, description: Option<String>, entries: Vec<SetEntry>) -> AppResult<ModSet> {
    let name = check_name(name)?;
    modify(paths, |s| {
        let now = crate::util::now_ms();
        let mut set = ModSet { id: uuid::Uuid::new_v4().to_string(), name, description: clean_description(description), created: now, updated: now, entries: vec![], apply_on_create: false };
        merge_entries(&mut set.entries, entries);
        s.sets.push(set.clone());
        Ok(set)
    })
}

pub(super) fn with_set(paths: &Paths, id: &str, f: impl FnOnce(&mut ModSet) -> AppResult<()>) -> AppResult<ModSet> {
    modify(paths, |s| {
        let set = s.sets.iter_mut().find(|x| x.id == id).ok_or_else(|| AppError::NotFound("Mod-Set".into()))?;
        f(set)?;
        set.updated = crate::util::now_ms();
        Ok(set.clone())
    })
}

pub fn update(paths: &Paths, id: &str, name: Option<String>, description: Option<String>) -> AppResult<ModSet> {
    let name = name.map(|n| check_name(&n)).transpose()?;
    with_set(paths, id, |set| {
        if let Some(n) = name {
            set.name = n;
        }
        if let Some(d) = description {
            set.description = clean_description(Some(d));
        }
        Ok(())
    })
}

pub fn delete(paths: &Paths, id: &str) -> AppResult<()> {
    modify(paths, |s| {
        s.sets.retain(|x| x.id != id);
        Ok(())
    })
}

pub fn set_apply_on_create(paths: &Paths, id: &str, enabled: bool) -> AppResult<ModSet> {
    with_set(paths, id, |set| {
        set.apply_on_create = enabled;
        Ok(())
    })
}

pub fn add_entries(paths: &Paths, id: &str, entries: Vec<SetEntry>) -> AppResult<ModSet> {
    with_set(paths, id, |set| {
        merge_entries(&mut set.entries, entries);
        Ok(())
    })
}

pub fn remove_entries(paths: &Paths, id: &str, keys: &[String]) -> AppResult<ModSet> {
    with_set(paths, id, |set| {
        set.entries.retain(|e| !keys.contains(&e.key()));
        Ok(())
    })
}

/// Kopie eines Sets („… (Kopie)“).
pub fn duplicate(paths: &Paths, id: &str) -> AppResult<ModSet> {
    let src = get(paths, id)?;
    create(paths, &format!("{} (Kopie)", src.name), src.description, src.entries)
}
