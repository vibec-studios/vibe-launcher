use super::files::{self, AfkEvent, Mode};
use super::registry::{self, AgentState, Run, Snapshot};
use super::{logscan, notify, overlay, window};
use crate::error::{AppError, AppResult};
use crate::minecraft::logs::Parsed;
use crate::minecraft::{LogLevel, RunState};
use crate::state::AppState;
use std::time::Duration;
use tauri::{AppHandle, Manager};

pub const SESSION_EVENT: &str = "afk://session";
pub const EVENT_EVENT: &str = "afk://event";
const AGENT_TIMEOUT_MS: i64 = 30_000;
const AGENT_GRACE_MS: i64 = 5_000;

#[derive(serde::Serialize, Clone)]
struct EventPayload<'a> {
    run_id: &'a str,
    instance_id: &'a str,
    event: &'a AfkEvent,
}

fn emit_snapshot(app: &AppHandle, s: &Snapshot) {
    crate::events::emit(app, SESSION_EVENT, s);
}

fn notify_text(state: &AppState, run: &Run, ev: &AfkEvent) -> (String, String) {
    let en = !state.settings().language.starts_with("de");
    let name = state.instances.get(&run.instance_id).map(|i| i.name).unwrap_or_else(|_| run.instance_id.clone());
    let detail = ev.str("message").or(ev.str("reason")).or(ev.str("text")).unwrap_or_default().to_string();
    let title = match (ev.kind.as_str(), en) {
        ("death", false) => format!("{name}: Du bist gestorben"),
        ("death", true) => format!("{name}: You died"),
        ("mention", false) => format!("{name}: Vermutlich wurdest du erwähnt"),
        ("mention", true) => format!("{name}: You were probably mentioned"),
        ("whisper", false) => format!("{name}: Vermutlich eine private Nachricht"),
        ("whisper", true) => format!("{name}: Probably a private message"),
        ("reconnect_gave_up", false) => format!("{name}: Neu verbinden aufgegeben"),
        ("reconnect_gave_up", true) => format!("{name}: Gave up reconnecting"),
        (_, false) => format!("{name}: Verbindung getrennt"),
        (_, true) => format!("{name}: Disconnected"),
    };
    (title, detail)
}

fn deliver(state: &AppState, run_id: &str, instance_id: &str, evs: Vec<AfkEvent>) {
    let enabled = state.settings().afk.notify;
    for ev in evs {
        crate::events::emit(&state.app, EVENT_EVENT, &EventPayload { run_id, instance_id, event: &ev });
        let toast = registry::with(|r| {
            let run = r.get_mut(run_id)?;
            run.should_notify(&ev, enabled).then(|| run.clone())
        });
        if let Some(run) = toast {
            let (title, body) = notify_text(state, &run, &ev);
            notify::toast(&state.app, &title, &body);
        }
    }
}

pub fn observe_log(run_id: &str, lines: &[Parsed]) {
    if !registry::any() || !lines.iter().any(|l| l.text.contains("[CHAT]") || l.text.contains("isconnect") || l.text.contains("ost connection")) {
        return;
    }
    let now = crate::util::now_ms();
    let found = registry::with(|r| {
        let run = r.get_mut(run_id).filter(|x| x.accepts_log())?;
        let words: Vec<String> = run.player.iter().cloned().collect();
        let own = run.player.clone();
        let evs: Vec<AfkEvent> = lines
            .iter()
            .filter(|l| l.level != LogLevel::Launcher)
            .flat_map(|l| logscan::scan(&l.text, own.as_deref(), &words, now))
            .map(|e| e.with("fallback", true))
            .collect();
        let kept: Vec<AfkEvent> = evs.into_iter().filter_map(|e| run.apply(e)).collect();
        (!kept.is_empty()).then(|| (run.instance_id.clone(), kept))
    });
    if let Some((iid, evs)) = found {
        let run = run_id.to_string();
        tauri::async_runtime::spawn(async move {
            if let Some(app) = APP.get() {
                if let Some(state) = app.try_state::<AppState>() {
                    deliver(&state, &run, &iid, evs);
                }
            }
        });
    }
}

static APP: std::sync::OnceLock<AppHandle> = std::sync::OnceLock::new();

fn write_mode(run: &mut Run, pid: Option<u32>, now: i64) {
    if !run.files {
        return;
    }
    if run.mode == Mode::Foreground {
        if let Some(pid) = pid {
            window::allow_foreground(pid);
        }
    }
    if let Some(f) = run.file.as_mut() {
        f.mode = run.mode;
        f.updated_at = now;
        if let Err(e) = files::write_afk(&run.game_dir.join(".vibe"), f) {
            tracing::warn!("AFK: afk.json nicht geschrieben: {e}");
        }
    }
}

fn hide_now(run: &mut Run, pid: u32, now: i64) {
    let wins: Vec<isize> = window::find_game_windows(pid).into_iter().filter(|h| window::visible(*h)).collect();
    if wins.is_empty() {
        return;
    }
    let seen = *run.window_seen_at.get_or_insert(now);
    if run.agent == AgentState::Pending && now - seen < AGENT_GRACE_MS {
        return;
    }
    for h in wins {
        if window::hide(h) && !run.hidden.contains(&h) {
            run.hidden.push(h);
        }
    }
    if !run.hidden.is_empty() {
        run.window = Some("system");
    }
}

fn show_now(run: &mut Run, pid: Option<u32>) {
    let mut shown = false;
    for h in run.hidden.drain(..) {
        if window::alive(h) {
            shown |= window::show(h);
        }
    }
    if !shown {
        if let Some(pid) = pid {
            if let Some(h) = window::find_game_windows(pid).into_iter().next() {
                window::show(h);
            }
        }
    }
}

fn tick_run(run: &mut Run, state: RunState, pid: Option<u32>, started_at: Option<i64>, now: i64) -> Vec<AfkEvent> {
    if state == RunState::Stopped {
        if !run.ended {
            run.ended = true;
            run.hidden.clear();
        }
        return Vec::new();
    }
    let mut out = Vec::new();
    if run.files {
        let dir = run.vibe_dir();
        let mut cur = run.cursor;
        let evs = files::read_events(&dir, &mut cur);
        run.cursor = cur;
        out.extend(evs.into_iter().filter_map(|e| run.apply(e)));
        if let Some(st) = files::read_state(&dir) {
            run.apply_state(&st, now);
        }
    }
    if run.agent == AgentState::Pending && started_at.is_some_and(|s| now - s > AGENT_TIMEOUT_MS) {
        run.agent = AgentState::Missing;
    }
    let Some(pid) = pid.filter(|_| state == RunState::Running) else { return out };
    if !window::SUPPORTED {
        return out;
    }
    match run.mode {
        Mode::Background if !run.agent_handles_window(now) => hide_now(run, pid, now),
        Mode::Foreground if !run.fg_checked && now - run.mode_at > 2_000 => {
            run.fg_checked = true;
            let wins = window::find_game_windows(pid);
            match wins.iter().find(|h| window::visible(**h)) {
                Some(h) => window::focus(*h),
                None => {
                    if let Some(h) = wins.first() {
                        window::show(*h);
                    }
                }
            }
        }
        _ => {}
    }
    out
}

fn poll(state: &AppState) {
    let now = crate::util::now_ms();
    let states = state.game.states();
    let mut batches = Vec::new();
    let snaps = registry::with(|r| {
        r.retain(|id, _| states.iter().any(|g| &g.run_id == id));
        let mut snaps = Vec::new();
        for run in r.values_mut() {
            let Some(g) = states.iter().find(|g| g.run_id == run.run_id) else { continue };
            let evs = tick_run(run, g.state, g.pid, g.started_at, now);
            if !evs.is_empty() {
                batches.push((run.run_id.clone(), run.instance_id.clone(), evs));
            }
            if let Some(s) = run.changed() {
                snaps.push(s);
            }
        }
        snaps
    });
    for s in &snaps {
        emit_snapshot(&state.app, s);
    }
    for (run, iid, evs) in batches {
        deliver(state, &run, &iid, evs);
    }
}

fn track_untracked(state: &AppState, run_id: &str) -> AppResult<()> {
    if registry::with(|r| r.contains_key(run_id)) {
        return Ok(());
    }
    let g = state.game.state_of(run_id).filter(|g| g.state == RunState::Running).ok_or_else(|| AppError::Invalid("Diese Sitzung läuft nicht.".into()))?;
    let mut run = Run::new(run_id, &g.instance_id, state.paths.game_dir(&g.instance_id), Mode::Foreground, crate::util::now_ms());
    run.requested = false;
    run.player = g.account_name.clone();
    let words: Vec<String> = run.player.iter().cloned().collect();
    let log = state.game.session_log(run_id);
    let start = log.len().saturating_sub(400);
    for l in &log[start..] {
        for ev in logscan::scan(&l.text, run.player.as_deref(), &words, crate::util::now_ms()) {
            if ev.kind == "chat" {
                run.apply(ev.with("fallback", true));
            }
        }
    }
    registry::with(|r| r.insert(run_id.to_string(), run));
    Ok(())
}

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
        tauri::async_runtime::spawn_blocking(move || recover(&st));
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
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn stopped_runs_end_once() {
        let mut r = Run::new("run-1", "i", PathBuf::from("nowhere"), Mode::Background, 0);
        r.hidden.push(1);
        assert!(tick_run(&mut r, RunState::Stopped, None, None, 10).is_empty());
        assert!(r.ended);
        assert!(r.hidden.is_empty());
    }

    #[test]
    fn pending_agent_times_out() {
        let mut r = Run::new("run-1", "i", PathBuf::from("nowhere"), Mode::Foreground, 0);
        r.agent = AgentState::Pending;
        tick_run(&mut r, RunState::Running, None, Some(0), 10_000);
        assert_eq!(r.agent, AgentState::Pending);
        tick_run(&mut r, RunState::Running, None, Some(0), AGENT_TIMEOUT_MS + 1);
        assert_eq!(r.agent, AgentState::Missing);
    }

    #[test]
    fn events_from_file_are_applied() {
        let dir = crate::util::testdir::TestDir::new("afk-rt");
        let vibe = dir.path().join(".vibe");
        std::fs::create_dir_all(&vibe).unwrap();
        let lines = [
            r#"{"seq":1,"ts":1,"type":"agent_start","run":1,"agent_version":"0.1.0"}"#,
            r#"{"seq":2,"ts":2,"type":"capabilities","send":true}"#,
            r#"{"seq":3,"ts":3,"type":"death","message":"x"}"#,
        ];
        std::fs::write(vibe.join(files::EVENTS_FILE), lines.join("\n") + "\n").unwrap();
        let mut r = Run::new("run-1", "i", dir.path().to_path_buf(), Mode::Background, 0);
        r.files = true;
        let evs = tick_run(&mut r, RunState::Preparing, None, None, 5);
        assert_eq!(evs.len(), 2);
        assert_eq!(r.agent, AgentState::Active);
        assert!(r.can_send());
        assert!(tick_run(&mut r, RunState::Preparing, None, None, 6).is_empty());
    }
}
