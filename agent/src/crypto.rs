use base64::Engine;
use ring::rand::SecureRandom;
use sha2::{Digest, Sha256};

pub fn random_bytes<const N: usize>() -> [u8; N] {
    let mut b = [0u8; N];
    ring::rand::SystemRandom::new().fill(&mut b).expect("Zufallszahlen");
    b
}

pub fn new_token() -> String {
    format!("va_{}", base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(random_bytes::<32>()))
}

pub fn new_id(prefix: &str) -> String {
    format!("{prefix}_{}", hex::encode(random_bytes::<9>()))
}

pub fn sha256_hex(data: &[u8]) -> String {
    hex::encode(Sha256::digest(data))
}

pub fn hmac_hex(key: &[u8], msg: &str) -> String {
    let k = ring::hmac::Key::new(ring::hmac::HMAC_SHA256, key);
    hex::encode(ring::hmac::sign(&k, msg.as_bytes()).as_ref())
}

pub fn ct_eq(a: &str, b: &str) -> bool {
    let (a, b) = (a.as_bytes(), b.as_bytes());
    a.len() == b.len() && a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

pub fn fingerprint_display(fp: &str) -> String {
    fp.as_bytes().chunks(2).map(|c| String::from_utf8_lossy(c).to_uppercase()).collect::<Vec<_>>().join(":")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hmac_known_vector() {
        assert_eq!(
            hmac_hex(b"key", "The quick brown fox jumps over the lazy dog"),
            "f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8"
        );
    }

    #[test]
    fn tokens_are_unique() {
        let a = new_token();
        assert!(a.starts_with("va_") && a.len() == 46);
        assert_ne!(a, new_token());
        assert!(ct_eq("abc", "abc") && !ct_eq("abc", "abd") && !ct_eq("abc", "ab"));
        assert_eq!(fingerprint_display("3f9ac1"), "3F:9A:C1");
    }
}
