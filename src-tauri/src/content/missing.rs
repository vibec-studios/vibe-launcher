//! Dateien, die manuell heruntergeladen werden müssen (`instances/<id>/missing.json`).
//!
//! CurseForge erlaubt Autoren, Downloads über Drittanbieter-Launcher zu sperren (`downloadUrl == null`).
//! Solche Dateien landen hier; das Frontend zeigt einen Hinweis mit Links. Legt der Nutzer die Datei
//! in den Zielordner – oder liegt sie mit gleichem Namen im Download-Ordner des Systems – wird sie
//! erkannt (aus dem Download-Ordner automatisch übernommen) und verschwindet aus der Liste.
use super::{ContentKind, MissingDownload};
use crate::error::AppResult;
use crate::paths::Paths;
use crate::state::AppState;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MissingEntry {
    #[serde(flatten)]
    pub info: MissingDownload,
    #[serde(default)]
    pub sha1: Option<String>,
    #[serde(default)]
    pub project_id: Option<String>,
    #[serde(default)]
    pub file_id: Option<String>,
}

fn path(paths: &Paths, instance_id: &str) -> PathBuf {
    paths.instance_dir(instance_id).join("missing.json")
}

pub fn load(paths: &Paths, instance_id: &str) -> Vec<MissingEntry> {
    std::fs::read(path(paths, instance_id)).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default()
}

fn save(paths: &Paths, instance_id: &str, list: &[MissingEntry]) -> AppResult<()> {
    let p = path(paths, instance_id);
    if list.is_empty() {
        if p.exists() {
            std::fs::remove_file(p)?;
        }
        return Ok(());
    }
    crate::util::write_json_atomic(&p, &list)
}

/// Einträge hinzufügen (gleiche Datei im gleichen Ordner wird ersetzt).
pub fn add(paths: &Paths, instance_id: &str, entries: Vec<MissingEntry>) -> AppResult<()> {
    if entries.is_empty() {
        return Ok(());
    }
    let mut list = load(paths, instance_id);
    for e in entries {
        list.retain(|x| !(x.info.file_name == e.info.file_name && x.info.kind == e.info.kind));
        list.push(e);
    }
    save(paths, instance_id, &list)
}

pub fn dismiss(paths: &Paths, instance_id: &str) -> AppResult<()> {
    save(paths, instance_id, &[])
}

fn target(paths: &Paths, instance_id: &str, kind: ContentKind, file_name: &str) -> PathBuf {
    paths.game_dir(instance_id).join(kind.folder()).join(file_name)
}

/// Noch fehlende Dateien. Dateien aus dem System-Download-Ordner werden übernommen.
pub async fn list(state: &AppState, instance_id: &str) -> AppResult<Vec<MissingDownload>> {
    state.instances.get(instance_id)?;
    let paths = state.paths.clone();
    let id = instance_id.to_string();
    let (remaining, moved) = tokio::task::spawn_blocking(move || -> AppResult<(Vec<MissingEntry>, bool)> {
        let list = load(&paths, &id);
        if list.is_empty() {
            return Ok((list, false));
        }
        let downloads = dirs::download_dir();
        let mut moved = false;
        let mut remaining = Vec::new();
        for e in &list {
            let dst = target(&paths, &id, e.info.kind, &e.info.file_name);
            let disabled = dst.with_file_name(format!("{}.disabled", e.info.file_name));
            if dst.exists() || disabled.exists() {
                continue;
            }
            if let Some(src) = downloads.as_ref().map(|d| d.join(&e.info.file_name)).filter(|p| p.is_file()) {
                let ok = match &e.sha1 {
                    Some(h) => crate::net::sha1_file(&src).map(|x| x.eq_ignore_ascii_case(h)).unwrap_or(false),
                    None => true,
                };
                if ok {
                    if let Some(parent) = dst.parent() {
                        std::fs::create_dir_all(parent)?;
                    }
                    if std::fs::copy(&src, &dst).is_ok() {
                        moved = true;
                        continue;
                    }
                }
            }
            remaining.push(e.clone());
        }
        if remaining.len() != list.len() {
            save(&paths, &id, &remaining)?;
        }
        Ok((remaining, moved))
    })
    .await??;
    if moved {
        state.content.emit_changed(instance_id);
    }
    Ok(remaining.into_iter().map(|e| e.info).collect())
}
