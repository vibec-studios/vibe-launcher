use super::*;
use base64::Engine;
use ring::signature::{Ed25519KeyPair, KeyPair};
use std::collections::HashMap;
use std::path::Path;

mod download;
mod manifest;
mod store;

pub struct Signer {
    pair: Ed25519KeyPair,
    pub public: Vec<u8>,
}

impl Signer {
    pub fn new() -> Self {
        let pkcs8 = Ed25519KeyPair::generate_pkcs8(&ring::rand::SystemRandom::new()).unwrap();
        let pair = Ed25519KeyPair::from_pkcs8(pkcs8.as_ref()).unwrap();
        let public = pair.public_key().as_ref().to_vec();
        Signer { pair, public }
    }

    pub fn sign(&self, body: &[u8]) -> Vec<u8> {
        base64::engine::general_purpose::STANDARD.encode(self.pair.sign(body).as_ref()).into_bytes()
    }
}

pub fn package_files(version: &str) -> Vec<(&'static str, Vec<u8>)> {
    vec![
        ("config.json", format!("{{\"version\": 3, \"tag\": \"{version}\"}}").into_bytes()),
        ("tokenizer.json", format!("{{\"tokens\": [\"{version}\"]}}").into_bytes()),
        ("weights.bin", (0..4096u32).map(|i| (i % 251) as u8).chain(version.bytes()).collect()),
    ]
}

pub fn manifest_for(version: &str, files: &[(&str, Vec<u8>)]) -> Manifest {
    use sha2::{Digest, Sha256};
    Manifest {
        schema: 1,
        name: "vibefix".into(),
        version: version.into(),
        format: 3,
        published: None,
        files: files
            .iter()
            .map(|(name, data)| ManifestFile {
                name: (*name).into(),
                asset: format!("vibefix-v{version}-{name}"),
                size: data.len() as u64,
                sha256: hex::encode(Sha256::digest(data)),
            })
            .collect(),
    }
}

pub fn body(m: &Manifest) -> Vec<u8> {
    serde_json::to_vec_pretty(m).unwrap()
}

pub fn write_package(dir: &Path, signer: &Signer, version: &str) -> Manifest {
    std::fs::create_dir_all(dir).unwrap();
    let files = package_files(version);
    let m = manifest_for(version, &files);
    for (name, data) in &files {
        std::fs::write(dir.join(name), data).unwrap();
    }
    let b = body(&m);
    std::fs::write(dir.join("manifest.json"), &b).unwrap();
    std::fs::write(dir.join("manifest.json.sig"), signer.sign(&b)).unwrap();
    m
}

pub fn release(signer: &Signer, version: &str) -> HashMap<String, Vec<u8>> {
    let files = package_files(version);
    let m = manifest_for(version, &files);
    let b = body(&m);
    let mut out: HashMap<String, Vec<u8>> = files.into_iter().map(|(name, data)| (format!("vibefix-v{version}-{name}"), data)).collect();
    out.insert("manifest.json.sig".into(), signer.sign(&b));
    out.insert("manifest.json".into(), b);
    out
}
