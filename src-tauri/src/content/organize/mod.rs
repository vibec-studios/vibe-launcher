pub mod edit;
pub mod needs;
pub mod record;
pub mod store;
pub mod view;

use super::index::{self, ContentIndex};
use super::{local, ContentKind};
use crate::error::AppResult;
use crate::state::AppState;
use needs::Node;
use serde::Deserialize;
use std::collections::HashSet;

pub use record::InstallNote;

#[derive(Debug, Clone, Deserialize)]
pub struct Target {
    pub kind: ContentKind,
    pub file_name: String,
}

pub fn item_key(idx: &ContentIndex, file_key: &str) -> String {
    match idx.files.get(file_key) {
        Some(e) => format!("{}:{}", e.source.as_string(), e.project_id),
        None => format!("file:{file_key}"),
    }
}

pub fn target_key(idx: &ContentIndex, t: &Target) -> String {
    item_key(idx, &index::key(t.kind.folder(), &t.file_name))
}

#[derive(Debug, Clone)]
pub struct Entry {
    pub kind: ContentKind,
    pub file: String,
    pub file_name: String,
    pub enabled: bool,
    pub name: String,
    pub key: String,
    pub from_pack: bool,
    pub node: Option<Node>,
}

struct PackInfo {
    paths: HashSet<String>,
    projects: HashSet<String>,
}

fn pack_info(state: &AppState, instance_id: &str) -> Option<PackInfo> {
    let bytes = std::fs::read(state.paths.instance_dir(instance_id).join("pack.json")).ok()?;
    let rec: super::modpack::PackRecord = serde_json::from_slice(&bytes).ok()?;
    let norm = |p: &str| p.replace('\\', "/").trim_start_matches("./").to_string();
    let mut paths: HashSet<String> = rec.files.keys().map(|k| norm(k)).collect();
    paths.extend(rec.overrides.keys().map(|k| norm(k)));
    let projects = rec.files.values().filter_map(|f| f.project.clone()).collect();
    Some(PackInfo { paths, projects })
}

fn display_name(idx: &ContentIndex, s: &local::Scanned) -> String {
    idx.files
        .get(&s.key)
        .and_then(|e| e.title.clone())
        .or_else(|| s.meta.name.clone())
        .filter(|n| !n.trim().is_empty())
        .unwrap_or_else(|| index::strip_disabled(&s.file_name).to_string())
}

fn node_of(key: &str, s: &local::Scanned) -> Node {
    let mut mod_ids: Vec<String> = s.meta.mod_id.iter().cloned().collect();
    mod_ids.extend(s.meta.provides.iter().cloned());
    let requires = s.meta.deps.iter().filter(|d| d.kind == "required").map(|d| d.id.clone()).collect();
    Node { key: key.to_string(), mod_ids, requires }
}

pub const KINDS: [ContentKind; 3] = [ContentKind::Mod, ContentKind::Resourcepack, ContentKind::Shader];

pub async fn collect(state: &AppState, instance_id: &str) -> AppResult<(Vec<Entry>, bool)> {
    let pack = pack_info(state, instance_id);
    let mut out = Vec::new();
    for kind in KINDS {
        let (scanned, idx) = local::scan(state, instance_id, kind).await?;
        for s in &scanned {
            let key = item_key(&idx, &s.key);
            let from_pack = pack.as_ref().is_some_and(|p| {
                p.paths.contains(&s.key) || idx.files.get(&s.key).is_some_and(|e| p.projects.contains(&format!("{}|{}", e.source.as_string(), e.project_id)))
            });
            out.push(Entry {
                kind,
                file: index::strip_disabled(&s.file_name).to_string(),
                file_name: s.file_name.clone(),
                enabled: s.enabled,
                name: display_name(&idx, s),
                node: (kind == ContentKind::Mod).then(|| node_of(&key, s)),
                key,
                from_pack,
            });
        }
    }
    Ok((out, pack.is_some()))
}

pub fn nodes(entries: &[Entry]) -> Vec<Node> {
    entries.iter().filter_map(|e| e.node.clone()).collect()
}
