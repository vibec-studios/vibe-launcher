use std::collections::HashMap;

use serde::Deserialize;

use crate::error::{Error, Result};
use crate::package::WeightInfo;
use crate::v2::capping::Budget;

#[derive(Debug, Clone, Deserialize)]
pub struct Network2 {
    pub vocab: usize,
    pub causes: Vec<String>,
    #[serde(default = "width")]
    pub width: usize,
    #[serde(default = "four")]
    pub heads: usize,
    #[serde(default = "one")]
    pub line_layers: usize,
    #[serde(default = "two")]
    pub document_layers: usize,
    #[serde(default = "lines")]
    pub max_lines: usize,
    #[serde(default = "tokens")]
    pub max_tokens: usize,
    #[serde(default = "flags")]
    pub flags: usize,
    #[serde(default = "candidate_width")]
    pub candidate_width: usize,
    #[serde(default = "entity_types")]
    pub entity_types: usize,
    #[serde(default = "yes")]
    pub use_rules: bool,
}

fn width() -> usize {
    64
}
fn four() -> usize {
    4
}
fn one() -> usize {
    1
}
fn two() -> usize {
    2
}
fn lines() -> usize {
    512
}
fn tokens() -> usize {
    64
}
fn flags() -> usize {
    16
}
fn candidate_width() -> usize {
    38
}
fn entity_types() -> usize {
    9
}
fn yes() -> bool {
    true
}

#[derive(Debug, Clone, Deserialize)]
#[serde(default)]
pub struct Calibration2 {
    pub temperature: f64,
    pub cause: f64,
    pub crash: f64,
    pub unknown: f64,
    pub entity: f64,
    pub rule_floor: f64,
    pub heuristic_floor: f64,
    pub max_causes: f64,
    pub specific: f64,
    pub joint: f64,
    pub require_fatal: f64,
    pub rule_crash: f64,
    pub rule_fatal: f64,
    pub conf_scale: f64,
    pub sparse: f64,
    pub debug_crash: f64,
}

impl Default for Calibration2 {
    fn default() -> Self {
        Self {
            temperature: 1.0,
            cause: 0.5,
            crash: 0.5,
            unknown: 0.5,
            entity: 0.5,
            rule_floor: 0.85,
            heuristic_floor: 1.01,
            max_causes: 3.0,
            specific: 1.0,
            joint: 1.0,
            require_fatal: 0.0,
            rule_crash: 0.0,
            rule_fatal: 0.0,
            conf_scale: 1.0,
            sparse: 0.0,
            debug_crash: 1.0,
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
pub struct Manifest2 {
    pub version: u32,
    pub network: Network2,
    pub weights: WeightInfo,
    #[serde(default)]
    pub calibration: Calibration2,
    #[serde(default)]
    pub profiles: HashMap<String, Calibration2>,
    #[serde(default)]
    pub actions: HashMap<String, Vec<String>>,
    #[serde(default)]
    pub entities: HashMap<String, Vec<String>>,
    pub tokenizer_sha256: String,
    #[serde(default)]
    pub smoke: bool,
    #[serde(default)]
    pub budget: Option<Budget>,
}

const KNOWN: [&str; 16] = [
    "temperature",
    "cause",
    "crash",
    "unknown",
    "entity",
    "rule_floor",
    "heuristic_floor",
    "max_causes",
    "specific",
    "joint",
    "require_fatal",
    "rule_crash",
    "rule_fatal",
    "conf_scale",
    "sparse",
    "debug_crash",
];

pub fn parse_manifest2(data: &[u8]) -> Result<Manifest2> {
    parse_manifest(data, 2)
}

pub(crate) fn parse_manifest(data: &[u8], version: u32) -> Result<Manifest2> {
    let raw: serde_json::Value = serde_json::from_slice(data)?;
    let calibration = raw.get("calibration").into_iter();
    let profiles = raw.get("profiles").and_then(serde_json::Value::as_object).into_iter().flat_map(|p| p.values());
    for settings in calibration.chain(profiles) {
        let Some(keys) = settings.as_object() else { continue };
        if let Some(key) = keys.keys().find(|k| !KNOWN.contains(&k.as_str())) {
            return Err(Error::Package(format!(
                "unbekannter Kalibrierungsschalter {key}; bitte vibefix-infer aktualisieren"
            )));
        }
    }
    let manifest: Manifest2 = serde_json::from_value(raw)?;
    if manifest.version != version {
        return Err(Error::Version {
            what: "config.json",
            found: manifest.version,
            supported: if version == 2 { "2" } else { "3" },
        });
    }
    if manifest.weights.dtype != "f16-le" {
        return Err(Error::Package(format!("Gewichtsformat {} wird nicht unterstützt", manifest.weights.dtype)));
    }
    Ok(manifest)
}
