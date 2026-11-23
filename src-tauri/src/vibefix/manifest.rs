use base64::Engine;
use serde::{Deserialize, Serialize};
use std::cmp::Ordering;

pub const FILES: [&str; 3] = ["config.json", "tokenizer.json", "weights.bin"];
const MAX_FILE: u64 = 64 << 20;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ManifestFile {
    pub name: String,
    pub asset: String,
    pub size: u64,
    pub sha256: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Manifest {
    pub schema: u32,
    pub name: String,
    pub version: String,
    pub format: u32,
    #[serde(default)]
    pub published: Option<String>,
    pub files: Vec<ManifestFile>,
}

#[derive(Debug, Clone, PartialEq, thiserror::Error)]
pub enum ModelError {
    #[error("Die Signatur des VibeFix-Modells ist ungültig")]
    Signature,
    #[error("Das VibeFix-Manifest ist ungültig: {0}")]
    Invalid(String),
    #[error("VibeFix-Format {0} wird von dieser Launcher-Version nicht unterstützt")]
    Unsupported(u32),
    #[error("{0} passt nicht zum VibeFix-Manifest")]
    Mismatch(String),
    #[error("Kein VibeFix-Modell vorhanden")]
    Missing,
    #[error("{0}")]
    Io(String),
}

impl From<std::io::Error> for ModelError {
    fn from(e: std::io::Error) -> Self {
        ModelError::Io(e.to_string())
    }
}

pub fn decode_key(b64: &str) -> Vec<u8> {
    base64::engine::general_purpose::STANDARD.decode(b64.trim()).unwrap_or_default()
}

pub fn verify_signature(body: &[u8], sig: &[u8], key: &[u8]) -> Result<(), ModelError> {
    let text = std::str::from_utf8(sig).map_err(|_| ModelError::Signature)?;
    let raw = base64::engine::general_purpose::STANDARD.decode(text.trim()).map_err(|_| ModelError::Signature)?;
    ring::signature::UnparsedPublicKey::new(&ring::signature::ED25519, key).verify(body, &raw).map_err(|_| ModelError::Signature)
}

pub fn parse_manifest(body: &[u8], sig: &[u8], key: &[u8]) -> Result<Manifest, ModelError> {
    verify_signature(body, sig, key)?;
    let manifest: Manifest = serde_json::from_slice(body).map_err(|e| ModelError::Invalid(e.to_string()))?;
    manifest.validate()?;
    Ok(manifest)
}

pub fn safe_name(s: &str) -> bool {
    !s.is_empty() && s.len() <= 96 && !s.starts_with('.') && s.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'))
}

fn hex64(s: &str) -> bool {
    s.len() == 64 && s.chars().all(|c| c.is_ascii_digit() || ('a'..='f').contains(&c))
}

impl Manifest {
    pub fn validate(&self) -> Result<(), ModelError> {
        let bad = |m: &str| Err(ModelError::Invalid(m.into()));
        if self.schema != 1 || self.name != "vibefix" {
            return bad("unbekanntes Schema");
        }
        if !safe_name(&self.version) {
            return bad("Version");
        }
        if !vibefix_infer::SUPPORTED_VERSIONS.contains(&self.format) {
            return Err(ModelError::Unsupported(self.format));
        }
        if self.files.len() != FILES.len() || FILES.iter().any(|n| self.files.iter().filter(|f| f.name == *n).count() != 1) {
            return bad("Dateiliste");
        }
        for f in &self.files {
            if !safe_name(&f.asset) || f.size == 0 || f.size > MAX_FILE || !hex64(&f.sha256) {
                return Err(ModelError::Invalid(f.name.clone()));
            }
        }
        Ok(())
    }

    pub fn file(&self, name: &str) -> Option<&ManifestFile> {
        self.files.iter().find(|f| f.name == name)
    }

    pub fn total_size(&self) -> u64 {
        self.files.iter().map(|f| f.size).sum()
    }
}

pub fn check_bytes(file: &ManifestFile, data: &[u8]) -> Result<(), ModelError> {
    use sha2::{Digest, Sha256};
    if data.len() as u64 != file.size || hex::encode(Sha256::digest(data)) != file.sha256 {
        return Err(ModelError::Mismatch(file.name.clone()));
    }
    Ok(())
}

pub fn compare_versions(a: &str, b: &str) -> Ordering {
    let parts = |s: &str| -> Vec<(u64, String)> {
        s.split(['.', '-', '+']).map(|p| (p.parse::<u64>().unwrap_or(0), if p.parse::<u64>().is_ok() { String::new() } else { p.to_string() })).collect()
    };
    let (pa, pb) = (parts(a), parts(b));
    for i in 0..pa.len().max(pb.len()) {
        let x = pa.get(i).cloned().unwrap_or_default();
        let y = pb.get(i).cloned().unwrap_or_default();
        match x.cmp(&y) {
            Ordering::Equal => {}
            o => return o,
        }
    }
    Ordering::Equal
}
