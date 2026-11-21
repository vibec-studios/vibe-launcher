use super::*;

// ------------------------------------------------------------------ Verwaltung (Commands)

#[derive(Debug, Clone, Serialize)]
pub struct StoreInfo {
    pub id: String,
    pub name: String,
    pub url: String,
    pub enabled: bool,
    pub icon: Option<String>,
    /// Standard-Store (kann nicht entfernt werden)
    pub builtin: bool,
    pub homepage: Option<String>,
    pub description: Option<String>,
    pub project_count: Option<u32>,
    /// Ladefehler (z. B. offline und kein Cache)
    pub error: Option<String>,
}

pub(super) fn info(c: &StoreConfig, data: Result<&StoreFile, String>) -> StoreInfo {
    let (file, error) = match data {
        Ok(f) => (Some(f), None),
        Err(e) => (None, Some(e)),
    };
    StoreInfo {
        id: c.id.clone(),
        name: file.map(|f| f.name.clone()).unwrap_or_else(|| c.name.clone()),
        url: c.url.clone(),
        enabled: c.enabled,
        icon: file.and_then(|f| f.icon.clone()).or(c.icon.clone()),
        builtin: c.id == DEFAULT_ID,
        homepage: file.and_then(|f| f.homepage.clone()),
        description: file.and_then(|f| f.description.clone()),
        project_count: file.map(|f| f.projects.len() as u32),
        error,
    }
}

pub async fn list(state: &AppState) -> Vec<StoreInfo> {
    let cfgs = configured(&state.settings());
    let futs = cfgs.iter().map(|c| async move {
        if !c.enabled {
            // Deaktivierte nicht laden – nur vorhandenen Cache zeigen
            let cached = state.content.stores.lock().get(&c.id).map(|e| e.data.clone());
            return match cached {
                Some(f) => info(c, Ok(&f)),
                None => info(c, Err(String::new())).without_error(),
            };
        }
        match fetch(state, &c.id, &c.url, false).await {
            Ok(f) => info(c, Ok(&f)),
            Err(e) => info(c, Err(e.to_string())),
        }
    });
    futures::future::join_all(futs).await
}

impl StoreInfo {
    pub(super) fn without_error(mut self) -> Self {
        self.error = None;
        self
    }
}

pub(super) fn save_stores(state: &AppState, stores: Vec<StoreConfig>) -> AppResult<()> {
    let mut s = state.settings();
    s.stores = stores;
    s.save(&state.paths.settings_file())?;
    *state.settings.write() = s.clone();
    crate::events::emit(&state.app, crate::events::SETTINGS_CHANGED, &s);
    Ok(())
}

pub async fn add(state: &AppState, url: &str) -> AppResult<StoreInfo> {
    let url = url.trim();
    let parsed = url::Url::parse(url).map_err(|_| AppError::Invalid("Bitte eine vollständige URL angeben (https://…)".into()))?;
    if !matches!(parsed.scheme(), "https" | "http") {
        return Err(AppError::Invalid("Nur http(s)-Adressen werden unterstützt".into()));
    }
    // Probe laden (unter temporärer ID), dann unter der ID aus der Datei speichern
    let probe_id = format!("probe-{}", uuid::Uuid::new_v4());
    let file = fetch(state, &probe_id, url, true).await;
    state.content.stores.lock().remove(&probe_id);
    let (d, m) = disk_paths(state, &probe_id);
    let _ = std::fs::remove_file(d);
    let _ = std::fs::remove_file(m);
    let file = file?;
    let mut stores = configured(&state.settings());
    if let Some(existing) = stores.iter().find(|s| same_url(&s.url, url) || s.id == file.id) {
        if same_url(&existing.url, url) {
            return Err(AppError::Invalid(format!("Der Store „{}“ ist bereits eingetragen", existing.name)));
        }
        return Err(AppError::Invalid(format!("Ein Store mit der ID „{}“ ist bereits eingetragen", file.id)));
    }
    let cfg = StoreConfig { id: file.id.clone(), name: file.name.clone(), url: url.to_string(), enabled: true, icon: file.icon.clone() };
    stores.push(cfg.clone());
    save_stores(state, stores)?;
    let f = fetch(state, &cfg.id, &cfg.url, true).await?;
    Ok(info(&cfg, Ok(&f)))
}

pub fn remove(state: &AppState, id: &str) -> AppResult<()> {
    if id == DEFAULT_ID {
        return Err(AppError::Invalid("Der Standard-Store kann nur deaktiviert werden".into()));
    }
    let mut stores = configured(&state.settings());
    let before = stores.len();
    stores.retain(|s| s.id != id);
    if stores.len() == before {
        return Err(AppError::NotFound(format!("Store {id}")));
    }
    state.content.stores.lock().remove(id);
    let (d, m) = disk_paths(state, id);
    let _ = std::fs::remove_file(d);
    let _ = std::fs::remove_file(m);
    save_stores(state, stores)
}

pub fn set_enabled(state: &AppState, id: &str, enabled: bool) -> AppResult<()> {
    let mut stores = configured(&state.settings());
    let s = stores.iter_mut().find(|s| s.id == id).ok_or_else(|| AppError::NotFound(format!("Store {id}")))?;
    s.enabled = enabled;
    save_stores(state, stores)
}
