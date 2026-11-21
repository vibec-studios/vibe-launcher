use super::files::{self, Cursor, Mode};
use super::registry::{self, AgentState, Run};
use super::window;
use crate::minecraft::resume::AfkRecord;
use crate::state::AppState;
use std::path::Path;

pub fn snapshot(run_id: &str) -> Option<AfkRecord> {
    registry::with(|r| {
        r.get(run_id).map(|x| AfkRecord {
            background: x.mode == Mode::Background,
            requested: x.requested,
            agent: x.agent != AgentState::Missing || x.agent_version.is_some(),
            agent_version: x.agent_version.clone(),
            overlay: x.overlay,
            files: x.files,
        })
    })
}

pub fn restore_run(run_id: &str, instance_id: &str, game_dir: &Path, afk: &AfkRecord, now: i64) -> Run {
    let vibe = game_dir.join(".vibe");
    let file = if afk.files { files::read_afk(&vibe).filter(|f| f.session == run_id) } else { None };
    let background = file.as_ref().map(|f| f.mode == Mode::Background).unwrap_or(afk.background);
    let mut run = Run::new(run_id, instance_id, game_dir.to_path_buf(), if background { Mode::Background } else { Mode::Foreground }, now);
    run.requested = afk.requested || background;
    run.files = file.is_some();
    run.file = file;
    run.overlay = afk.overlay;
    run.agent = if afk.agent { AgentState::Pending } else { AgentState::Missing };
    run.agent_version = afk.agent_version.clone();
    run.fg_checked = true;
    let len = std::fs::metadata(files::path(&vibe, files::EVENTS_FILE)).map(|m| m.len()).unwrap_or(0);
    run.cursor = Cursor { offset: len, last_seq: 0 };
    run
}

pub fn adopt(state: &AppState, run_id: &str, instance_id: &str, game_dir: &Path, afk: &AfkRecord) {
    let mut run = restore_run(run_id, instance_id, game_dir, afk, crate::util::now_ms());
    run.player = state.game.state_of(run_id).and_then(|g| g.account_name);
    if run.mode == Mode::Background && window::SUPPORTED {
        if let Some(pid) = state.game.state_of(run_id).and_then(|g| g.pid) {
            let wins = window::find_game_windows(pid);
            if !wins.is_empty() && !wins.iter().any(|h| window::visible(*h)) {
                run.hidden = wins;
                run.window = Some("system");
            }
        }
    }
    registry::with(|r| r.insert(run_id.to_string(), run));
}
