//! Globaler App-Zustand, per `tauri::State<'_, AppState>` in Commands verfügbar.
use crate::auth::AuthState;
use crate::content::ContentState;
use crate::instance::InstanceStore;
use crate::minecraft::GameManager;
use crate::net::Net;
use crate::paths::Paths;
use crate::settings::Settings;
use crate::tasks::Tasks;
use parking_lot::RwLock;
use std::sync::Arc;
use tauri::AppHandle;

#[derive(Clone)]
pub struct AppState {
    pub app: AppHandle,
    pub paths: Paths,
    pub settings: Arc<RwLock<Settings>>,
    pub net: Arc<Net>,
    pub tasks: Arc<Tasks>,
    pub instances: Arc<InstanceStore>,
    pub auth: Arc<AuthState>,
    pub game: Arc<GameManager>,
    pub content: Arc<ContentState>,
}

impl AppState {
    pub fn init(app: AppHandle) -> Self {
        let paths = Paths::new();
        if let Err(e) = paths.ensure() {
            tracing::error!("Datenordner {:?} nicht anlegbar: {e}", paths.root);
        }
        let settings = Settings::load(&paths.settings_file());
        let net = Arc::new(Net::new(settings.concurrent_downloads as usize));
        let tasks = Tasks::new(app.clone());
        let instances = InstanceStore::load(paths.clone(), app.clone());
        let auth = AuthState::load(paths.clone(), app.clone());
        let game = GameManager::new(paths.clone(), app.clone());
        let content = ContentState::new(paths.clone(), app.clone());
        AppState {
            app,
            paths,
            settings: Arc::new(RwLock::new(settings)),
            net,
            tasks,
            instances,
            auth,
            game,
            content,
        }
    }

    /// Kopie der aktuellen Einstellungen.
    pub fn settings(&self) -> Settings {
        self.settings.read().clone()
    }
}
