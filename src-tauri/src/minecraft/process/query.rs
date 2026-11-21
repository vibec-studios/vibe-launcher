use super::*;

impl GameManager {
    pub fn new(paths: Paths, app: AppHandle) -> Arc<Self> {
        Arc::new_cyclic(|me| GameManager {
            paths,
            app,
            me: me.clone(),
            reg: Mutex::new(Registry::default()),
            flusher: std::sync::Once::new(),
        })
    }

    pub fn states(&self) -> Vec<GameState> {
        self.reg.lock().states()
    }

    pub fn state_of(&self, key: &str) -> Option<GameState> {
        self.reg.lock().get(key).map(|s| s.state.clone())
    }

    pub fn spark_report(&self, run_id: &str) -> Option<String> {
        self.reg.lock().get(run_id)?.spark_report.clone()
    }

    pub fn latest_crash(&self, instance_id: &str) -> Option<GameState> {
        self.reg.lock().latest_crash(instance_id)
    }

    /// Mindestens eine Sitzung läuft oder wird gerade gestartet.
    pub fn is_running(&self, instance_id: &str) -> bool {
        self.reg.lock().is_active(instance_id)
    }

    /// Mindestens ein Prozess der Instanz läuft (nicht nur Vorbereitung).
    pub fn is_process_running(&self, instance_id: &str) -> bool {
        self.reg.lock().is_process_running(instance_id)
    }

    pub fn running_count(&self) -> usize {
        self.reg.lock().running_count()
    }

    pub(crate) fn any_running(&self) -> bool {
        self.reg.lock().any_running()
    }

    pub fn active_runs(&self, instance_id: &str) -> Vec<String> {
        self.reg.lock().active_runs(instance_id)
    }

    /// Andere aktive Sitzungen derselben Instanz.
    pub fn others_active(&self, instance_id: &str, run_id: &str) -> usize {
        self.reg.lock().others_active(instance_id, run_id)
    }

    pub fn account_in_use(&self, uuid: &str, except_run: &str) -> Option<GameState> {
        self.reg.lock().account_in_use(uuid, except_run)
    }

    pub(super) fn emit_state(&self, st: &GameState) {
        events::emit(&self.app, events::GAME_STATE, st);
    }

    pub(super) fn ensure_flusher(&self) {
        self.flusher.call_once(|| {
            let me = self.me.clone();
            tauri::async_runtime::spawn(async move {
                loop {
                    tokio::time::sleep(Duration::from_millis(100)).await;
                    let Some(gm) = me.upgrade() else { break };
                    gm.flush();
                }
            });
        });
    }

    pub(super) fn flush(&self) {
        let batches = self.reg.lock().take_pending();
        for b in batches {
            events::emit(&self.app, events::GAME_LOG, &serde_json::json!({ "run_id": b.run_id, "instance_id": b.instance_id, "lines": b.lines }));
        }
    }
}
