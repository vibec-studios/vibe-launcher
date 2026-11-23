mod features;

use std::path::Path;

use serde::Deserialize;
use serde_json::{Map, Value};

use crate::package::read_file;
use crate::v2::decide::Prediction2;
use crate::v2::net::{Inputs2, Outputs2};
use crate::v2::package::parse_manifest;
use crate::v2::prepare::Prepared;
use crate::v2::Model2;
use crate::{Analysis, Error, LogFile, Result, Taxonomy};

#[derive(Deserialize)]
struct CrashHead {
    weight: [f32; features::COUNT],
    bias: f32,
}

#[derive(Deserialize)]
struct CrashPolicy {
    diagnosed_min: f64,
    unknown_min: f64,
}

#[derive(Deserialize)]
struct CrashConfig {
    crash_head: CrashHead,
    crash_policy: CrashPolicy,
}

impl CrashConfig {
    fn parse(config: &[u8]) -> Result<Self> {
        let result: Self = serde_json::from_slice(config)?;
        let head = &result.crash_head;
        if !head.bias.is_finite() || head.weight.iter().any(|v| !v.is_finite()) {
            return Err(Error::Package("Ungültiger Absturz-Kopf für VibeFix v3".into()));
        }
        Ok(result)
    }

    fn apply(&self, mut prediction: Prediction2, values: [f32; features::COUNT]) -> Prediction2 {
        let debug = values[features::DEBUG] > 0.0;
        let head = &self.crash_head;
        let dot: f32 = values.iter().zip(head.weight).map(|(&x, w)| x * w).sum();
        let score = if debug { 0.0 } else { f64::from(1.0 / (1.0 + (-(dot + head.bias).clamp(-60.0, 60.0)).exp())) };
        if score < self.crash_policy.diagnosed_min && prediction.status == "diagnosed" {
            prediction.causes.clear();
            prediction.entities.clear();
        }
        let unknown = prediction.causes.is_empty() && !debug && score >= self.crash_policy.unknown_min;
        let status = if !prediction.causes.is_empty() {
            "diagnosed"
        } else if unknown {
            "unknown"
        } else {
            "healthy"
        };
        prediction.status = status.to_owned();
        prediction.crash_score = score;
        prediction.ood_score = if unknown { score } else { 0.0 };
        prediction
    }
}

pub struct Model3 {
    base: Model2,
    crash: CrashConfig,
}

impl Model3 {
    pub fn load(directory: impl AsRef<Path>) -> Result<Self> {
        let dir = directory.as_ref();
        let config = read_file(dir, "config.json")?;
        let tokenizer = read_file(dir, "tokenizer.json")?;
        let weights = read_file(dir, "weights.bin")?;
        Self::from_bytes(&config, &tokenizer, &weights)
    }

    pub fn from_bytes(config: &[u8], tokenizer: &[u8], weights: &[u8]) -> Result<Self> {
        let manifest = parse_manifest(config, 3)?;
        let crash = CrashConfig::parse(config)?;
        let base = Model2::from_manifest(manifest, tokenizer, weights)?;
        Ok(Self { base, crash })
    }

    pub fn set_taxonomy(&mut self, taxonomy: Taxonomy) {
        self.base.set_taxonomy(taxonomy);
    }

    pub fn prepare(&self, files: &[LogFile], meta: Option<&Map<String, Value>>) -> Prepared {
        self.base.prepare(files, meta)
    }

    pub fn features(
        &self,
        files: &[LogFile],
        meta: Option<&Map<String, Value>>,
        prepared: &Prepared,
    ) -> [f32; features::COUNT] {
        features::extract(files, meta, prepared)
    }

    pub fn run(&self, prepared: &Prepared) -> (Inputs2, Outputs2) {
        self.base.run(prepared)
    }

    pub fn decide(&self, prepared: &Prepared, output: &Outputs2, features: [f32; features::COUNT]) -> Prediction2 {
        self.crash.apply(self.base.decide(prepared, output), features)
    }

    pub fn predict(&self, files: &[LogFile], meta: Option<&Map<String, Value>>) -> Prediction2 {
        let prepared = self.prepare(files, meta);
        let features = self.features(files, meta, &prepared);
        let (_, output) = self.run(&prepared);
        self.decide(&prepared, &output, features)
    }

    pub fn convert(&self, prediction: Prediction2) -> Analysis {
        self.base.convert(prediction)
    }

    pub fn analyze_with_meta(&self, files: &[LogFile], meta: Option<&Map<String, Value>>) -> Analysis {
        self.convert(self.predict(files, meta))
    }
}
