pub mod context;
pub mod handlers;
pub mod heuristics;
pub mod hints;
pub mod index;
pub mod metadata;
pub mod mods;
pub mod pyre;
pub mod rules;
pub mod segment;
pub mod table;
pub mod types;

use serde::Serialize;
use serde_json::{Map, Value};

use crate::LogFile;
use context::{source_files, Source};
use index::Index;
pub use types::{Evidence, HostFinding, HostLabel, OMap};

#[derive(Serialize)]
pub struct HostResult {
    pub meta: Map<String, Value>,
    pub rules: HostLabel,
    pub heuristics: HostLabel,
}

pub fn with_metadata(files: &[LogFile], meta: Option<&Map<String, Value>>) -> Map<String, Value> {
    let empty = Map::new();
    let meta = meta.unwrap_or(&empty);
    if ["mc", "loader", "exit_code", "mods"].iter().all(|k| meta.contains_key(*k)) {
        return meta.clone();
    }
    let mut inferred = metadata::extract_meta(files);
    let mods = match inferred.remove("mods") {
        Some(Value::Array(items)) => items,
        _ => Vec::new(),
    };
    let id_of = |entry: &Value| entry.get("id").and_then(Value::as_str).map(str::to_owned);
    let provided = meta.get("mods").and_then(Value::as_array).filter(|p| !p.is_empty());
    let merged: Vec<Value> = match provided {
        Some(provided) => {
            let supplied: Vec<String> = provided.iter().filter_map(id_of).filter(|i| !i.is_empty()).collect();
            let mut merged: Vec<Value> =
                mods.iter().filter(|e| !id_of(e).is_some_and(|i| supplied.contains(&i))).cloned().collect();
            for entry in provided {
                let mut base = id_of(entry)
                    .and_then(|id| mods.iter().find(|m| id_of(m).as_deref() == Some(id.as_str())))
                    .and_then(Value::as_object)
                    .cloned()
                    .unwrap_or_default();
                if let Some(fields) = entry.as_object() {
                    for (k, v) in fields.iter().filter(|(_, v)| !v.is_null()) {
                        base.insert(k.clone(), v.clone());
                    }
                }
                merged.push(Value::Object(base));
            }
            merged
        }
        None => mods,
    };
    let mut out = inferred;
    for (k, v) in meta.iter().filter(|(_, v)| !v.is_null()) {
        out.insert(k.clone(), v.clone());
    }
    out.insert("mods".into(), Value::Array(merged));
    out
}

pub fn sources(files: &[LogFile]) -> Vec<Source> {
    source_files(files).into_iter().map(Source::new).collect()
}

pub fn run(files: &[LogFile], meta: Option<&Map<String, Value>>) -> HostResult {
    let meta = with_metadata(files, meta);
    let sources = sources(files);
    let mods: Vec<Value> = meta.get("mods").and_then(Value::as_array).cloned().unwrap_or_default();
    let index = Index::new(&mods);
    let rules = rules::diagnose(&sources, &meta, &index);
    let heuristics = heuristics::diagnose(&sources, files, &meta, &index, &rules.causes);
    HostResult { meta, rules, heuristics }
}
