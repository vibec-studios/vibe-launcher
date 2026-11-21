pub mod commands;
pub mod memory;
mod tray;
mod watch;
mod window;

use crate::state::AppState;
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, AtomicI64, Ordering};
use tauri::{AppHandle, Emitter, Listener, Manager};

pub const MAIN: &str = "main";
pub const PREPARE_EVENT: &str = "lean://prepare";
const HANDOFF_TIMEOUT_MS: u64 = 3_000;
const START_GRACE_MS: i64 = 10_000;
const REOPEN_GRACE_MS: i64 = 60_000;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(default)]
pub struct LeanSettings {
    pub enabled: bool,
    pub reopen: bool,
}

impl Default for LeanSettings {
    fn default() -> Self {
        LeanSettings { enabled: true, reopen: true }
    }
}

#[derive(Debug, Clone, Serialize, Default)]
pub struct Restore {
    pub route: Option<String>,
    pub reason: String,
    pub instance_id: Option<String>,
}

#[derive(Default)]
pub struct Lean {
    active: AtomicBool,
    pending: AtomicBool,
    watching: AtomicBool,
    grace_until: AtomicI64,
    route: Mutex<Option<String>>,
    restore: Mutex<Option<Restore>>,
    geometry: Mutex<Option<window::Geometry>>,
}

fn lean(app: &AppHandle) -> Option<tauri::State<'_, Lean>> {
    app.try_state::<Lean>()
}

pub fn init(app: &AppHandle) {
    app.manage(Lean::default());
    let h = app.clone();
    app.listen(crate::events::GAME_STATE, move |ev| {
        let Ok(v) = serde_json::from_str::<serde_json::Value>(ev.payload()) else { return };
        on_game_state(&h, &v);
    });
}

pub fn is_active(app: &AppHandle) -> bool {
    lean(app).is_some_and(|l| l.active.load(Ordering::SeqCst) || l.pending.load(Ordering::SeqCst))
}

pub fn enabled(state: &AppState) -> bool {
    state.settings().lean.enabled
}

fn on_game_state(app: &AppHandle, v: &serde_json::Value) {
    let (Some(state), Some(l)) = (app.try_state::<AppState>(), lean(app)) else { return };
    match v.get("state").and_then(|x| x.as_str()) {
        Some("running") => {
            let until = crate::util::now_ms() + START_GRACE_MS;
            l.grace_until.fetch_max(until, Ordering::SeqCst);
            watch::ensure(app);
        }
        Some("stopped") if l.active.load(Ordering::SeqCst) => {
            let crashed = v.get("crashed").and_then(|x| x.as_bool()).unwrap_or(false);
            let instance = v.get("instance_id").and_then(|x| x.as_str()).map(str::to_string);
            if crashed {
                restore(app, "crash", instance);
            } else if !state.game.any_running() && state.settings().lean.reopen {
                restore(app, "game_ended", instance);
            }
        }
        _ => {}
    }
    if l.active.load(Ordering::SeqCst) {
        tray::refresh(app);
    }
}

pub fn enter(app: &AppHandle) {
    let Some(l) = lean(app) else { return };
    if l.active.load(Ordering::SeqCst) || l.pending.swap(true, Ordering::SeqCst) {
        return;
    }
    if app.get_webview_window(MAIN).is_none() {
        l.pending.store(false, Ordering::SeqCst);
        return;
    }
    let _ = app.emit(PREPARE_EVENT, ());
    let h = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(HANDOFF_TIMEOUT_MS));
        if lean(&h).is_some_and(|l| l.pending.load(Ordering::SeqCst)) {
            tracing::info!("Schlank-Modus: keine Antwort vom Frontend, Fenster wird trotzdem geschlossen");
            finish(&h);
        }
    });
}

pub(crate) fn finish(app: &AppHandle) {
    let (Some(state), Some(l)) = (app.try_state::<AppState>(), lean(app)) else { return };
    if !l.pending.swap(false, Ordering::SeqCst) {
        return;
    }
    if !enabled(&state) || !state.game.any_running() {
        return;
    }
    let Some(w) = app.get_webview_window(MAIN) else { return };
    *l.geometry.lock() = window::Geometry::capture(&w);
    l.active.store(true, Ordering::SeqCst);
    crate::vibe::ws::close_all();
    tray::show(app);
    if let Err(e) = w.destroy() {
        tracing::warn!("Hauptfenster nicht schließbar: {e}");
        l.active.store(false, Ordering::SeqCst);
        tray::remove(app);
        return;
    }
    tracing::info!("Schlank-Modus: Hauptfenster geschlossen, Launcher läuft im Infobereich weiter");
}

pub fn restore(app: &AppHandle, reason: &str, instance_id: Option<String>) {
    let Some(l) = lean(app) else { return };
    if let Some(w) = app.get_webview_window(MAIN) {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
        return;
    }
    if !l.active.swap(false, Ordering::SeqCst) {
        return;
    }
    let route = l.route.lock().take();
    *l.restore.lock() = Some(Restore { route, reason: reason.to_string(), instance_id });
    l.grace_until.store(crate::util::now_ms() + REOPEN_GRACE_MS, Ordering::SeqCst);
    let geometry = l.geometry.lock().take();
    let h = app.clone();
    std::thread::spawn(move || {
        if let Err(e) = window::create(&h, geometry) {
            tracing::error!("Hauptfenster konnte nicht neu erstellt werden: {e}");
            if let Some(l) = lean(&h) {
                l.active.store(true, Ordering::SeqCst);
            }
            return;
        }
        tray::remove(&h);
        tracing::info!("Schlank-Modus beendet ({})", h.try_state::<Lean>().and_then(|l| l.restore.lock().as_ref().map(|r| r.reason.clone())).unwrap_or_default());
    });
}

pub fn show_main(app: &AppHandle) {
    restore(app, "user", None);
}

pub fn close_to_tray(app: &AppHandle) -> bool {
    let Some(state) = app.try_state::<AppState>() else { return false };
    if !enabled(&state) || !state.game.any_running() {
        return false;
    }
    enter(app);
    true
}

pub fn on_exit(app: &AppHandle) {
    if lean(app).is_some_and(|l| l.active.load(Ordering::SeqCst)) {
        if let Some(state) = app.try_state::<AppState>() {
            crate::portable::on_exit(&state);
        }
    }
}

pub(crate) fn set_route(app: &AppHandle, route: Option<String>) {
    if let Some(l) = lean(app) {
        *l.route.lock() = route.filter(|r| r.starts_with('/') && r.len() <= 2048);
    }
}

pub(crate) fn take_restore(app: &AppHandle) -> Option<Restore> {
    lean(app)?.restore.lock().take()
}

pub(crate) fn grace_until(app: &AppHandle) -> i64 {
    lean(app).map(|l| l.grace_until.load(Ordering::SeqCst)).unwrap_or(0)
}

pub(crate) fn watching(app: &AppHandle) -> Option<tauri::State<'_, Lean>> {
    lean(app)
}

impl Lean {
    pub(crate) fn watch_flag(&self) -> &AtomicBool {
        &self.watching
    }
    pub(crate) fn busy(&self) -> bool {
        self.active.load(Ordering::SeqCst) || self.pending.load(Ordering::SeqCst)
    }
}

#[cfg(test)]
mod tests;
