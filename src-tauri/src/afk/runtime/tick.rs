use super::*;

pub(super) fn write_mode(run: &mut Run, pid: Option<u32>, now: i64) {
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

pub(super) fn hide_now(run: &mut Run, pid: u32, now: i64) {
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

pub(super) fn show_now(run: &mut Run, pid: Option<u32>) {
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

pub(super) fn tick_run(run: &mut Run, state: RunState, pid: Option<u32>, started_at: Option<i64>, now: i64) -> Vec<AfkEvent> {
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

pub(super) fn poll(state: &AppState) {
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

pub(super) fn track_untracked(state: &AppState, run_id: &str) -> AppResult<()> {
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
