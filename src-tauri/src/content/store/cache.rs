use super::*;

// ------------------------------------------------------------------ Laden + Cache

#[derive(Clone)]
pub struct CacheEntry {
    pub(super) url: String,
    pub(super) fetched: Instant,
    pub(super) etag: Option<String>,
    pub(super) last_modified: Option<String>,
    pub data: Arc<StoreFile>,
}

#[derive(Serialize, Deserialize)]
pub(super) struct DiskMeta {
    pub(super) url: String,
    pub(super) etag: Option<String>,
    pub(super) last_modified: Option<String>,
}

pub(super) fn disk_paths(state: &AppState, id: &str) -> (PathBuf, PathBuf) {
    let dir = state.paths.cache().join("stores");
    (dir.join(format!("{id}.json")), dir.join(format!("{id}.meta.json")))
}

/// Datei laden (bedingt, mit Cache). `force` ignoriert die Frist.
/// Gleiche Store-Datei? Der offizielle Store gilt unter alter und neuer Adresse als derselbe (Cache bleibt gültig).
pub(super) fn same_url(a: &str, b: &str) -> bool {
    a == b || (crate::domains::is_official_store(a) && crate::domains::is_official_store(b))
}

pub(super) async fn fetch(state: &AppState, id: &str, url: &str, force: bool) -> AppResult<Arc<StoreFile>> {
    let cached = state.content.stores.lock().get(id).cloned().filter(|c| same_url(&c.url, url));
    if let Some(c) = &cached {
        if !force && c.fetched.elapsed() < TTL {
            return Ok(c.data.clone());
        }
    }
    // Plattencache als Grundlage für bedingte Anfragen / Offline
    let (data_p, meta_p) = disk_paths(state, id);
    let disk: Option<(DiskMeta, Arc<StoreFile>)> = if cached.is_none() {
        let m = std::fs::read(&meta_p).ok().and_then(|b| serde_json::from_slice::<DiskMeta>(&b).ok()).filter(|m| same_url(&m.url, url));
        let d = std::fs::read(&data_p).ok().and_then(|b| serde_json::from_slice::<StoreFile>(&b).ok());
        m.zip(d).map(|(m, d)| (m, Arc::new(d)))
    } else {
        None
    };
    let (etag, lm, prev) = match (&cached, &disk) {
        (Some(c), _) => (c.etag.clone(), c.last_modified.clone(), Some(c.data.clone())),
        (None, Some((m, d))) => (m.etag.clone(), m.last_modified.clone(), Some(d.clone())),
        _ => (None, None, None),
    };
    let mut rb = state.net.client.get(url).header("Accept", "application/json").timeout(Duration::from_secs(30));
    if prev.is_some() {
        if let Some(e) = &etag {
            rb = rb.header("If-None-Match", e);
        }
        if let Some(l) = &lm {
            rb = rb.header("If-Modified-Since", l);
        }
    }
    let res = rb.send().await;
    let store_entry = |data: Arc<StoreFile>, etag: Option<String>, lm: Option<String>| {
        state.content.stores.lock().insert(id.to_string(), CacheEntry { url: url.to_string(), fetched: Instant::now(), etag, last_modified: lm, data: data.clone() });
        data
    };
    match res {
        Ok(r) if r.status().as_u16() == 304 && prev.is_some() => Ok(store_entry(prev.unwrap_or_default(), etag, lm)),
        Ok(r) if r.status().is_success() => {
            let h = |n: &str| r.headers().get(n).and_then(|v| v.to_str().ok()).map(str::to_string);
            let (etag, lm) = (h("etag"), h("last-modified"));
            let bytes = r.bytes().await?;
            let file: StoreFile = serde_json::from_slice(&bytes).map_err(|e| AppError::Invalid(format!("Store-Datei ist kein gültiges JSON: {e}")))?;
            validate(&file)?;
            if let Some(dir) = data_p.parent() {
                let _ = std::fs::create_dir_all(dir);
            }
            let _ = std::fs::write(&data_p, &bytes);
            let _ = crate::util::write_json_atomic(&meta_p, &DiskMeta { url: url.to_string(), etag: etag.clone(), last_modified: lm.clone() });
            Ok(store_entry(Arc::new(file), etag, lm))
        }
        Ok(r) => {
            let code = r.status().as_u16();
            match prev {
                Some(p) if code >= 500 || code == 429 => Ok(store_entry(p, etag, lm)),
                _ => Err(AppError::msg(format!("Store nicht erreichbar (HTTP {code})"))),
            }
        }
        Err(e) => match prev {
            Some(p) => {
                tracing::warn!("Store {id} nicht erreichbar, nutze Cache: {e}");
                Ok(store_entry(p, etag, lm))
            }
            None => Err(AppError::msg(format!("Store nicht erreichbar – Internetverbindung prüfen ({e})"))),
        },
    }
}

/// Store-Daten (aus dem Cache oder frisch geladen).
pub async fn load(state: &AppState, key: StoreKey) -> AppResult<Arc<StoreFile>> {
    let id = key.id();
    let cfg = config(state, &id)?;
    fetch(state, &id, &cfg.url, false).await
}

/// Alle aktivierten Stores (Fehler einzelner Stores werden geloggt und übersprungen).
pub async fn load_enabled(state: &AppState) -> Vec<(StoreKey, Arc<StoreFile>)> {
    let cfgs: Vec<StoreConfig> = configured(&state.settings()).into_iter().filter(|s| s.enabled).collect();
    let futs = cfgs.iter().map(|c| async move { (c.id.clone(), fetch(state, &c.id, &c.url, false).await) });
    let mut out = Vec::new();
    for (id, r) in futures::future::join_all(futs).await {
        match r {
            Ok(f) => out.push((StoreKey::intern(&id), f)),
            Err(e) => tracing::warn!("Store {id}: {e}"),
        }
    }
    out
}
