use super::*;
use crate::net::Net;
use crate::util::testdir::TestDir;
use std::sync::atomic::{AtomicU64, Ordering};
use tokio::io::{AsyncReadExt, AsyncWriteExt};

async fn serve(files: HashMap<String, Vec<u8>>) -> String {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let files = std::sync::Arc::new(files);
    tokio::spawn(async move {
        while let Ok((mut sock, _)) = listener.accept().await {
            let files = files.clone();
            tokio::spawn(async move {
                let mut buf = vec![0u8; 4096];
                let mut req = Vec::new();
                while !req.windows(4).any(|w| w == b"\r\n\r\n") {
                    let n = sock.read(&mut buf).await.unwrap_or(0);
                    if n == 0 {
                        return;
                    }
                    req.extend_from_slice(&buf[..n]);
                }
                let head = String::from_utf8_lossy(&req).to_string();
                let name = head.split_whitespace().nth(1).and_then(|p| p.rsplit('/').next()).unwrap_or("").to_string();
                let resp = match files.get(&name) {
                    Some(body) => [format!("HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", body.len()).into_bytes(), body.clone()].concat(),
                    None => b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".to_vec(),
                };
                let _ = sock.write_all(&resp).await;
                let _ = sock.shutdown().await;
            });
        }
    });
    format!("http://{addr}/releases/download/vibefix-model/manifest.json")
}

fn installed(store: &Store, s: &Signer, version: &str) {
    let staged = store.staging().unwrap();
    let m = write_package(&staged, s, version);
    store.activate(&staged, &m, &s.public).unwrap();
}

fn leftovers(store: &Store) -> Vec<String> {
    std::fs::read_dir(&store.dir).unwrap().flatten().filter(|e| e.path().is_dir()).map(|e| e.file_name().to_string_lossy().into()).collect()
}

#[tokio::test]
async fn downloads_verifies_and_activates_newer_model() {
    let t = TestDir::new("vibefix-dl");
    let store = Store::new(t.path());
    let s = Signer::new();
    installed(&store, &s, "3");
    let url = serve(release(&s, "4")).await;
    let net = Net::new(2);
    let remote = fetch_remote(&net.client, &url, &s.public).await.unwrap();
    assert!(newer(store.current().as_deref(), &remote.manifest));
    let seen = AtomicU64::new(0);
    let progress = |done: u64, total: u64| {
        assert_eq!(total, remote.manifest.total_size());
        seen.fetch_max(done, Ordering::Relaxed);
    };
    install(&net, &store, &remote, &url, &s.public, &progress).await.unwrap();
    assert_eq!(seen.load(Ordering::Relaxed), remote.manifest.total_size());
    assert_eq!(store.current().as_deref(), Some("4"));
    assert_eq!(store.read_package(&s.public).unwrap().weights, package_files("4")[2].1);
    assert_eq!(leftovers(&store), vec!["4".to_string()]);
}

#[tokio::test]
async fn tampered_asset_keeps_previous_model() {
    let t = TestDir::new("vibefix-tamper");
    let store = Store::new(t.path());
    let s = Signer::new();
    installed(&store, &s, "3");
    let mut files = release(&s, "4");
    files.insert("vibefix-v4-weights.bin".into(), b"manipulierte Gewichte".to_vec());
    let url = serve(files).await;
    let net = Net::new(2);
    let remote = fetch_remote(&net.client, &url, &s.public).await.unwrap();
    let err = install(&net, &store, &remote, &url, &s.public, &|_, _| {}).await.unwrap_err();
    assert_eq!(err, ModelError::Mismatch("weights.bin".into()));
    assert_eq!(store.current().as_deref(), Some("3"));
    assert_eq!(leftovers(&store), vec!["3".to_string()]);
}

#[tokio::test]
async fn foreign_signature_is_not_downloaded() {
    let s = Signer::new();
    let mut files = release(&s, "4");
    let forged = Signer::new().sign(&files["manifest.json"]);
    files.insert("manifest.json.sig".into(), forged);
    let url = serve(files).await;
    let net = Net::new(2);
    assert_eq!(fetch_remote(&net.client, &url, &s.public).await.err(), Some(ModelError::Signature));
}

#[tokio::test]
async fn offline_falls_back_to_local_model() {
    let t = TestDir::new("vibefix-offline");
    let store = Store::new(t.path());
    let s = Signer::new();
    installed(&store, &s, "3");
    let port = std::net::TcpListener::bind("127.0.0.1:0").unwrap().local_addr().unwrap().port();
    let net = Net::new(2);
    let url = format!("http://127.0.0.1:{port}/manifest.json");
    assert!(matches!(fetch_remote(&net.client, &url, &s.public).await, Err(ModelError::Io(_))));
    let st = CheckState { failed_at: Some(crate::util::now_ms()), ..Default::default() };
    assert!(!due(&st, true, crate::util::now_ms()));
    assert_eq!(store.read_package(&s.public).unwrap().manifest.version, "3");
    let empty = Store::new(&t.path().join("leer"));
    assert_eq!(empty.read_package(&s.public).err(), Some(ModelError::Missing));
}
