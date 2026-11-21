use super::files::{self, AfkEvent, Mode};
use super::registry::{self, AgentState, Run, Snapshot};
use super::{logscan, notify, overlay, window};
use crate::error::{AppError, AppResult};
use crate::minecraft::logs::Parsed;
use crate::minecraft::{LogLevel, RunState};
use crate::state::AppState;
use std::time::Duration;
use tauri::{AppHandle, Manager};

mod alerts;
mod tick;

pub use alerts::*;
use tick::*;

pub const SESSION_EVENT: &str = "afk://session";
pub const EVENT_EVENT: &str = "afk://event";
const AGENT_TIMEOUT_MS: i64 = 30_000;
const AGENT_GRACE_MS: i64 = 5_000;

static APP: std::sync::OnceLock<AppHandle> = std::sync::OnceLock::new();

pub fn set_background(state: &AppState, run_id: &str, background: bool) -> AppResult<Snapshot> {
    let cfg = state.settings().afk;
    if !cfg.enabled {
        return Err(AppError::Invalid("Der AFK-Modus ist in den Einstellungen ausgeschaltet.".into()));
    }
    track_untracked(state, run_id)?;
    let g = state.game.state_of(run_id);
    let pid = g.as_ref().and_then(|g| g.pid);
    let now = crate::util::now_ms();
    let snap = registry::with(|r| {
        let run = r.get_mut(run_id)?;
        run.set_mode(if background { Mode::Background } else { Mode::Foreground }, now);
        write_mode(run, pid, now);
        if background {
            if run.agent != AgentState::Active || !run.features.window {
                run.window_seen_at = Some(now - AGENT_GRACE_MS);
                if let Some(pid) = pid {
                    hide_now(run, pid, now);
                }
            }
        } else {
            show_now(run, pid);
        }
        run.changed().or_else(|| Some(run.snapshot()))
    });
    let snap = snap.ok_or_else(|| AppError::Invalid("Diese Sitzung läuft nicht.".into()))?;
    crate::minecraft::resume::refresh_afk(state, run_id);
    emit_snapshot(&state.app, &snap);
    let text = if background { "AFK: Sitzung läuft jetzt im Hintergrund." } else { "AFK: Bildschirm wird wieder angezeigt." };
    state.game.launcher_line(run_id, LogLevel::Launcher, text.into());
    Ok(snap)
}

pub fn send(state: &AppState, run_id: &str, text: &str) -> AppResult<String> {
    let text = files::clean_text(text).map_err(|code| {
        AppError::Invalid(match code {
            "too_long" => format!("Höchstens {} Zeichen.", files::MAX_TEXT),
            "control" => "Die Nachricht enthält unerlaubte Zeichen.".into(),
            _ => "Die Nachricht ist leer.".into(),
        })
    })?;
    let dir = registry::with(|r| r.get(run_id).filter(|x| x.can_send()).map(Run::vibe_dir))
        .ok_or_else(|| AppError::Invalid("Nachrichten senden geht nur mit geladenem AFK-Agent.".into()))?;
    let id = uuid::Uuid::new_v4().simple().to_string();
    let now = crate::util::now_ms();
    files::append_outbox(&dir, &files::outbox_line(&id, &text))?;
    let ev = AfkEvent::new(now, "outgoing").with("id", id.clone()).with("text", text);
    let iid = registry::with(|r| r.get_mut(run_id).and_then(|x| x.apply(ev.clone()).map(|_| x.instance_id.clone())));
    if let Some(iid) = iid {
        crate::events::emit(&state.app, EVENT_EVENT, &EventPayload { run_id, instance_id: &iid, event: &ev });
    }
    Ok(id)
}

pub fn on_exit(state: &AppState, run_id: &str, instance_id: &str) {
    let game_dir = state.paths.game_dir(instance_id);
    files::remove_afk_if(&game_dir.join(".vibe"), run_id);
    registry::with(|r| {
        if let Some(x) = r.get_mut(run_id) {
            x.hidden.clear();
        }
    });
    if state.game.others_active(instance_id, run_id) == 0 && overlay::pending(&game_dir) {
        match overlay::restore(&game_dir) {
            Ok(true) => state.game.launcher_line(run_id, LogLevel::Launcher, "AFK: Spieleinstellungen wiederhergestellt.".into()),
            Ok(false) => {}
            Err(e) => state.game.launcher_line(run_id, LogLevel::Warn, format!("AFK: Spieleinstellungen nicht wiederhergestellt: {e}")),
        }
    }
}

fn busy_dirs() -> Vec<std::path::PathBuf> {
    use sysinfo::{ProcessRefreshKind, ProcessesToUpdate, System, UpdateKind};
    let mut sys = System::new();
    sys.refresh_processes_specifics(ProcessesToUpdate::All, true, ProcessRefreshKind::nothing().with_cwd(UpdateKind::Always));
    sys.processes().values().filter(|p| p.name().to_string_lossy().to_lowercase().contains("java")).filter_map(|p| p.cwd().map(|c| c.to_path_buf())).collect()
}

pub fn recover(state: &AppState) {
    let pending: Vec<_> = state.instances.list().into_iter().map(|i| state.paths.game_dir(&i.id)).filter(|d| overlay::pending(d)).collect();
    if pending.is_empty() {
        return;
    }
    let busy = busy_dirs();
    for dir in pending {
        if busy.iter().any(|b| b == &dir) {
            continue;
        }
        match overlay::restore(&dir) {
            Ok(_) => tracing::info!("AFK: Spieleinstellungen nach Absturz wiederhergestellt: {}", dir.display()),
            Err(e) => tracing::warn!("AFK: Wiederherstellung fehlgeschlagen ({}): {e}", dir.display()),
        }
    }
}

pub fn init(app: &AppHandle) {
    let _ = APP.set(app.clone());
    if let Some(state) = app.try_state::<AppState>() {
        let st = state.inner().clone();
        tauri::async_runtime::spawn_blocking(move || {
            crate::minecraft::resume::on_startup(&st);
            recover(&st);
        });
    }
    let h = app.clone();
    std::thread::Builder::new()
        .name("afk-poll".into())
        .spawn(move || loop {
            std::thread::sleep(Duration::from_millis(1000));
            if !registry::any() {
                continue;
            }
            if let Some(state) = h.try_state::<AppState>() {
                poll(&state);
            }
        })
        .ok();
}

#[cfg(test)]
mod tests;
