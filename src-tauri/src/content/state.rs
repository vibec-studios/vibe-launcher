use super::*;

/// Laufzeit-Zustand des Content-Moduls: kurzlebiger API-Cache, Sperren je Instanz für `content.json`,
/// laufende Hash-Zuordnungen.
pub struct ContentState {
    /// Datenordner (Kopie aus `AppState`, für Hintergrundarbeit ohne AppState)
    pub paths: Paths,
    pub(crate) app: AppHandle,
    pub(super) http_cache: Arc<vibe_server_core::content::HttpCache>,
    pub(super) locks: Mutex<HashMap<String, Arc<tokio::sync::Mutex<()>>>>,
    pub(super) launch_gates: Mutex<HashMap<String, Arc<tokio::sync::Mutex<()>>>>,
    /// Instanzen, für die gerade eine Hash-Zuordnung im Hintergrund läuft
    pub(crate) identifying: Mutex<HashSet<String>>,
    /// Letzter fehlgeschlagener Zuordnungsversuch je Instanz (Netzwerk) – nicht sofort wiederholen
    pub(crate) identify_backoff: Mutex<HashMap<String, Instant>>,
    /// Geladene Store-Dateien (Vibe Store v1)
    pub(crate) stores: Mutex<HashMap<String, store::CacheEntry>>,
    /// Anzahl verfügbarer Updates je Instanz (Hintergrundprüfung nach dem Start)
    pub(crate) update_counts: Mutex<HashMap<String, u32>>,
    /// Download-Ordner auf manuelle Downloads beobachten: Instanz -> Ende der Beobachtung
    pub(crate) manual_watch: Mutex<HashMap<String, Instant>>,
    /// Läuft die Beobachtungsschleife?
    pub(crate) manual_watch_running: std::sync::atomic::AtomicBool,
}

impl ContentState {
    pub fn new(paths: Paths, app: AppHandle, http_cache: Arc<vibe_server_core::content::HttpCache>) -> Arc<Self> {
        Arc::new(ContentState {
            paths,
            app,
            http_cache,
            locks: Mutex::new(HashMap::new()),
            launch_gates: Mutex::new(HashMap::new()),
            identifying: Mutex::new(HashSet::new()),
            identify_backoff: Mutex::new(HashMap::new()),
            stores: Mutex::new(HashMap::new()),
            update_counts: Mutex::new(HashMap::new()),
            manual_watch: Mutex::new(HashMap::new()),
            manual_watch_running: std::sync::atomic::AtomicBool::new(false),
        })
    }

    /// Kurzzeit-Cache der Plattform-APIs und geladene Store-Dateien verwerfen („Neu prüfen“).
    pub(crate) fn clear_api_cache(&self) {
        self.http_cache.clear();
        self.stores.lock().clear();
    }

    /// Sperre für Lese-Ändere-Schreibe-Zyklen an `content.json` einer Instanz.
    pub(crate) fn lock(&self, instance_id: &str) -> Arc<tokio::sync::Mutex<()>> {
        self.locks.lock().entry(instance_id.to_string()).or_default().clone()
    }

    pub(crate) fn emit_changed(&self, instance_id: &str) {
        crate::events::emit(&self.app, crate::events::CONTENT_CHANGED, &serde_json::json!({ "instance_id": instance_id }));
    }

    pub(crate) fn launch_gate(&self, instance_id: &str) -> Arc<tokio::sync::Mutex<()>> {
        self.launch_gates.lock().entry(instance_id.to_string()).or_default().clone()
    }
}
