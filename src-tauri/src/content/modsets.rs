//! Mod-Sets: benannte Zustände „welche Inhalte sind aktiv“ je Instanz (`instances/<id>/modsets.json`).
//! Umschalten aktiviert/deaktiviert Dateien (`.disabled`). Dateien, die das Set nicht kennt (später
//! hinzugefügt), bleiben unverändert.
use super::index;
use super::{local, ContentKind};
use crate::error::{AppError, AppResult};
use crate::state::AppState;
use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(default)]
struct SetData {
    id: String,
    name: String,
    created: i64,
    /// Schlüssel (`mods/x.jar`) aktiver Dateien
    enabled: BTreeSet<String>,
    /// Schlüssel deaktivierter Dateien
    disabled: BTreeSet<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(default)]
struct SetsFile {
    active: Option<String>,
    sets: Vec<SetData>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ModSet {
    pub id: String,
    pub name: String,
    pub created: i64,
    pub enabled_count: u32,
    pub total_count: u32,
}

#[derive(Debug, Clone, Serialize)]
pub struct ModSets {
    pub active: Option<String>,
    /// Aktuelle Auswahl weicht vom aktiven Set ab
    pub active_modified: bool,
    pub sets: Vec<ModSet>,
}

fn path(state: &AppState, id: &str) -> PathBuf {
    state.paths.instance_dir(id).join("modsets.json")
}

fn load(state: &AppState, id: &str) -> SetsFile {
    std::fs::read(path(state, id)).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default()
}

fn save(state: &AppState, id: &str, f: &SetsFile) -> AppResult<()> {
    crate::util::write_json_atomic(&path(state, id), f)
}

/// Aktueller Zustand aller Inhalte: (aktiv, deaktiviert) als Schlüsselmengen.
async fn current(state: &AppState, id: &str) -> AppResult<(BTreeSet<String>, BTreeSet<String>)> {
    let mut on = BTreeSet::new();
    let mut off = BTreeSet::new();
    for k in ContentKind::ALL {
        let (scanned, _) = local::scan(state, id, k).await?;
        for s in scanned {
            if s.enabled {
                on.insert(s.key);
            } else {
                off.insert(s.key);
            }
        }
    }
    Ok((on, off))
}

fn info(s: &SetData) -> ModSet {
    ModSet { id: s.id.clone(), name: s.name.clone(), created: s.created, enabled_count: s.enabled.len() as u32, total_count: (s.enabled.len() + s.disabled.len()) as u32 }
}

pub async fn list(state: &AppState, id: &str) -> AppResult<ModSets> {
    state.instances.get(id)?;
    let f = load(state, id);
    let modified = match f.active.as_ref().and_then(|a| f.sets.iter().find(|s| &s.id == a)) {
        Some(set) => {
            let (on, off) = current(state, id).await?;
            // Abweichung: bekannte Dateien mit anderem Zustand
            on.iter().any(|k| set.disabled.contains(k)) || off.iter().any(|k| set.enabled.contains(k))
        }
        None => false,
    };
    Ok(ModSets { active: f.active.clone().filter(|a| f.sets.iter().any(|s| &s.id == a)), active_modified: modified, sets: f.sets.iter().map(info).collect() })
}

fn check_name(name: &str) -> AppResult<String> {
    let n = name.trim();
    if n.is_empty() {
        return Err(AppError::Invalid("Bitte einen Namen angeben".into()));
    }
    Ok(n.chars().take(60).collect())
}

/// Neues Set aus dem aktuellen Zustand (wird aktiv).
pub async fn create(state: &AppState, id: &str, name: &str) -> AppResult<ModSets> {
    state.instances.get(id)?;
    let name = check_name(name)?;
    let (on, off) = current(state, id).await?;
    let mut f = load(state, id);
    let set_id = uuid::Uuid::new_v4().to_string();
    f.sets.push(SetData { id: set_id.clone(), name, created: crate::util::now_ms(), enabled: on, disabled: off });
    f.active = Some(set_id);
    save(state, id, &f)?;
    list(state, id).await
}

/// Aktuellen Zustand in ein bestehendes Set übernehmen.
pub async fn overwrite(state: &AppState, id: &str, set_id: &str) -> AppResult<ModSets> {
    let (on, off) = current(state, id).await?;
    let mut f = load(state, id);
    let s = f.sets.iter_mut().find(|s| s.id == set_id).ok_or_else(|| AppError::NotFound("Mod-Set".into()))?;
    s.enabled = on;
    s.disabled = off;
    f.active = Some(set_id.to_string());
    save(state, id, &f)?;
    list(state, id).await
}

pub async fn rename(state: &AppState, id: &str, set_id: &str, name: &str) -> AppResult<ModSets> {
    let name = check_name(name)?;
    let mut f = load(state, id);
    let s = f.sets.iter_mut().find(|s| s.id == set_id).ok_or_else(|| AppError::NotFound("Mod-Set".into()))?;
    s.name = name;
    save(state, id, &f)?;
    list(state, id).await
}

pub async fn delete(state: &AppState, id: &str, set_id: &str) -> AppResult<ModSets> {
    let mut f = load(state, id);
    f.sets.retain(|s| s.id != set_id);
    if f.active.as_deref() == Some(set_id) {
        f.active = None;
    }
    save(state, id, &f)?;
    list(state, id).await
}

/// Set anwenden: Dateien aktivieren/deaktivieren.
pub async fn apply(state: &AppState, id: &str, set_id: &str) -> AppResult<ModSets> {
    state.instances.get(id)?;
    let mut f = load(state, id);
    let set = f.sets.iter().find(|s| s.id == set_id).cloned().ok_or_else(|| AppError::NotFound("Mod-Set".into()))?;
    let game = state.paths.game_dir(id);
    let mut errors = Vec::new();
    for k in ContentKind::ALL {
        let (scanned, _) = local::scan(state, id, k).await?;
        for s in scanned {
            let want = if set.enabled.contains(&s.key) {
                true
            } else if set.disabled.contains(&s.key) {
                false
            } else {
                continue;
            };
            if want == s.enabled {
                continue;
            }
            let base = index::strip_disabled(&s.file_name).to_string();
            let target = if want { base } else { format!("{base}.disabled") };
            let dir = game.join(k.folder());
            if let Err(e) = tokio::fs::rename(dir.join(&s.file_name), dir.join(&target)).await {
                errors.push(format!("{}: {e}", s.file_name));
            }
        }
    }
    f.active = Some(set_id.to_string());
    save(state, id, &f)?;
    state.content.emit_changed(id);
    if !errors.is_empty() {
        return Err(AppError::msg(format!("Einige Dateien konnten nicht umgeschaltet werden (läuft das Spiel?): {}", errors.join("; "))));
    }
    list(state, id).await
}
