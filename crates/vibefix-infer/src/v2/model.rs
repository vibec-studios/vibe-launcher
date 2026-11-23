use std::collections::HashMap;
use std::path::Path;

use serde_json::{Map, Value};

use super::capping::Budget;
use super::decide::{decide, Context2, Prediction2};
use super::encode::encode;
use super::net::{Inputs2, Network2Model, Outputs2};
use super::package::{parse_manifest2, Calibration2, Manifest2};
use super::pool::entity_kind;
use super::prepare::{prepare, Prepared};
use crate::analysis::{builtin_taxonomy, convert, Analysis, Taxonomy};
use crate::diagnosis::Prediction;
use crate::error::{Error, Result};
use crate::package::{decode_weights, read_file, sha256_hex};
use crate::tokenizer::Tokenizer;
use crate::LogFile;

pub struct Model2 {
    pub manifest: Manifest2,
    pub tokenizer: Tokenizer,
    network: Network2Model,
    types: HashMap<String, Vec<usize>>,
    taxonomy: Taxonomy,
    budget: Budget,
    profile: Option<Calibration2>,
}

impl Model2 {
    pub fn load(directory: impl AsRef<Path>) -> Result<Self> {
        let dir = directory.as_ref();
        let config = read_file(dir, "config.json")?;
        let tokenizer = read_file(dir, "tokenizer.json")?;
        let weights = read_file(dir, "weights.bin")?;
        Self::from_bytes(&config, &tokenizer, &weights)
    }

    pub fn from_bytes(config: &[u8], tokenizer: &[u8], weights: &[u8]) -> Result<Self> {
        Self::from_manifest(parse_manifest2(config)?, tokenizer, weights)
    }

    pub(crate) fn from_manifest(manifest: Manifest2, tokenizer: &[u8], weights: &[u8]) -> Result<Self> {
        if sha256_hex(tokenizer) != manifest.tokenizer_sha256 {
            return Err(Error::Checksum("tokenizer.json"));
        }
        let tokenizer = Tokenizer::parse(tokenizer)?;
        if tokenizer.len() != manifest.network.vocab {
            return Err(Error::Package("Tokenizer-Vokabular passt nicht zum Modell".into()));
        }
        let tensors = decode_weights(&manifest.weights, weights)?;
        let network = Network2Model::load(manifest.network.clone(), tensors)?;
        let types = manifest
            .entities
            .iter()
            .map(|(cause, keys)| {
                let mut kinds: Vec<usize> = keys.iter().filter_map(|k| entity_kind(k)).collect();
                kinds.sort_unstable();
                kinds.dedup();
                (cause.clone(), kinds)
            })
            .collect();
        let budget = manifest.budget.unwrap_or_default();
        Ok(Self { manifest, tokenizer, network, types, taxonomy: builtin_taxonomy(), budget, profile: None })
    }

    pub fn set_profile(&mut self, name: Option<&str>) -> Result<()> {
        self.profile = match name.filter(|name| !name.is_empty()) {
            Some(name) => Some(
                self.manifest
                    .profiles
                    .get(name)
                    .cloned()
                    .ok_or_else(|| Error::Package(format!("Unbekanntes Kalibrierungsprofil: {name}")))?,
            ),
            None => None,
        };
        Ok(())
    }

    pub fn set_taxonomy(&mut self, taxonomy: Taxonomy) {
        self.taxonomy = taxonomy;
    }

    pub fn prepare(&self, files: &[LogFile], meta: Option<&Map<String, Value>>) -> Prepared {
        let net = &self.manifest.network;
        prepare(files, meta, &net.causes, &self.budget, net.max_lines)
    }

    pub fn run(&self, prepared: &Prepared) -> (Inputs2, Outputs2) {
        let net = &self.manifest.network;
        let inputs = encode(prepared, &self.tokenizer, net.max_tokens, net.entity_types);
        let outputs = self.network.forward(&inputs);
        (inputs, outputs)
    }

    pub fn decide(&self, prepared: &Prepared, outputs: &Outputs2) -> Prediction2 {
        let m = &self.manifest;
        let ctx = Context2 {
            causes: &m.network.causes,
            actions: &m.actions,
            types: &self.types,
            calibration: self.profile.as_ref().unwrap_or(&m.calibration),
        };
        decide(prepared, outputs, &ctx)
    }

    pub fn predict(&self, files: &[LogFile], meta: Option<&Map<String, Value>>) -> Prediction2 {
        let prepared = self.prepare(files, meta);
        let (_, outputs) = self.run(&prepared);
        self.decide(&prepared, &outputs)
    }

    pub fn convert(&self, prediction: Prediction2) -> Analysis {
        let crash = prediction.crash_score;
        let plain = Prediction {
            status: prediction.status,
            ood_score: prediction.ood_score,
            causes: prediction.causes,
            entities: prediction.entities,
        };
        let mut analysis = convert(plain, &self.taxonomy);
        analysis.crash_score = Some(crash);
        analysis
    }

    pub fn analyze_with_meta(&self, files: &[LogFile], meta: Option<&Map<String, Value>>) -> Analysis {
        self.convert(self.predict(files, meta))
    }

    pub fn analyze(&self, files: &[LogFile]) -> Analysis {
        self.analyze_with_meta(files, None)
    }
}
