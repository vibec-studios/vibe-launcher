use super::manifest::{decode_key, ModelError};
use super::store::Store;
use super::update::{due, fetch_remote, install, newer};
use super::{MANIFEST_URL, PUBLIC_KEY, STATUS_EVENT};
use crate::state::AppState;
use parking_lot::Mutex;
use serde::Serialize;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use vibefix_infer::AnyModel;

pub struct Loaded {
    pub version: String,
    pub model: AnyModel,
}

#[derive(Default)]
pub struct VibeFix {
    loaded: Mutex<Option<Arc<Loaded>>>,
    busy: tokio::sync::Mutex<()>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Phase {
    Checking,
    Downloading,
    Loading,
    Analyzing,
    Done,
}

#[derive(Debug, Clone, Serialize)]
pub struct StatusEvent {
    pub phase: Phase,
    pub done: u64,
    pub total: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Notice {
    Disabled,
    Unavailable,
    Error,
}

impl Notice {
    pub fn as_str(&self) -> &'static str {
        match self {
            Notice::Disabled => "disabled",
            Notice::Unavailable => "unavailable",
            Notice::Error => "error",
        }
    }
}

pub enum Prepared {
    Ready(Arc<Loaded>),
    Off(Notice),
}

#[derive(Debug, Clone, Serialize)]
pub struct VibeFixStatus {
    pub enabled: bool,
    pub version: Option<String>,
    pub remote_version: Option<String>,
    pub checked_at: Option<i64>,
    pub loaded: bool,
}

pub fn emit_phase(state: &AppState, phase: Phase, done: u64, total: u64) {
    crate::events::emit(&state.app, STATUS_EVENT, &StatusEvent { phase, done, total });
}

pub fn key() -> Vec<u8> {
    decode_key(PUBLIC_KEY)
}

impl VibeFix {
    pub fn cached(&self) -> Option<Arc<Loaded>> {
        self.loaded.lock().clone()
    }

    pub fn forget(&self) {
        *self.loaded.lock() = None;
    }

    fn load(&self, store: &Store, key: &[u8]) -> Result<Arc<Loaded>, ModelError> {
        let version = store.current().ok_or(ModelError::Missing)?;
        if let Some(l) = self.cached().filter(|l| l.version == version) {
            return Ok(l);
        }
        let pkg = store.read_package(key)?;
        let model = AnyModel::from_bytes(&pkg.config, &pkg.tokenizer, &pkg.weights).map_err(|e| ModelError::Invalid(e.to_string()))?;
        let loaded = Arc::new(Loaded { version: pkg.manifest.version, model });
        *self.loaded.lock() = Some(loaded.clone());
        Ok(loaded)
    }
}

pub async fn update(state: &AppState, store: &Store, key: &[u8]) {
    let now = crate::util::now_ms();
    let mut st = store.state();
    let local = store.current();
    if !due(&st, local.is_some(), now) {
        return;
    }
    emit_phase(state, Phase::Checking, 0, 0);
    match fetch_remote(&state.net.client, MANIFEST_URL, key).await {
        Ok(remote) => {
            st.checked_at = Some(now);
            st.failed_at = None;
            st.remote_version = Some(remote.manifest.version.clone());
            if newer(local.as_deref(), &remote.manifest) {
                let step = AtomicU64::new(u64::MAX);
                let progress = |done: u64, total: u64| {
                    let pct = done.min(total) * 100 / total.max(1);
                    if step.swap(pct, Ordering::Relaxed) != pct {
                        emit_phase(state, Phase::Downloading, done.min(total), total);
                    }
                };
                if let Err(e) = install(&state.net, store, &remote, MANIFEST_URL, key, &progress).await {
                    tracing::warn!("VibeFix: Modell {} nicht geladen: {e}", remote.manifest.version);
                    st.failed_at = Some(now);
                }
            }
        }
        Err(e) => {
            tracing::info!("VibeFix: Manifest nicht abrufbar: {e}");
            st.failed_at = Some(now);
        }
    }
    store.save_state(&st);
}

pub async fn prepare(state: &AppState) -> Prepared {
    if !state.settings().vibefix {
        return Prepared::Off(Notice::Disabled);
    }
    let vf = state.vibefix.clone();
    let _busy = vf.busy.lock().await;
    let store = Store::new(&state.paths.root);
    let key = key();
    update(state, &store, &key).await;
    emit_phase(state, Phase::Loading, 0, 0);
    let (vf2, store2, key2) = (vf.clone(), store.clone(), key.clone());
    let loaded = tokio::task::spawn_blocking(move || vf2.load(&store2, &key2)).await.unwrap_or_else(|e| Err(ModelError::Io(e.to_string())));
    match loaded {
        Ok(l) => Prepared::Ready(l),
        Err(ModelError::Missing) => Prepared::Off(Notice::Unavailable),
        Err(e) => {
            tracing::warn!("VibeFix: lokales Modell unbrauchbar, wird neu geladen: {e}");
            vf.forget();
            store.reset();
            Prepared::Off(Notice::Unavailable)
        }
    }
}

pub fn status(state: &AppState) -> VibeFixStatus {
    let store = Store::new(&state.paths.root);
    let st = store.state();
    VibeFixStatus {
        enabled: state.settings().vibefix,
        version: store.current(),
        remote_version: st.remote_version,
        checked_at: st.checked_at,
        loaded: state.vibefix.cached().is_some(),
    }
}
