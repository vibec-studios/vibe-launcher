use std::collections::{HashMap, HashSet};

use serde::ser::{SerializeMap, Serializer};
use serde::Serialize;

use crate::diagnosis::{Entity, Location, Prediction};
use crate::unicode::strip;

pub const WINDOW: usize = 8;
pub const PER_KEY: usize = 4;
pub const OOD_BLOCK: f64 = 0.7;

pub type Taxonomy = HashMap<String, Vec<String>>;

pub fn builtin_taxonomy() -> Taxonomy {
    serde_json::from_str(include_str!("../data/cause_entities.json")).unwrap_or_default()
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct EntityMap(pub Vec<(String, Vec<String>)>);

impl Serialize for EntityMap {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let mut map = serializer.serialize_map(Some(self.0.len()))?;
        for (key, values) in &self.0 {
            map.serialize_entry(key, values)?;
        }
        map.end()
    }
}

impl EntityMap {
    pub fn get(&self, key: &str) -> Option<&[String]> {
        self.0.iter().find(|(k, _)| k == key).map(|(_, v)| v.as_slice())
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct Cause {
    pub cause: String,
    pub confidence: f64,
    pub actions: Vec<String>,
    pub entities: EntityMap,
    pub evidence: Option<Location>,
    pub locations: Vec<Location>,
}

#[derive(Debug, Clone, Serialize)]
pub struct Analysis {
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub crash_score: Option<f64>,
    pub ood: f64,
    pub ood_score: f64,
    pub healthy: bool,
    pub causes: Vec<Cause>,
    pub entities: Vec<Entity>,
}

fn distance(entity: &Entity, evidence: &[Location]) -> Option<usize> {
    let file = entity.file.as_deref().filter(|f| !f.is_empty());
    let line = entity.line?;
    evidence
        .iter()
        .filter(|ev| ev.file.is_empty() || file.map_or(true, |f| ev.file == f))
        .map(|ev| ev.line.abs_diff(line))
        .min()
}

fn clean(text: &str) -> &str {
    strip(text).trim_matches(['\'', '"', '`'])
}

pub fn attach_entities(cause: &str, evidence: &[Location], entities: &[Entity], taxonomy: &Taxonomy) -> EntityMap {
    let wanted: Option<HashSet<&str>> = taxonomy.get(cause).map(|v| v.iter().map(String::as_str).collect());
    let pool: Vec<&Entity> = entities
        .iter()
        .filter(|e| wanted.as_ref().map_or(true, |w| w.contains(e.entity.to_lowercase().as_str())))
        .collect();
    let mut near: Vec<(usize, &Entity)> =
        pool.iter().filter_map(|e| distance(e, evidence).filter(|&d| d <= WINDOW).map(|d| (d, *e))).collect();
    near.sort_by_key(|(d, _)| *d);
    let chosen: Vec<&Entity> = if near.is_empty() { pool } else { near.into_iter().map(|(_, e)| e).collect() };
    let mut out = EntityMap::default();
    for entity in chosen {
        let text = clean(&entity.text);
        if text.is_empty() {
            continue;
        }
        let key = entity.entity.to_lowercase();
        let slot = match out.0.iter().position(|(k, _)| *k == key) {
            Some(i) => i,
            None => {
                out.0.push((key, Vec::new()));
                out.0.len() - 1
            }
        };
        let values = &mut out.0[slot].1;
        if !values.iter().any(|v| v == text) && values.len() < PER_KEY {
            values.push(text.to_owned());
        }
    }
    out
}

pub fn convert(prediction: Prediction, taxonomy: &Taxonomy) -> Analysis {
    let causes: Vec<Cause> = prediction
        .causes
        .iter()
        .map(|finding| Cause {
            cause: finding.cause.clone(),
            confidence: finding.confidence,
            actions: finding.actions.clone(),
            entities: attach_entities(&finding.cause, &finding.evidence, &prediction.entities, taxonomy),
            evidence: finding.evidence.first().cloned(),
            locations: finding.evidence.clone(),
        })
        .collect();
    let unknown = prediction.status == "unknown";
    let ood = if unknown { prediction.ood_score.max(OOD_BLOCK) } else { prediction.ood_score };
    Analysis {
        crash_score: None,
        healthy: prediction.status == "healthy" && causes.is_empty(),
        status: prediction.status,
        ood,
        ood_score: prediction.ood_score,
        causes,
        entities: prediction.entities,
    }
}
