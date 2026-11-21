//! Laufende Spielprozesse: Sitzungen (eine Instanz kann mehrfach laufen), Log-Puffer, Events, Beenden, Crash-Erkennung.
use super::logs::{decode_line, LineParser, Parsed};
use super::sessions::{BeginOpts, Registry};
use super::{GameState, LogLevel, LogLine};
use crate::error::{AppError, AppResult};
use crate::events;
use crate::paths::Paths;
use crate::state::AppState;
use parking_lot::Mutex;
use std::sync::{Arc, Weak};
use std::time::Duration;
use tauri::{AppHandle, Manager};
use tokio::io::AsyncBufReadExt;

mod query;
mod runs;
mod lifecycle;
mod attach;


/// Verwaltet laufende Spielsitzungen und ihre Log-Puffer. Schlüssel (`key`) ist eine Run-ID oder eine
/// Instanz-ID (dann die neueste, bevorzugt laufende Sitzung der Instanz).
pub struct GameManager {
    paths: Paths,
    app: AppHandle,
    me: Weak<GameManager>,
    reg: Mutex<Registry>,
    flusher: std::sync::Once,
}

pub use vibe_server_core::minecraft::process::kill_tree;

/// `settings.launch_behavior`: Launcher während des Spiels minimieren/verstecken, danach zeigen.
pub(crate) fn apply_launch_behavior(state: &AppState, started: bool) {
    use crate::settings::LaunchBehavior;
    let behavior = state.settings().launch_behavior;
    if behavior == LaunchBehavior::Keep {
        return;
    }
    let Some(w) = state.app.get_webview_window("main") else { return };
    if started {
        match behavior {
            LaunchBehavior::Minimize => {
                let _ = w.minimize();
            }
            LaunchBehavior::Hide => {
                let _ = w.hide();
            }
            LaunchBehavior::Keep => {}
        }
    } else {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}
