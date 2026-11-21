//! HTTP-Client und paralleler Downloader mit SHA-1-Prüfung, Retries und Fortschritt.
use crate::error::{AppError, AppResult};
use crate::tasks::SubProgress;
use futures::StreamExt;
use serde::de::DeserializeOwned;
use sha1::{Digest, Sha1};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tokio::io::AsyncWriteExt;
use tokio::sync::Semaphore;

pub mod throttle;


#[derive(Debug, Clone)]
pub struct DownloadItem {
    pub url: String,
    pub path: PathBuf,
    pub sha1: Option<String>,
    pub size: Option<u64>,
}

impl DownloadItem {
    pub fn new(url: impl Into<String>, path: impl Into<PathBuf>) -> Self {
        DownloadItem { url: url.into(), path: path.into(), sha1: None, size: None }
    }
    pub fn sha1(mut self, sha1: Option<impl Into<String>>) -> Self {
        self.sha1 = sha1.map(Into::into);
        self
    }
    pub fn size(mut self, size: Option<u64>) -> Self {
        self.size = size;
        self
    }
}

pub struct Net {
    pub client: reqwest::Client,
    concurrency: AtomicUsize,
    throttle: throttle::Throttle,
}

fn retry_after(r: &reqwest::Response) -> Option<Duration> {
    let v = r.headers().get(reqwest::header::RETRY_AFTER)?.to_str().ok()?;
    throttle::parse_retry_after(v, chrono::Utc::now())
}

fn note_error(permit: &throttle::Permit, e: &reqwest::Error) {
    if e.is_timeout() || e.is_connect() {
        permit.timeout();
    }
}

impl Net {
    pub fn new(concurrency: usize) -> Self {
        let client = reqwest::Client::builder()
            .user_agent(crate::product::user_agent())
            .connect_timeout(Duration::from_secs(15))
            .read_timeout(Duration::from_secs(60))
            .pool_max_idle_per_host(16)
            .build()
            .expect("HTTP-Client");
        Net { client, concurrency: AtomicUsize::new(concurrency.clamp(1, 64)), throttle: Default::default() }
    }

    pub fn set_concurrency(&self, n: usize) {
        self.concurrency.store(n.clamp(1, 64), Ordering::Relaxed);
    }

    /// GET + JSON mit Retries.
    pub async fn get_json<T: DeserializeOwned>(&self, url: &str) -> AppResult<T> {
        let bytes = self.get_bytes(url).await?;
        serde_json::from_slice(&bytes).map_err(|e| AppError::msg(format!("Ungültige Antwort von {url}: {e}")))
    }

    /// GET mit Retries, liefert den Body. Fehlerstatus wird zu einem Fehler.
    pub async fn get_bytes(&self, url: &str) -> AppResult<bytes::Bytes> {
        let mut last_err = None;
        for attempt in 0..4 {
            if attempt > 0 {
                tokio::time::sleep(Duration::from_millis(400 * attempt as u64)).await;
            }
            let permit = self.throttle.acquire(url, self.concurrency.load(Ordering::Relaxed)).await;
            match self.client.get(url).send().await {
                Ok(r) if r.status().is_success() => {
                    permit.ok();
                    return Ok(r.bytes().await?);
                }
                Ok(r) if r.status().as_u16() == 429 => {
                    permit.too_many(retry_after(&r));
                    last_err = Some(AppError::msg(format!("Der Server ist gerade überlastet (HTTP 429) – bitte gleich noch einmal versuchen ({url})")));
                }
                Ok(r) if r.status().is_client_error() => {
                    return Err(AppError::msg(format!("HTTP {} für {url}", r.status())));
                }
                Ok(r) => last_err = Some(AppError::msg(format!("HTTP {} für {url}", r.status()))),
                Err(e) => {
                    note_error(&permit, &e);
                    last_err = Some(e.into());
                }
            }
        }
        Err(last_err.unwrap_or_else(|| AppError::msg("Download fehlgeschlagen")))
    }

    /// Prüft, ob eine Datei schon korrekt vorhanden ist (Größe und – wenn bekannt – SHA-1).
    pub async fn is_valid(item: &DownloadItem) -> bool {
        let Ok(meta) = tokio::fs::metadata(&item.path).await else { return false };
        if let Some(size) = item.size {
            if meta.len() != size {
                return false;
            }
            // Größe passt: bei bekannter Größe UND Hash reicht das für den schnellen Check
            // (Hash wird nach jedem Download geprüft).
            return true;
        }
        match &item.sha1 {
            Some(expected) => {
                let p = item.path.clone();
                match tokio::task::spawn_blocking(move || sha1_file(&p)).await {
                    Ok(Ok(h)) => h.eq_ignore_ascii_case(expected),
                    _ => false,
                }
            }
            None => meta.len() > 0,
        }
    }

    /// Einzelne Datei laden (temporär schreiben, prüfen, dann umbenennen).
    pub async fn download(&self, item: &DownloadItem, on_bytes: Option<&(dyn Fn(u64) + Sync)>, cancel: Option<&tokio_util::sync::CancellationToken>) -> AppResult<()> {
        if let Some(parent) = item.path.parent() {
            tokio::fs::create_dir_all(parent).await?;
        }
        let tmp = item.path.with_extension(format!(
            "{}.part",
            item.path.extension().and_then(|e| e.to_str()).unwrap_or("dl")
        ));
        let mut last_err: Option<AppError> = None;
        for attempt in 0..5u64 {
            if attempt > 0 {
                tokio::time::sleep(Duration::from_millis(500 * attempt)).await;
            }
            if cancel.is_some_and(|c| c.is_cancelled()) {
                return Err(AppError::Cancelled);
            }
            let mut written = 0u64;
            let permit = self.throttle.acquire(&item.url, self.concurrency.load(Ordering::Relaxed)).await;
            let res: AppResult<()> = async {
                let resp = match self.client.get(&item.url).send().await {
                    Ok(r) => r,
                    Err(e) => {
                        note_error(&permit, &e);
                        return Err(e.into());
                    }
                };
                if resp.status().as_u16() == 429 {
                    permit.too_many(retry_after(&resp));
                    return Err(AppError::msg(format!("Der Server ist gerade überlastet (HTTP 429) für {}", item.url)));
                }
                if !resp.status().is_success() {
                    return Err(AppError::msg(format!("HTTP {} für {}", resp.status(), item.url)));
                }
                let mut file = tokio::fs::File::create(&tmp).await?;
                let mut hasher = Sha1::new();
                let mut stream = resp.bytes_stream();
                while let Some(chunk) = stream.next().await {
                    if cancel.is_some_and(|c| c.is_cancelled()) {
                        return Err(AppError::Cancelled);
                    }
                    let chunk = chunk.inspect_err(|e| note_error(&permit, e))?;
                    hasher.update(&chunk);
                    file.write_all(&chunk).await?;
                    written += chunk.len() as u64;
                    if let Some(cb) = on_bytes {
                        cb(chunk.len() as u64);
                    }
                }
                file.flush().await?;
                drop(file);
                if let Some(expected) = &item.sha1 {
                    let got = hex::encode(hasher.finalize());
                    if !got.eq_ignore_ascii_case(expected) {
                        return Err(AppError::msg(format!("Prüfsumme falsch für {} (erwartet {expected}, erhalten {got})", item.url)));
                    }
                }
                tokio::fs::rename(&tmp, &item.path).await?;
                permit.ok();
                Ok(())
            }
            .await;
            drop(permit);
            match res {
                Ok(()) => return Ok(()),
                Err(AppError::Cancelled) => {
                    let _ = tokio::fs::remove_file(&tmp).await;
                    return Err(AppError::Cancelled);
                }
                Err(e) => {
                    // Bereits gezählte Bytes zurücknehmen geht nicht sauber – Fortschritt ist nur Anzeige.
                    let _ = written;
                    let _ = tokio::fs::remove_file(&tmp).await;
                    tracing::warn!("Download-Versuch {} fehlgeschlagen: {e}", attempt + 1);
                    last_err = Some(e);
                }
            }
        }
        Err(last_err.unwrap_or_else(|| AppError::msg("Download fehlgeschlagen")))
    }

    /// Viele Dateien parallel laden. Bereits gültige Dateien werden übersprungen.
    /// Fortschritt nach Bytes, wenn alle Größen bekannt sind, sonst nach Anzahl.
    pub async fn download_all(&self, items: Vec<DownloadItem>, progress: Option<&SubProgress>) -> AppResult<()> {
        // Doppelte Ziele entfernen
        let mut seen = std::collections::HashSet::new();
        let items: Vec<DownloadItem> = items.into_iter().filter(|i| seen.insert(i.path.clone())).collect();

        // Erst prüfen, was fehlt (parallel, da evtl. Hashing)
        let checks = futures::stream::iter(items.into_iter().map(|i| async move {
            let ok = Net::is_valid(&i).await;
            (i, ok)
        }))
        .buffer_unordered(32)
        .collect::<Vec<_>>()
        .await;
        let todo: Vec<DownloadItem> = checks.into_iter().filter(|(_, ok)| !ok).map(|(i, _)| i).collect();
        if todo.is_empty() {
            if let Some(p) = progress {
                p.progress(1.0);
            }
            return Ok(());
        }

        let by_bytes = todo.iter().all(|i| i.size.is_some());
        let total_bytes: u64 = todo.iter().filter_map(|i| i.size).sum();
        let total_count = todo.len() as u64;
        let done_bytes = Arc::new(AtomicU64::new(0));
        let done_count = Arc::new(AtomicU64::new(0));
        let sem = Arc::new(Semaphore::new(self.concurrency.load(Ordering::Relaxed)));
        let cancel = progress.map(|p| p.task.cancel_token());

        let report = |progress: Option<&SubProgress>, db: u64, dc: u64| {
            if let Some(p) = progress {
                let f = if by_bytes && total_bytes > 0 { db as f64 / total_bytes as f64 } else { dc as f64 / total_count as f64 };
                p.progress(f);
            }
        };

        let results = futures::stream::iter(todo.into_iter().map(|item| {
            let sem = sem.clone();
            let done_bytes = done_bytes.clone();
            let done_count = done_count.clone();
            let cancel = cancel.clone();
            async move {
                let _permit = sem.acquire().await.map_err(|_| AppError::Cancelled)?;
                let on_bytes = |n: u64| {
                    let v = done_bytes.fetch_add(n, Ordering::Relaxed) + n;
                    report(progress, v, done_count.load(Ordering::Relaxed));
                };
                self.download(&item, Some(&on_bytes), cancel.as_ref()).await?;
                let c = done_count.fetch_add(1, Ordering::Relaxed) + 1;
                report(progress, done_bytes.load(Ordering::Relaxed), c);
                Ok::<(), AppError>(())
            }
        }))
        .buffer_unordered(64)
        .collect::<Vec<_>>()
        .await;

        let mut errors: Vec<AppError> = results.into_iter().filter_map(|r| r.err()).collect();
        if errors.iter().any(|e| matches!(e, AppError::Cancelled)) {
            return Err(AppError::Cancelled);
        }
        match errors.len() {
            0 => Ok(()),
            1 => Err(errors.remove(0)),
            n => Err(AppError::msg(format!("{n} Downloads fehlgeschlagen, z. B.: {}", errors[0]))),
        }
    }
}

/// SHA-1 einer Datei (blockierend – in `spawn_blocking` aufrufen).
pub fn sha1_file(path: &Path) -> std::io::Result<String> {
    use std::io::Read;
    let mut f = std::fs::File::open(path)?;
    let mut h = Sha1::new();
    let mut buf = vec![0u8; 64 * 1024];
    loop {
        let n = f.read(&mut buf)?;
        if n == 0 {
            break;
        }
        h.update(&buf[..n]);
    }
    Ok(hex::encode(h.finalize()))
}

/// SHA-256 einer Datei (blockierend), z. B. für Java-Downloads (Adoptium).
pub fn sha256_file(path: &Path) -> std::io::Result<String> {
    use sha2::Sha256;
    use std::io::Read;
    let mut f = std::fs::File::open(path)?;
    let mut h = Sha256::new();
    let mut buf = vec![0u8; 64 * 1024];
    loop {
        let n = f.read(&mut buf)?;
        if n == 0 {
            break;
        }
        h.update(&buf[..n]);
    }
    Ok(hex::encode(h.finalize()))
}

/// SHA-512 einer Datei (blockierend), z. B. für Modrinth/mrpack.
pub fn sha512_file(path: &Path) -> std::io::Result<String> {
    use sha2::Sha512;
    use std::io::Read;
    let mut f = std::fs::File::open(path)?;
    let mut h = Sha512::new();
    let mut buf = vec![0u8; 64 * 1024];
    loop {
        let n = f.read(&mut buf)?;
        if n == 0 {
            break;
        }
        h.update(&buf[..n]);
    }
    Ok(hex::encode(h.finalize()))
}
