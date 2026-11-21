//! Laufende Spiele überleben einen Launcher-Neustart: Kenndaten speichern, beim Start wiedererkennen und übernehmen.
use super::{GameState, RunState};
use crate::state::AppState;
use std::path::{Path, PathBuf};
use vibe_server_core::minecraft::adopt::{self, ProcInfo};

pub mod store;

pub use store::{AfkRecord, Record};

pub fn log_path(game_dir: &Path, slot: u32) -> PathBuf {
    if slot > 1 {
        game_dir.join("logs").join(format!("vibe-session-{slot}")).join("latest.log")
    } else {
        game_dir.join("logs").join("latest.log")
    }
}

pub fn record(state: &AppState, run_id: &str, pid: Option<u32>) {
    let (Some(pid), Some(g)) = (pid, state.game.state_of(run_id)) else { return };
    let Some(info) = adopt::info(pid) else { return };
    let game_dir = state.paths.game_dir(&g.instance_id);
    let rec = Record {
        run_id: g.run_id.clone(),
        instance_id: g.instance_id.clone(),
        slot: g.slot,
        pid,
        start_secs: info.start_secs,
        started_at: g.started_at.unwrap_or_else(crate::util::now_ms),
        log_path: log_path(&game_dir, g.slot),
        game_dir,
        account_name: g.account_name,
        account_uuid: g.account_uuid,
        world: g.world,
        server: g.server,
        afk: crate::afk::resume::snapshot(run_id),
        external: false,
    };
    store::upsert(&state.paths.root, rec);
}

pub fn forget(state: &AppState, run_id: &str) {
    store::remove(&state.paths.root, run_id);
}

pub fn refresh_afk(state: &AppState, run_id: &str) {
    let afk = crate::afk::resume::snapshot(run_id);
    store::update(&state.paths.root, |l| {
        if let Some(r) = l.iter_mut().find(|r| r.run_id == run_id) {
            r.afk = afk;
        }
    });
}

pub fn matches(rec: &Record, procs: &[ProcInfo]) -> Option<ProcInfo> {
    procs.iter().find(|p| p.pid == rec.pid && adopt::is_same(p, rec.start_secs, &rec.game_dir)).cloned()
}

pub fn external(procs: &[ProcInfo], taken: &[u32], dirs: &[(String, PathBuf)]) -> Vec<(String, ProcInfo)> {
    procs
        .iter()
        .filter(|p| !taken.contains(&p.pid))
        .filter_map(|p| {
            let g = adopt::arg_value(&p.cmd, "--gameDir")?;
            let (id, _) = dirs.iter().find(|(_, d)| adopt::same_path(Path::new(g), d))?;
            Some((id.clone(), p.clone()))
        })
        .collect()
}

fn to_state(rec: &Record) -> GameState {
    GameState {
        run_id: rec.run_id.clone(),
        instance_id: rec.instance_id.clone(),
        slot: rec.slot,
        state: RunState::Running,
        pid: Some(rec.pid),
        created_at: rec.started_at,
        started_at: Some(rec.started_at),
        ended_at: None,
        exit_code: None,
        crashed: false,
        crash_report: None,
        account_name: rec.account_name.clone(),
        account_uuid: rec.account_uuid.clone(),
        world: rec.world.clone(),
        server: rec.server.clone(),
        resumed: Some(if rec.external { "external" } else { "saved" }.into()),
    }
}

pub fn external_record(instance_id: &str, game_dir: PathBuf, p: &ProcInfo) -> Record {
    Record {
        run_id: String::new(),
        instance_id: instance_id.to_string(),
        slot: 1,
        pid: p.pid,
        start_secs: p.start_secs,
        started_at: (p.start_secs as i64) * 1000,
        log_path: log_path(&game_dir, 1),
        game_dir,
        account_name: adopt::arg_value(&p.cmd, "--username").map(str::to_string),
        account_uuid: adopt::arg_value(&p.cmd, "--uuid").map(|u| u.replace('-', "")),
        world: adopt::arg_value(&p.cmd, "--quickPlaySingleplayer").map(str::to_string),
        server: adopt::arg_value(&p.cmd, "--quickPlayMultiplayer").map(str::to_string),
        afk: None,
        external: true,
    }
}

fn adopt_one(state: &AppState, mut rec: Record) -> Record {
    let st = state.game.adopt_running(state.clone(), to_state(&rec), rec.start_secs, rec.log_path.clone());
    rec.run_id = st.run_id.clone();
    rec.slot = st.slot;
    if let Some(afk) = &rec.afk {
        crate::afk::resume::adopt(state, &rec.run_id, &rec.instance_id, &rec.game_dir, afk);
    }
    rec
}

pub fn on_startup(state: &AppState) {
    let saved = store::load(&state.paths.root);
    let procs = adopt::java_processes();
    let known: Vec<String> = state.instances.list().into_iter().map(|i| i.id).collect();
    let mut kept = Vec::new();
    for rec in saved {
        if !known.contains(&rec.instance_id) || matches(&rec, &procs).is_none() {
            continue;
        }
        kept.push(adopt_one(state, rec));
    }
    let taken: Vec<u32> = kept.iter().map(|r| r.pid).collect();
    let dirs: Vec<(String, PathBuf)> = known.iter().map(|id| (id.clone(), state.paths.game_dir(id))).collect();
    for (id, p) in external(&procs, &taken, &dirs) {
        let rec = external_record(&id, state.paths.game_dir(&id), &p);
        kept.push(adopt_one(state, rec));
    }
    if !kept.is_empty() {
        tracing::info!("{} laufende Spielsitzung(en) wiederaufgenommen", kept.len());
    }
    store::replace(&state.paths.root, kept);
}

#[cfg(test)]
mod tests;
