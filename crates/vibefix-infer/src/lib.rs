pub mod analysis;
mod any;
mod block;
mod category;
pub mod diagnosis;
mod error;
mod features;
mod gemm;
mod hash;
pub mod host;
mod math;
mod net;
mod normalize;
mod package;
mod parts;
mod prefix;
mod readlog;
mod sample;
mod segment;
mod select;
mod tables;
mod tokenizer;
mod trunk;
mod unicode;
pub mod v2;
pub mod v3;
mod weights;

use std::path::Path;

use serde::{Deserialize, Serialize};

pub use analysis::{attach_entities, builtin_taxonomy, convert, Analysis, Cause, EntityMap, Taxonomy};
pub use any::AnyModel;
pub use diagnosis::{Entity, Finding, Location, Prediction};
pub use error::{Error, Result};
pub use features::crc32;
pub use net::Outputs;
pub use normalize::normalize;
pub use package::{package_version, Manifest, SUPPORTED_VERSIONS};
pub use readlog::{identify, read_log, read_log_bytes};
pub use sample::{bound_text, MAX_TEXT_BYTES};
pub use select::Line;
pub use tables::unicode_version;
pub use tokenizer::Tokenizer;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LogFile {
    #[serde(default)]
    pub kind: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub text: String,
}

pub struct Encoded {
    pub lines: Vec<Line>,
    pub tokens: Vec<Vec<u32>>,
}

pub struct Model {
    pub manifest: Manifest,
    pub tokenizer: Tokenizer,
    network: net::Network,
    prototypes: Vec<Vec<f32>>,
    taxonomy: Taxonomy,
}

impl Model {
    pub fn load(directory: impl AsRef<Path>) -> Result<Self> {
        let dir = directory.as_ref();
        let config = package::read_file(dir, "config.json")?;
        let tokenizer = package::read_file(dir, "tokenizer.json")?;
        let weights = package::read_file(dir, "weights.bin")?;
        Self::from_bytes(&config, &tokenizer, &weights)
    }

    pub fn from_bytes(config: &[u8], tokenizer: &[u8], weights: &[u8]) -> Result<Self> {
        let manifest = package::parse_manifest(config)?;
        if package::sha256_hex(tokenizer) != manifest.tokenizer_sha256 {
            return Err(Error::Checksum("tokenizer.json"));
        }
        let tokenizer = Tokenizer::parse(tokenizer)?;
        if tokenizer.len() != manifest.network.vocab {
            return Err(Error::Package("Tokenizer-Vokabular passt nicht zum Modell".into()));
        }
        let tensors = package::decode_weights(&manifest.weights, weights)?;
        let network = net::Network::load(manifest.network.clone(), tensors, manifest.tags.len())?;
        let width = manifest.network.width;
        let prototypes: Vec<Vec<f32>> =
            manifest.calibration.prototypes.iter().map(|p| p.iter().map(|&v| v as f32).collect()).collect();
        if prototypes.iter().any(|p| p.len() != width) {
            return Err(Error::Package("Kalibrierungsprototypen haben die falsche Breite".into()));
        }
        let taxonomy = manifest.entities.clone().unwrap_or_else(builtin_taxonomy);
        Ok(Self { manifest, tokenizer, network, prototypes, taxonomy })
    }

    pub fn set_taxonomy(&mut self, taxonomy: Taxonomy) {
        self.taxonomy = taxonomy;
    }

    pub fn encode(&self, files: &[LogFile]) -> Encoded {
        let net = &self.manifest.network;
        let mut lines = select::select_lines(files, net.max_lines);
        if lines.is_empty() {
            lines.push(Line { file: String::new(), number: 0, text: String::new(), features: [0; 4], start_byte: 0 });
        }
        let mut cache = tokenizer::ChunkCache::new();
        let tokens = lines
            .iter()
            .map(|line| {
                let mut ids = vec![tokenizer::LINE];
                ids.extend(self.tokenizer.encode(&line.text, net.max_tokens - 1, &mut cache));
                ids
            })
            .collect();
        Encoded { lines, tokens }
    }

    pub fn run(&self, encoded: &Encoded) -> Outputs {
        let features: Vec<[u32; 4]> = encoded.lines.iter().map(|l| l.features).collect();
        self.network.forward(&encoded.tokens, &features)
    }

    pub fn decide(&self, encoded: &Encoded, outputs: &Outputs) -> Prediction {
        let m = &self.manifest;
        let ctx = diagnosis::Context {
            causes: &m.network.causes,
            actions: &m.actions,
            calibration: &m.calibration,
            prototypes: &self.prototypes,
        };
        let (status, ood, causes) = diagnosis::diagnose(&encoded.lines, outputs, &ctx);
        let entities = diagnosis::decode_entities(&encoded.lines, &encoded.tokens, outputs, &m.tags, &self.tokenizer);
        Prediction { status, ood_score: f64::from(ood), causes, entities }
    }

    pub fn predict(&self, files: &[LogFile]) -> Prediction {
        let encoded = self.encode(files);
        let outputs = self.run(&encoded);
        self.decide(&encoded, &outputs)
    }

    pub fn analyze_exact(&self, files: &[LogFile]) -> Analysis {
        convert(self.predict(files), &self.taxonomy)
    }

    pub fn analyze(&self, files: &[LogFile]) -> Analysis {
        let bounded: Vec<LogFile> = files
            .iter()
            .map(|f| LogFile { kind: f.kind.clone(), name: f.name.clone(), text: bound_text(&f.text).into_owned() })
            .collect();
        self.analyze_exact(&bounded)
    }
}
