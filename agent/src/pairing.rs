use crate::crypto;
use crate::jsonfile;
use crate::roles::Role;
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use vibe_server_core::error::AppResult;
use vibe_server_core::util::now_ms;

pub const CODE_ALPHABET: &[u8] = b"ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
pub const CODE_TTL_MS: i64 = 15 * 60 * 1000;
pub const PROOF_PREFIX: &str = "vibe-pair-v1";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PairCode {
    pub code: String,
    pub expires_at: i64,
    pub role: Role,
    #[serde(default)]
    pub servers: Vec<String>,
}

#[derive(Debug, Default, Serialize, Deserialize)]
struct PairFile {
    #[serde(default)]
    codes: Vec<PairCode>,
}

pub struct PairingStore {
    path: PathBuf,
    lock: Mutex<()>,
}

pub fn normalize(code: &str) -> String {
    code.chars().filter(|c| c.is_ascii_alphanumeric()).map(|c| c.to_ascii_uppercase()).collect()
}

pub fn display(code: &str) -> String {
    let n = normalize(code);
    if n.len() == 8 {
        format!("{}-{}", &n[..4], &n[4..])
    } else {
        n
    }
}

pub fn generate_code() -> String {
    crypto::random_bytes::<8>().iter().map(|b| CODE_ALPHABET[(*b as usize) % CODE_ALPHABET.len()] as char).collect()
}

pub fn proof(code: &str, fingerprint: &str, nonce: &str) -> String {
    crypto::hmac_hex(normalize(code).as_bytes(), &format!("{PROOF_PREFIX}|{fingerprint}|{nonce}"))
}

pub fn server_proof(code: &str, fingerprint: &str, nonce: &str, token: &str) -> String {
    crypto::hmac_hex(normalize(code).as_bytes(), &format!("{PROOF_PREFIX}-ok|{fingerprint}|{nonce}|{token}"))
}

pub enum Attempt<'a> {
    Code(&'a str),
    Proof { fingerprint: &'a str, nonce: &'a str, proof: &'a str },
}

impl PairingStore {
    pub fn new(path: PathBuf) -> Self {
        PairingStore { path, lock: Mutex::new(()) }
    }

    fn load(&self) -> PairFile {
        let mut f: PairFile = jsonfile::read(&self.path);
        let now = now_ms();
        f.codes.retain(|c| c.expires_at > now);
        f
    }

    pub fn create(&self, role: Role, servers: Vec<String>) -> AppResult<PairCode> {
        let _g = self.lock.lock();
        let mut f = self.load();
        let c = PairCode { code: generate_code(), expires_at: now_ms() + CODE_TTL_MS, role, servers };
        f.codes.push(c.clone());
        jsonfile::write(&self.path, &f)?;
        Ok(c)
    }

    pub fn active(&self) -> Vec<PairCode> {
        self.load().codes
    }

    pub fn redeem(&self, attempt: Attempt<'_>) -> Option<PairCode> {
        let _g = self.lock.lock();
        let mut f = self.load();
        let pos = f.codes.iter().position(|c| match &attempt {
            Attempt::Code(code) => crypto::ct_eq(&normalize(code), &c.code),
            Attempt::Proof { fingerprint, nonce, proof: p } => {
                nonce.len() >= 16 && nonce.len() <= 128 && crypto::ct_eq(&proof(&c.code, fingerprint, nonce), &p.to_ascii_lowercase())
            }
        })?;
        let c = f.codes.remove(pos);
        let _ = jsonfile::write(&self.path, &f);
        Some(c)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn store() -> (PairingStore, PathBuf) {
        let dir = std::env::temp_dir().join(format!("vibe-agent-pair-{}", crypto::new_id("t")));
        std::fs::create_dir_all(&dir).unwrap();
        (PairingStore::new(dir.join("pairing.json")), dir)
    }

    #[test]
    fn code_format() {
        let c = generate_code();
        assert_eq!(c.len(), 8);
        assert!(c.bytes().all(|b| CODE_ALPHABET.contains(&b)));
        assert_eq!(display("abcd efgh"), "ABCD-EFGH");
        assert_eq!(normalize("ab-cd"), "ABCD");
    }

    #[test]
    fn code_is_single_use() {
        let (s, dir) = store();
        let c = s.create(Role::Owner, vec![]).unwrap();
        assert!(s.redeem(Attempt::Code("ZZZZ-ZZZZ")).is_none());
        assert!(s.redeem(Attempt::Code(&display(&c.code).to_lowercase())).is_some());
        assert!(s.redeem(Attempt::Code(&c.code)).is_none());
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn proof_binds_fingerprint() {
        let (s, dir) = store();
        let c = s.create(Role::Admin, vec![]).unwrap();
        let nonce = "0123456789abcdef0123";
        let wrong = proof(&c.code, "mitm-fingerprint", nonce);
        assert!(s.redeem(Attempt::Proof { fingerprint: "agent-fp", nonce, proof: &wrong }).is_none());
        let good = proof(&c.code, "agent-fp", nonce);
        assert!(s.redeem(Attempt::Proof { fingerprint: "agent-fp", nonce, proof: &good }).is_some());
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn expired_codes_are_dropped() {
        let (s, dir) = store();
        let f = PairFile { codes: vec![PairCode { code: "ABCDEFGH".into(), expires_at: now_ms() - 1, role: Role::Owner, servers: vec![] }] };
        jsonfile::write(&dir.join("pairing.json"), &f).unwrap();
        assert!(s.redeem(Attempt::Code("ABCD-EFGH")).is_none());
        let _ = std::fs::remove_dir_all(dir);
    }
}
