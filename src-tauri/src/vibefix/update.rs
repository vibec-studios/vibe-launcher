use super::manifest::{compare_versions, parse_manifest, Manifest, ModelError};
use super::store::{CheckState, Store};
use crate::net::{DownloadItem, Net};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;
use tokio_util::sync::CancellationToken;

pub const CHECK_EVERY_MS: i64 = 6 * 3600 * 1000;
pub const RETRY_AFTER_FAIL_MS: i64 = 10 * 60 * 1000;
const MANIFEST_TIMEOUT: Duration = Duration::from_secs(8);
const MAX_MANIFEST: usize = 64 * 1024;
const MAX_ATTEMPTS: u64 = 5;

pub struct Remote {
    pub manifest: Manifest,
    pub body: Vec<u8>,
    pub sig: Vec<u8>,
}

pub fn due(state: &CheckState, has_local: bool, now: i64) -> bool {
    if state.failed_at.is_some_and(|t| now - t < RETRY_AFTER_FAIL_MS && now >= t) {
        return false;
    }
    !(has_local && state.checked_at.is_some_and(|t| now - t < CHECK_EVERY_MS && now >= t))
}

pub fn newer(local: Option<&str>, remote: &Manifest) -> bool {
    match local {
        None => true,
        Some(l) => compare_versions(&remote.version, l).is_gt(),
    }
}

pub fn asset_url(manifest_url: &str, asset: &str) -> String {
    let base = manifest_url.rsplit_once('/').map(|(b, _)| b).unwrap_or(manifest_url);
    format!("{base}/{asset}")
}

async fn fetch(client: &reqwest::Client, url: &str) -> Result<Vec<u8>, ModelError> {
    let resp = client.get(url).timeout(MANIFEST_TIMEOUT).send().await.map_err(|e| ModelError::Io(e.to_string()))?;
    if !resp.status().is_success() {
        return Err(ModelError::Io(format!("HTTP {}", resp.status())));
    }
    if resp.content_length().is_some_and(|l| l > MAX_MANIFEST as u64) {
        return Err(ModelError::Invalid("zu groß".into()));
    }
    let body = resp.bytes().await.map_err(|e| ModelError::Io(e.to_string()))?;
    if body.len() > MAX_MANIFEST {
        return Err(ModelError::Invalid("zu groß".into()));
    }
    Ok(body.to_vec())
}

pub async fn fetch_remote(client: &reqwest::Client, url: &str, key: &[u8]) -> Result<Remote, ModelError> {
    let body = fetch(client, url).await?;
    let sig = fetch(client, &format!("{url}.sig")).await?;
    let manifest = parse_manifest(&body, &sig, key)?;
    Ok(Remote { manifest, body, sig })
}

pub async fn install(net: &Net, store: &Store, remote: &Remote, manifest_url: &str, key: &[u8], on_progress: &(dyn Fn(u64, u64) + Sync)) -> Result<(), ModelError> {
    let staging = store.staging()?;
    let result = download_into(net, store, &staging, remote, manifest_url, key, on_progress).await;
    if result.is_err() {
        store.discard(&staging);
    }
    result
}

async fn download_into(
    net: &Net,
    store: &Store,
    staging: &std::path::Path,
    remote: &Remote,
    manifest_url: &str,
    key: &[u8],
    on_progress: &(dyn Fn(u64, u64) + Sync),
) -> Result<(), ModelError> {
    let total = remote.manifest.total_size();
    let done = AtomicU64::new(0);
    on_progress(0, total);
    for file in &remote.manifest.files {
        let item = DownloadItem::new(asset_url(manifest_url, &file.asset), staging.join(&file.name)).size(Some(file.size));
        let stop = CancellationToken::new();
        let got = AtomicU64::new(0);
        let cb = |n: u64| {
            if got.fetch_add(n, Ordering::Relaxed) + n > file.size.saturating_mul(MAX_ATTEMPTS) {
                stop.cancel();
            }
            on_progress(done.fetch_add(n, Ordering::Relaxed) + n, total);
        };
        match net.download(&item, Some(&cb), Some(&stop)).await {
            Ok(()) => {}
            Err(_) if stop.is_cancelled() => return Err(ModelError::Mismatch(file.name.clone())),
            Err(e) => return Err(ModelError::Io(e.to_string())),
        }
    }
    store.write_manifest(staging, &remote.body, &remote.sig)?;
    let (store, staging, manifest, key) = (store.clone(), staging.to_path_buf(), remote.manifest.clone(), key.to_vec());
    tokio::task::spawn_blocking(move || store.activate(&staging, &manifest, &key)).await.map_err(|e| ModelError::Io(e.to_string()))?
}
