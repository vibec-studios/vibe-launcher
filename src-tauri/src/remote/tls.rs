use parking_lot::Mutex;
use rustls::client::danger::{HandshakeSignatureValid, ServerCertVerified, ServerCertVerifier};
use rustls::crypto::CryptoProvider;
use rustls::pki_types::{CertificateDer, ServerName, UnixTime};
use rustls::{ClientConfig, DigitallySignedStruct, SignatureScheme};
use sha2::{Digest, Sha256};
use std::sync::Arc;

pub const MISMATCH: &str = "vibe_fingerprint_mismatch";

#[derive(Debug)]
pub struct Pinned {
    expected: Option<String>,
    seen: Mutex<Option<String>>,
    provider: Arc<CryptoProvider>,
}

impl Pinned {
    pub fn new(expected: Option<&str>) -> Arc<Self> {
        Arc::new(Pinned {
            expected: expected.map(|e| normalize(e)),
            seen: Mutex::new(None),
            provider: Arc::new(rustls::crypto::ring::default_provider()),
        })
    }

    pub fn seen(&self) -> Option<String> {
        self.seen.lock().clone()
    }

    pub fn mismatched(&self) -> bool {
        matches!((&self.expected, self.seen()), (Some(e), Some(s)) if *e != s)
    }
}

pub fn normalize(fp: &str) -> String {
    fp.chars().filter(|c| c.is_ascii_hexdigit()).collect::<String>().to_ascii_lowercase()
}

pub fn fingerprint(der: &[u8]) -> String {
    hex::encode(Sha256::digest(der))
}

impl ServerCertVerifier for Pinned {
    fn verify_server_cert(
        &self,
        end_entity: &CertificateDer<'_>,
        _intermediates: &[CertificateDer<'_>],
        _server_name: &ServerName<'_>,
        _ocsp: &[u8],
        _now: UnixTime,
    ) -> Result<ServerCertVerified, rustls::Error> {
        let fp = fingerprint(end_entity.as_ref());
        *self.seen.lock() = Some(fp.clone());
        match &self.expected {
            Some(e) if *e != fp => Err(rustls::Error::General(MISMATCH.into())),
            _ => Ok(ServerCertVerified::assertion()),
        }
    }

    fn verify_tls12_signature(&self, message: &[u8], cert: &CertificateDer<'_>, dss: &DigitallySignedStruct) -> Result<HandshakeSignatureValid, rustls::Error> {
        rustls::crypto::verify_tls12_signature(message, cert, dss, &self.provider.signature_verification_algorithms)
    }

    fn verify_tls13_signature(&self, message: &[u8], cert: &CertificateDer<'_>, dss: &DigitallySignedStruct) -> Result<HandshakeSignatureValid, rustls::Error> {
        rustls::crypto::verify_tls13_signature(message, cert, dss, &self.provider.signature_verification_algorithms)
    }

    fn supported_verify_schemes(&self) -> Vec<SignatureScheme> {
        self.provider.signature_verification_algorithms.supported_schemes()
    }
}

pub fn config(verifier: Arc<Pinned>) -> ClientConfig {
    let provider = verifier.provider.clone();
    ClientConfig::builder_with_provider(provider)
        .with_safe_default_protocol_versions()
        .expect("TLS-Versionen")
        .dangerous()
        .with_custom_certificate_verifier(verifier)
        .with_no_client_auth()
}

pub fn client(verifier: Arc<Pinned>, timeout_s: u64) -> reqwest::Client {
    reqwest::Client::builder()
        .use_preconfigured_tls(config(verifier))
        .connect_timeout(std::time::Duration::from_secs(6))
        .timeout(std::time::Duration::from_secs(timeout_s))
        .user_agent(concat!("VibeLauncher/", env!("CARGO_PKG_VERSION")))
        .build()
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_display_form() {
        assert_eq!(normalize("3F:9A:c1"), "3f9ac1");
        assert_eq!(normalize(" ab cd "), "abcd");
    }
}
