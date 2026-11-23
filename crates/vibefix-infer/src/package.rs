use std::collections::{BTreeMap, HashMap};
use std::path::Path;

use serde::Deserialize;
use sha2::{Digest, Sha256};

use crate::error::{Error, Result};
use crate::weights::Weights;

pub const SUPPORTED_VERSIONS: &[u32] = &[1, 2, 3];
pub const SUPPORTED_TEXT: &str = "1, 2, 3";

#[derive(Debug, Clone, Deserialize)]
pub struct Network {
    pub vocab: usize,
    pub causes: Vec<String>,
    #[serde(default = "width")]
    pub width: usize,
    #[serde(default = "heads")]
    pub heads: usize,
    #[serde(default = "one")]
    pub line_layers: usize,
    #[serde(default = "two")]
    pub document_layers: usize,
    #[serde(default = "max_lines")]
    pub max_lines: usize,
    #[serde(default = "max_tokens")]
    pub max_tokens: usize,
}

fn width() -> usize {
    48
}
fn heads() -> usize {
    4
}
fn one() -> usize {
    1
}
fn two() -> usize {
    2
}
fn max_lines() -> usize {
    512
}
fn max_tokens() -> usize {
    64
}

#[derive(Debug, Clone, Deserialize)]
pub struct TensorInfo {
    pub shape: Vec<usize>,
    pub offset: usize,
}

#[derive(Debug, Clone, Deserialize)]
pub struct WeightInfo {
    pub dtype: String,
    pub length: usize,
    pub sha256: String,
    pub tensors: BTreeMap<String, TensorInfo>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Calibration {
    pub temperature: f64,
    pub threshold: f64,
    #[serde(default)]
    pub prototypes: Vec<Vec<f64>>,
    pub energy_center: f64,
    pub energy_scale: f64,
    pub distance_center: f64,
    pub distance_scale: f64,
    pub ood_threshold: f64,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Manifest {
    pub version: u32,
    pub network: Network,
    pub tags: Vec<String>,
    #[serde(default)]
    pub actions: HashMap<String, Vec<String>>,
    pub weights: WeightInfo,
    pub calibration: Calibration,
    #[serde(default)]
    pub smoke: bool,
    pub tokenizer_sha256: String,
    #[serde(default)]
    pub entities: Option<HashMap<String, Vec<String>>>,
}

#[derive(Deserialize)]
struct Header {
    version: u32,
}

pub fn sha256_hex(data: &[u8]) -> String {
    Sha256::digest(data).iter().map(|b| format!("{b:02x}")).collect()
}

pub fn package_version(data: &[u8]) -> Result<u32> {
    let header: Header = serde_json::from_slice(data)?;
    if !SUPPORTED_VERSIONS.contains(&header.version) {
        return Err(Error::Version { what: "config.json", found: header.version, supported: SUPPORTED_TEXT });
    }
    Ok(header.version)
}

pub fn parse_manifest(data: &[u8]) -> Result<Manifest> {
    if package_version(data)? != 1 {
        return Err(Error::Package("Paketformat 2 oder 3: mit AnyModel laden".into()));
    }
    let manifest: Manifest = serde_json::from_slice(data)?;
    if manifest.weights.dtype != "f16-le" {
        return Err(Error::Package(format!("Gewichtsformat {} wird nicht unterstützt", manifest.weights.dtype)));
    }
    Ok(manifest)
}

pub fn f16_to_f32(half: u16) -> f32 {
    let sign = u32::from(half & 0x8000) << 16;
    let exponent = u32::from((half >> 10) & 0x1f);
    let mantissa = u32::from(half & 0x3ff);
    let bits = match (exponent, mantissa) {
        (0, 0) => sign,
        (0, _) => {
            let mut e = 113u32;
            let mut m = mantissa;
            while m & 0x400 == 0 {
                m <<= 1;
                e -= 1;
            }
            sign | (e << 23) | ((m & 0x3ff) << 13)
        }
        (31, _) => sign | 0x7f80_0000 | (mantissa << 13),
        _ => sign | ((exponent + 112) << 23) | (mantissa << 13),
    };
    f32::from_bits(bits)
}

pub fn decode_weights(info: &WeightInfo, payload: &[u8]) -> Result<Weights> {
    if payload.len() != info.length {
        return Err(Error::Package(format!("weights.bin hat {} statt {} Bytes", payload.len(), info.length)));
    }
    if sha256_hex(payload) != info.sha256 {
        return Err(Error::Checksum("weights.bin"));
    }
    let mut weights = Weights::default();
    let mut offset = 0;
    for (name, tensor) in &info.tensors {
        let count: usize = tensor.shape.iter().product();
        if count < 1 || tensor.offset != offset || offset + count * 2 > payload.len() {
            return Err(Error::tensor(name, "ungültiger Offset oder ungültige Form"));
        }
        let data = payload[offset..offset + count * 2]
            .chunks_exact(2)
            .map(|pair| f16_to_f32(u16::from_le_bytes([pair[0], pair[1]])))
            .collect();
        weights.insert(name.clone(), tensor.shape.clone(), data);
        offset += count * 2;
    }
    if offset != payload.len() {
        return Err(Error::Package("unerwartete Daten am Ende von weights.bin".into()));
    }
    Ok(weights)
}

pub fn read_file(directory: &Path, name: &str) -> Result<Vec<u8>> {
    let path = directory.join(name);
    std::fs::read(&path).map_err(|e| Error::io(&path, e))
}
