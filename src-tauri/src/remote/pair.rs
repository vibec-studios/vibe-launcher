use super::http::{self, base_url};
use super::tls::{self, Pinned};
use super::{agent_key, device_name, now_ms, store, valid_id, RemoteAgent, Via};
use crate::error::{AppError, AppResult};
use crate::state::AppState;
use serde::Serialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::sync::Arc;

pub fn hmac_sha256(key: &[u8], msg: &[u8]) -> [u8; 32] {
    let mut k = [0u8; 64];
    if key.len() > 64 {
        k[..32].copy_from_slice(&Sha256::digest(key));
    } else {
        k[..key.len()].copy_from_slice(key);
    }
    let mut inner = Sha256::new();
    inner.update(k.map(|b| b ^ 0x36));
    inner.update(msg);
    let ih = inner.finalize();
    let mut outer = Sha256::new();
    outer.update(k.map(|b| b ^ 0x5c));
    outer.update(ih);
    outer.finalize().into()
}

pub fn normalize_code(code: &str) -> String {
    code.chars().filter(|c| c.is_ascii_alphanumeric()).collect::<String>().to_ascii_uppercase()
}

fn eq_ct(a: &str, b: &str) -> bool {
    a.len() == b.len() && a.bytes().zip(b.bytes()).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

pub fn proof(code: &str, fp: &str, nonce: &str) -> String {
    hex::encode(hmac_sha256(code.as_bytes(), format!("vibe-pair-v1|{fp}|{nonce}").as_bytes()))
}

pub fn server_proof(code: &str, fp: &str, nonce: &str, token: &str) -> String {
    hex::encode(hmac_sha256(code.as_bytes(), format!("vibe-pair-v1-ok|{fp}|{nonce}|{token}").as_bytes()))
}

#[derive(Debug, Clone, Serialize)]
pub struct Probe {
    pub address: String,
    pub fingerprint: String,
    pub info: Value,
}

pub async fn probe(address: &str) -> AppResult<Probe> {
    let base = base_url(address)?;
    let pin = Pinned::new(None);
    let client = tls::client(Arc::clone(&pin), 10);
    let res = client.get(format!("{base}/api/v1/info")).send().await.map_err(|e| http::send_error(e, Some(&pin), address.trim()))?;
    let info = http::read(res).await?;
    if info["id"].as_str().is_none() {
        return Err(AppError::Invalid("Unter dieser Adresse läuft kein Vibe Server Agent.".into()));
    }
    let fingerprint = pin.seen().ok_or_else(|| AppError::Msg("Kein Zertifikat erhalten".into()))?;
    Ok(Probe { address: base.trim_start_matches("https://").to_string(), fingerprint, info })
}

pub async fn pair(state: &AppState, address: &str, code: &str, fingerprint: &str) -> AppResult<RemoteAgent> {
    let base = base_url(address)?;
    let code = normalize_code(code);
    if code.len() < 6 {
        return Err(AppError::Invalid("Der Kopplungscode ist zu kurz. Er hat 8 Zeichen, z. B. ABCD-EFGH.".into()));
    }
    let fp = tls::normalize(fingerprint);
    let nonce = hex::encode([*uuid::Uuid::new_v4().as_bytes(), *uuid::Uuid::new_v4().as_bytes()].concat());
    let pin = Pinned::new(Some(&fp));
    let client = tls::client(Arc::clone(&pin), 20);
    let body = json!({
        "client_name": device_name(),
        "client_kind": "launcher",
        "nonce": nonce,
        "fingerprint": fp,
        "proof": proof(&code, &fp, &nonce),
    });
    let res = client.post(format!("{base}/api/v1/pair")).json(&body).send().await.map_err(|e| http::send_error(e, Some(&pin), address.trim()))?;
    let v = match http::read(res).await {
        Err(AppError::Auth(_)) => {
            return Err(AppError::Auth("Der Kopplungscode stimmt nicht oder ist abgelaufen (15 Minuten gültig). Erzeuge auf dem Server mit „vibe-agent pair“ einen neuen.".into()))
        }
        r => r?,
    };
    let token = v["token"].as_str().ok_or_else(|| AppError::Msg("Antwort ohne Zugangsschlüssel".into()))?;
    let sp = v["server_proof"].as_str().unwrap_or("");
    if !eq_ct(&sp.to_ascii_lowercase(), &server_proof(&code, &fp, &nonce, token)) {
        return Err(AppError::Access("Der Server konnte nicht beweisen, dass er den Kopplungscode kennt. Verbindung abgebrochen.".into()));
    }
    let a = &v["agent"];
    let id = a["id"].as_str().unwrap_or_default().to_string();
    if !valid_id(&id) {
        return Err(AppError::Msg("Ungültige Agent-ID".into()));
    }
    let key = agent_key(Via::Direct, &id);
    store::save_token(&state.paths, &key, token)?;
    let prev = store::list(&state.paths).into_iter().find(|x| x.key == key);
    let s = |v: &Value| v.as_str().map(str::to_string);
    store::upsert(
        &state.paths,
        RemoteAgent {
            key,
            name: prev.as_ref().map(|p| p.name.clone()).or_else(|| s(&a["name"])).unwrap_or_else(|| id.clone()),
            id,
            via: Via::Direct,
            address: Some(base.trim_start_matches("https://").to_string()),
            fingerprint: Some(fp),
            version: s(&a["version"]),
            os: None,
            arch: None,
            token_id: s(&v["token_id"]),
            role: s(&v["user"]["role"]),
            online: Some(true),
            last_seen: Some(now_ms()),
            gateway_id: prev.as_ref().and_then(|p| p.gateway_id.clone()),
            disabled: None,
            added_at: prev.map(|p| p.added_at).unwrap_or_else(now_ms),
        },
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hmac_rfc4231_case2() {
        assert_eq!(hex::encode(hmac_sha256(b"Jefe", b"what do ya want for nothing?")), "5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843");
    }

    #[test]
    fn hmac_long_key() {
        let key = [0xaau8; 131];
        assert_eq!(
            hex::encode(hmac_sha256(&key, b"Test Using Larger Than Block-Size Key - Hash Key First")),
            "60e431591ee0b67f0d8a26aacbf5b77f8e0bc6213728c5140546040f0ee37f54"
        );
    }

    #[test]
    fn codes() {
        assert_eq!(normalize_code("abcd-efgh"), "ABCDEFGH");
        assert_eq!(normalize_code(" AB CD EF GH "), "ABCDEFGH");
        assert!(eq_ct("abc", "abc"));
        assert!(!eq_ct("abc", "abd"));
    }
}
