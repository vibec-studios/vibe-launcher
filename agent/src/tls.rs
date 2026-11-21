use crate::config::{AgentConfig, Dirs};
use crate::crypto;
use rustls::pki_types::pem::PemObject;
use rustls::pki_types::{CertificateDer, PrivateKeyDer};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use vibe_server_core::error::{AppError, AppResult};

pub struct TlsSetup {
    pub config: Arc<rustls::ServerConfig>,
    pub fingerprint: String,
}

pub fn local_ips() -> Vec<std::net::IpAddr> {
    let mut out = Vec::new();
    for target in ["8.8.8.8:80", "[2001:4860:4860::8888]:80"] {
        let bind = if target.starts_with('[') { "[::]:0" } else { "0.0.0.0:0" };
        if let Ok(s) = std::net::UdpSocket::bind(bind) {
            if s.connect(target).is_ok() {
                if let Ok(a) = s.local_addr() {
                    if !a.ip().is_loopback() && !a.ip().is_unspecified() {
                        out.push(a.ip());
                    }
                }
            }
        }
    }
    out
}

fn paths(cfg: &AgentConfig, dirs: &Dirs) -> (PathBuf, PathBuf) {
    match (&cfg.tls_cert, &cfg.tls_key) {
        (Some(c), Some(k)) if !c.trim().is_empty() && !k.trim().is_empty() => (PathBuf::from(c), PathBuf::from(k)),
        _ => (dirs.tls().join("cert.pem"), dirs.tls().join("key.pem")),
    }
}

fn generate(cert: &Path, key: &Path, name: &str) -> AppResult<()> {
    let mut sans = vec!["localhost".to_string(), crate::config::hostname()];
    sans.extend(local_ips().into_iter().map(|ip| ip.to_string()));
    sans.push("127.0.0.1".into());
    sans.dedup();
    let mut params = rcgen::CertificateParams::new(sans).map_err(|e| AppError::msg(format!("Zertifikat: {e}")))?;
    params.distinguished_name.push(rcgen::DnType::CommonName, format!("Vibe Agent {name}"));
    params.not_before = rcgen::date_time_ymd(2024, 1, 1);
    params.not_after = rcgen::date_time_ymd(2124, 1, 1);
    let kp = rcgen::KeyPair::generate().map_err(|e| AppError::msg(format!("Schlüssel: {e}")))?;
    let c = params.self_signed(&kp).map_err(|e| AppError::msg(format!("Zertifikat: {e}")))?;
    if let Some(p) = cert.parent() {
        std::fs::create_dir_all(p)?;
    }
    std::fs::write(cert, c.pem())?;
    std::fs::write(key, kp.serialize_pem())?;
    crate::jsonfile::fix_owner(cert);
    crate::jsonfile::restrict(key);
    Ok(())
}

pub fn fingerprint_of(der: &[u8]) -> String {
    crypto::sha256_hex(der)
}

pub fn load_or_create(cfg: &AgentConfig, dirs: &Dirs) -> AppResult<TlsSetup> {
    let _ = rustls::crypto::ring::default_provider().install_default();
    let (cert_path, key_path) = paths(cfg, dirs);
    if !cert_path.exists() || !key_path.exists() {
        generate(&cert_path, &key_path, &cfg.name)?;
    }
    let certs: Vec<CertificateDer<'static>> = CertificateDer::pem_file_iter(&cert_path)
        .map_err(|e| AppError::msg(format!("{}: {e}", cert_path.display())))?
        .collect::<Result<_, _>>()
        .map_err(|e| AppError::msg(format!("{}: {e}", cert_path.display())))?;
    let first = certs.first().ok_or_else(|| AppError::msg(format!("{}: kein Zertifikat", cert_path.display())))?;
    let fingerprint = fingerprint_of(first.as_ref());
    let key = PrivateKeyDer::from_pem_file(&key_path).map_err(|e| AppError::msg(format!("{}: {e}", key_path.display())))?;
    let mut config = rustls::ServerConfig::builder()
        .with_no_client_auth()
        .with_single_cert(certs, key)
        .map_err(|e| AppError::msg(format!("TLS: {e}")))?;
    config.alpn_protocols = vec![b"http/1.1".to_vec()];
    Ok(TlsSetup { config: Arc::new(config), fingerprint })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn creates_stable_cert() {
        let base = std::env::temp_dir().join(format!("vibe-agent-tls-{}", crypto::new_id("t")));
        let dirs = Dirs { config: base.join("c"), data: base.join("d") };
        let cfg = AgentConfig::default();
        let a = load_or_create(&cfg, &dirs).unwrap();
        let b = load_or_create(&cfg, &dirs).unwrap();
        assert_eq!(a.fingerprint.len(), 64);
        assert_eq!(a.fingerprint, b.fingerprint);
        let _ = std::fs::remove_dir_all(base);
    }
}
