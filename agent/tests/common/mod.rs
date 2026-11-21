#![allow(dead_code)]
use serde_json::{json, Value};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Arc;
use std::time::{Duration, Instant};

pub struct Agent {
    pub child: Child,
    pub dir: PathBuf,
    pub port: u16,
    pub base: String,
    pub http: reqwest::Client,
}

impl Drop for Agent {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
        let _ = std::fs::remove_dir_all(&self.dir);
    }
}

pub fn free_port() -> u16 {
    std::net::TcpListener::bind("127.0.0.1:0").unwrap().local_addr().unwrap().port()
}

pub fn bin() -> &'static str {
    env!("CARGO_BIN_EXE_vibe-agent")
}

pub fn temp_dir(tag: &str) -> PathBuf {
    let d = std::env::temp_dir().join(format!("vibe-agent-it-{tag}-{}", uuid::Uuid::new_v4().simple()));
    std::fs::create_dir_all(&d).unwrap();
    d
}

#[derive(Debug)]
struct Pinned(String);

impl rustls::client::danger::ServerCertVerifier for Pinned {
    fn verify_server_cert(
        &self,
        end_entity: &rustls::pki_types::CertificateDer<'_>,
        _intermediates: &[rustls::pki_types::CertificateDer<'_>],
        _server_name: &rustls::pki_types::ServerName<'_>,
        _ocsp: &[u8],
        _now: rustls::pki_types::UnixTime,
    ) -> Result<rustls::client::danger::ServerCertVerified, rustls::Error> {
        if sha256_hex(end_entity.as_ref()) == self.0 {
            Ok(rustls::client::danger::ServerCertVerified::assertion())
        } else {
            Err(rustls::Error::General("Fingerprint passt nicht".into()))
        }
    }
    fn verify_tls12_signature(&self, m: &[u8], c: &rustls::pki_types::CertificateDer<'_>, d: &rustls::DigitallySignedStruct) -> Result<rustls::client::danger::HandshakeSignatureValid, rustls::Error> {
        rustls::crypto::verify_tls12_signature(m, c, d, &rustls::crypto::ring::default_provider().signature_verification_algorithms)
    }
    fn verify_tls13_signature(&self, m: &[u8], c: &rustls::pki_types::CertificateDer<'_>, d: &rustls::DigitallySignedStruct) -> Result<rustls::client::danger::HandshakeSignatureValid, rustls::Error> {
        rustls::crypto::verify_tls13_signature(m, c, d, &rustls::crypto::ring::default_provider().signature_verification_algorithms)
    }
    fn supported_verify_schemes(&self) -> Vec<rustls::SignatureScheme> {
        rustls::crypto::ring::default_provider().signature_verification_algorithms.supported_schemes()
    }
}

pub fn pinned_tls(fingerprint: &str) -> rustls::ClientConfig {
    let _ = rustls::crypto::ring::default_provider().install_default();
    rustls::ClientConfig::builder().dangerous().with_custom_certificate_verifier(Arc::new(Pinned(fingerprint.to_string()))).with_no_client_auth()
}

pub fn sha256_hex(b: &[u8]) -> String {
    use sha2::Digest;
    hex::encode(sha2::Sha256::digest(b))
}

pub fn hmac_hex(key: &[u8], msg: &str) -> String {
    let k = ring::hmac::Key::new(ring::hmac::HMAC_SHA256, key);
    hex::encode(ring::hmac::sign(&k, msg.as_bytes()).as_ref())
}

pub fn normalize(code: &str) -> String {
    code.chars().filter(|c| c.is_ascii_alphanumeric()).map(|c| c.to_ascii_uppercase()).collect()
}

pub async fn start(tag: &str) -> Agent {
    let dir = temp_dir(tag);
    let port = free_port();
    let child = Command::new(bin())
        .args(["run", "--data-dir", dir.to_str().unwrap(), "--port", &port.to_string(), "--bind", "127.0.0.1"])
        .env("VIBE_AGENT_LOG", "warn")
        .stdout(Stdio::null())
        .stderr(Stdio::inherit())
        .spawn()
        .expect("vibe-agent starten");
    let base = format!("https://127.0.0.1:{port}/api/v1");
    let insecure = reqwest::Client::builder().danger_accept_invalid_certs(true).build().unwrap();
    let deadline = Instant::now() + Duration::from_secs(60);
    let info = loop {
        if let Ok(r) = insecure.get(format!("{base}/info")).send().await {
            if r.status().is_success() {
                break r.json::<Value>().await.unwrap();
            }
        }
        assert!(Instant::now() < deadline, "Agent antwortet nicht");
        tokio::time::sleep(Duration::from_millis(300)).await;
    };
    let fp = info["fingerprint"].as_str().expect("fingerprint").to_string();
    let http = reqwest::Client::builder().use_preconfigured_tls(pinned_tls(&fp)).build().unwrap();
    Agent { child, dir, port, base, http }
}

impl Agent {
    pub fn cli(&self, args: &[&str]) -> std::process::Output {
        let mut a: Vec<String> = args.iter().map(|s| s.to_string()).collect();
        a.extend(["--data-dir".to_string(), self.dir.to_string_lossy().to_string(), "--port".into(), self.port.to_string(), "--bind".into(), "127.0.0.1".into()]);
        Command::new(bin()).args(a).env("VIBE_AGENT_LOG", "warn").output().unwrap()
    }

    pub async fn info(&self) -> Value {
        self.http.get(format!("{}/info", self.base)).send().await.unwrap().json().await.unwrap()
    }

    pub async fn pair_with_proof(&self) -> String {
        let out = self.cli(&["pair", "--json"]);
        assert!(out.status.success(), "pair: {}", String::from_utf8_lossy(&out.stderr));
        let v: Value = serde_json::from_slice(&out.stdout).unwrap();
        let code = normalize(v["code"].as_str().unwrap());
        let fp = self.info().await["fingerprint"].as_str().unwrap().to_string();
        assert_eq!(v["fingerprint"].as_str(), Some(fp.as_str()));
        let nonce = hex::encode(uuid::Uuid::new_v4().as_bytes());
        let proof = hmac_hex(code.as_bytes(), &format!("vibe-pair-v1|{fp}|{nonce}"));
        let r: Value = self
            .http
            .post(format!("{}/pair", self.base))
            .json(&json!({ "client_name": "Integrationstest", "client_kind": "launcher", "nonce": nonce, "fingerprint": fp, "proof": proof }))
            .send()
            .await
            .unwrap()
            .json()
            .await
            .unwrap();
        let token = r["token"].as_str().expect("token").to_string();
        let sp = hmac_hex(code.as_bytes(), &format!("vibe-pair-v1-ok|{fp}|{nonce}|{token}"));
        assert_eq!(r["server_proof"].as_str(), Some(sp.as_str()));
        token
    }

    pub async fn get(&self, token: &str, path: &str) -> (u16, Value) {
        let r = self.http.get(format!("{}{path}", self.base)).bearer_auth(token).send().await.unwrap();
        let s = r.status().as_u16();
        (s, r.json().await.unwrap_or(Value::Null))
    }

    pub async fn send(&self, token: &str, method: reqwest::Method, path: &str, body: Value) -> (u16, Value) {
        let r = self.http.request(method, format!("{}{path}", self.base)).bearer_auth(token).json(&body).send().await.unwrap();
        let s = r.status().as_u16();
        (s, r.json().await.unwrap_or(Value::Null))
    }

    pub async fn wait_task(&self, token: &str, id: &str, limit: Duration) -> Value {
        let deadline = Instant::now() + limit;
        loop {
            let (_, t) = self.get(token, &format!("/tasks/{id}")).await;
            if t["status"] != "running" {
                return t;
            }
            assert!(Instant::now() < deadline, "Aufgabe {id} dauert zu lange: {t}");
            tokio::time::sleep(Duration::from_secs(2)).await;
        }
    }
}
