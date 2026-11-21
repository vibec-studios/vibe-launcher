use super::{enabled, grace_until, watching, MAIN};
use crate::state::AppState;
use std::sync::atomic::Ordering;
use std::time::Duration;
use tauri::{AppHandle, Manager};

const TICK: Duration = Duration::from_secs(2);
pub(super) const UNFOCUSED_MS: i64 = 8_000;

pub(super) fn should_enter(in_use: bool, unfocused_since: Option<i64>, now: i64, grace_until: i64) -> bool {
    !in_use && now >= grace_until && unfocused_since.is_some_and(|s| now - s >= UNFOCUSED_MS)
}

pub(super) fn ensure(app: &AppHandle) {
    let Some(l) = watching(app) else { return };
    if l.watch_flag().swap(true, Ordering::SeqCst) {
        return;
    }
    let h = app.clone();
    std::thread::Builder::new().name("lean-watch".into()).spawn(move || run(h)).ok();
}

fn run(app: AppHandle) {
    let mut since: Option<i64> = None;
    loop {
        std::thread::sleep(TICK);
        let (Some(state), Some(l)) = (app.try_state::<AppState>(), watching(&app)) else { return };
        if !state.game.any_running() {
            l.watch_flag().store(false, Ordering::SeqCst);
            if state.game.any_running() && !l.watch_flag().swap(true, Ordering::SeqCst) {
                continue;
            }
            return;
        }
        if l.busy() || !enabled(&state) {
            since = None;
            continue;
        }
        let Some(w) = app.get_webview_window(MAIN) else {
            since = None;
            continue;
        };
        let in_use = w.is_focused().unwrap_or(false) && w.is_visible().unwrap_or(false) && !w.is_minimized().unwrap_or(false);
        let now = crate::util::now_ms();
        since = if in_use { None } else { Some(since.unwrap_or(now)) };
        if should_enter(in_use, since, now, grace_until(&app)) {
            since = None;
            super::enter(&app);
        }
    }
}
