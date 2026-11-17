//! Metadaten-Index je Instanz: `instances/<id>/content.json`.
//!
//! - `files`: Herkunft installierter Dateien (Modrinth/CurseForge-Projekt + Version), Schlüssel ist der
//!   relative Pfad im Spielordner **ohne** `.disabled` (z. B. `mods/sodium.jar`).
//! - `local`: Cache der aus den Dateien gelesenen Metadaten (Name, Version, Icon …), gültig solange
//!   Größe + Änderungszeit gleich sind.
//! - `unknown`: SHA-1-Werte, die auf keiner Plattform gefunden wurden (nicht erneut fragen).
use super::Source;
use crate::error::AppResult;
use crate::paths::Paths;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IndexEntry {
    pub source: Source,
    pub project_id: String,
    /// Modrinth-Versions-ID bzw. CurseForge-Datei-ID
    pub version_id: String,
    #[serde(default)]
    pub sha1: Option<String>,
    #[serde(default)]
    pub sha512: Option<String>,
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub icon_url: Option<String>,
    #[serde(default)]
    pub version_number: Option<String>,
    #[serde(default)]
    pub url: Option<String>,
    #[serde(default)]
    pub size: Option<u64>,
    /// Veröffentlichungsdatum der Version (ISO-8601)
    #[serde(default)]
    pub date: Option<String>,
    #[serde(default)]
    pub release_type: Option<String>,
}

/// Aus der Datei gelesene Metadaten (Cache).
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(default)]
pub struct LocalMeta {
    pub size: u64,
    pub mtime: i64,
    pub is_dir: bool,
    pub sha1: Option<String>,
    /// CurseForge-Fingerprint
    pub murmur2: Option<u32>,
    pub mod_id: Option<String>,
    pub name: Option<String>,
    pub version: Option<String>,
    pub description: Option<String>,
    pub authors: Vec<String>,
    /// Dateiname unter `cache/icons/`
    pub icon: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(default)]
pub struct UnknownHash {
    pub modrinth: bool,
    pub curseforge: bool,
    pub checked_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(default)]
pub struct ContentIndex {
    pub format: u32,
    pub files: BTreeMap<String, IndexEntry>,
    pub local: BTreeMap<String, LocalMeta>,
    pub unknown: BTreeMap<String, UnknownHash>,
}

pub fn index_path(paths: &Paths, instance_id: &str) -> PathBuf {
    paths.instance_dir(instance_id).join("content.json")
}

/// Schlüssel für eine Datei: `<ordner>/<name ohne .disabled>`.
pub fn key(folder: &str, file_name: &str) -> String {
    format!("{folder}/{}", strip_disabled(file_name))
}

pub fn strip_disabled(file_name: &str) -> &str {
    file_name.strip_suffix(".disabled").unwrap_or(file_name)
}

impl ContentIndex {
    pub fn load(paths: &Paths, instance_id: &str) -> ContentIndex {
        let p = index_path(paths, instance_id);
        match std::fs::read(&p) {
            Ok(b) => serde_json::from_slice(&b).unwrap_or_else(|e| {
                tracing::warn!("content.json von {instance_id} unlesbar, wird neu aufgebaut: {e}");
                ContentIndex::default()
            }),
            Err(_) => ContentIndex::default(),
        }
    }

    pub fn save(&mut self, paths: &Paths, instance_id: &str) -> AppResult<()> {
        self.format = 1;
        let dir = paths.instance_dir(instance_id);
        if !dir.exists() {
            // Instanz wurde inzwischen gelöscht – nichts schreiben
            return Ok(());
        }
        crate::util::write_json_atomic(&index_path(paths, instance_id), self)
    }

    /// Alle Einträge eines Projekts (Schlüssel).
    pub fn keys_of_project(&self, source: Source, project_id: &str) -> Vec<String> {
        self.files.iter().filter(|(_, e)| e.source == source && e.project_id == project_id).map(|(k, _)| k.clone()).collect()
    }

    pub fn has_project(&self, source: Source, project_id: &str) -> bool {
        self.files.values().any(|e| e.source == source && e.project_id == project_id)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn keys() {
        assert_eq!(key("mods", "a.jar.disabled"), "mods/a.jar");
        assert_eq!(key("resourcepacks", "Pack"), "resourcepacks/Pack");
    }
}
