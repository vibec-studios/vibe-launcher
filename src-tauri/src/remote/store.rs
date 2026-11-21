use super::RemoteAgent;
use crate::auth::secrets::SecretStore;
use crate::error::{AppError, AppResult};
use crate::paths::Paths;
use parking_lot::Mutex;
use std::sync::OnceLock;

fn cache() -> &'static Mutex<Option<Vec<RemoteAgent>>> {
    static C: OnceLock<Mutex<Option<Vec<RemoteAgent>>>> = OnceLock::new();
    C.get_or_init(Default::default)
}

fn file(paths: &Paths) -> std::path::PathBuf {
    paths.root.join("remote-agents.json")
}

pub fn list(paths: &Paths) -> Vec<RemoteAgent> {
    let mut c = cache().lock();
    if c.is_none() {
        let loaded = std::fs::read_to_string(file(paths))
            .ok()
            .and_then(|s| serde_json::from_str::<Vec<RemoteAgent>>(&s).ok())
            .unwrap_or_default();
        *c = Some(loaded);
    }
    c.clone().unwrap_or_default()
}

fn write(paths: &Paths, list: &[RemoteAgent]) -> AppResult<()> {
    let json = serde_json::to_string_pretty(list)?;
    let path = file(paths);
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, json)?;
    std::fs::rename(&tmp, &path)?;
    *cache().lock() = Some(list.to_vec());
    Ok(())
}

pub fn get(paths: &Paths, key: &str) -> AppResult<RemoteAgent> {
    list(paths)
        .into_iter()
        .find(|a| a.key == key)
        .ok_or_else(|| AppError::NotFound("Dieser Remote-Server ist nicht mehr verbunden.".into()))
}

pub fn upsert(paths: &Paths, agent: RemoteAgent) -> AppResult<RemoteAgent> {
    let mut all = list(paths);
    match all.iter_mut().find(|a| a.key == agent.key) {
        Some(slot) => *slot = agent.clone(),
        None => all.push(agent.clone()),
    }
    write(paths, &all)?;
    Ok(agent)
}

pub fn update(paths: &Paths, key: &str, f: impl FnOnce(&mut RemoteAgent)) -> AppResult<RemoteAgent> {
    let mut all = list(paths);
    let slot = all
        .iter_mut()
        .find(|a| a.key == key)
        .ok_or_else(|| AppError::NotFound("Dieser Remote-Server ist nicht mehr verbunden.".into()))?;
    f(slot);
    let out = slot.clone();
    write(paths, &all)?;
    Ok(out)
}

pub fn remove(paths: &Paths, key: &str) -> AppResult<()> {
    let mut all = list(paths);
    all.retain(|a| a.key != key);
    write(paths, &all)?;
    SecretStore::new(paths).delete(&super::secret_id(key));
    Ok(())
}

pub fn replace_vibe(paths: &Paths, fresh: Vec<RemoteAgent>) -> AppResult<Vec<RemoteAgent>> {
    let mut all: Vec<RemoteAgent> = list(paths).into_iter().filter(|a| a.via != super::Via::Vibe).collect();
    let old = list(paths);
    for mut a in fresh {
        if let Some(prev) = old.iter().find(|o| o.key == a.key) {
            a.added_at = prev.added_at;
        }
        all.push(a);
    }
    write(paths, &all)?;
    Ok(all)
}

pub fn save_token(paths: &Paths, key: &str, token: &str) -> AppResult<()> {
    SecretStore::new(paths).save(&super::secret_id(key), token)
}

pub fn load_token(paths: &Paths, key: &str) -> AppResult<String> {
    SecretStore::new(paths)
        .load(&super::secret_id(key))?
        .ok_or_else(|| AppError::Auth("Für diesen Remote-Server ist kein Zugang gespeichert. Bitte neu koppeln.".into()))
}
