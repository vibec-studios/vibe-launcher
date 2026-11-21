//! Globaler App-Zustand, per `tauri::State<'_, AppState>` in Commands verfügbar.
//!
//! Der gemeinsame Teil (Pfade, Netz, Aufgaben, Server) liegt in [`vibe_server_core::Core`] und ist über `Deref`
//! direkt erreichbar (`state.paths`, `state.net`, `state.servers` …).
use crate::auth::AuthState;
use crate::content::ContentState;
use crate::instance::InstanceStore;
use crate::minecraft::GameManager;
use crate::net::Net;
use crate::paths::Paths;
use crate::server::host::{LauncherHost, TauriSink};
use crate::settings::Settings;
use parking_lot::RwLock;
use std::sync::Arc;
use tauri::AppHandle;
use vibe_server_core::Core;

#[derive(Clone)]
pub struct AppState {
    pub core: Core,
    pub app: AppHandle,
    pub settings: Arc<RwLock<Settings>>,
    pub instances: Arc<InstanceStore>,
    pub auth: Arc<AuthState>,
    pub game: Arc<GameManager>,
    pub content: Arc<ContentState>,
    /// Gefundenes Launcher-Update (zwischen Prüfung und Installation)
    pub pending_update: crate::updater::PendingUpdate,
}

impl std::ops::Deref for AppState {
    type Target = Core;
    fn deref(&self) -> &Core {
        &self.core
    }
}

impl AppState {
    pub fn init(app: AppHandle) -> Self {
        vibe_server_core::product::set(crate::server::host::product());
        vibe_server_core::rt::set_handle(tauri::async_runtime::handle().inner().clone());
        let paths = Paths::new();
        if let Err(e) = paths.ensure() {
            tracing::error!("Datenordner {:?} nicht anlegbar: {e}", paths.root);
        }
        let settings = Arc::new(RwLock::new(Settings::load_for(&paths)));
        let net = Arc::new(Net::new(settings.read().concurrent_downloads as usize));
        let host = Arc::new(LauncherHost { settings: settings.clone(), state: Default::default() });
        let core = Core::new(paths.clone(), net, Arc::new(TauriSink(app.clone())), host.clone());
        let instances = InstanceStore::load(paths.clone(), app.clone());
        let auth = AuthState::load(paths.clone(), app.clone());
        let game = GameManager::new(paths.clone(), app.clone());
        let content = ContentState::new(paths, app.clone(), core.http_cache.clone());
        let state = AppState { core, app, settings, instances, auth, game, content, pending_update: Default::default() };
        let _ = host.state.set(state.clone());
        state
    }

    /// Kopie der aktuellen Einstellungen.
    pub fn settings(&self) -> Settings {
        self.settings.read().clone()
    }
}
