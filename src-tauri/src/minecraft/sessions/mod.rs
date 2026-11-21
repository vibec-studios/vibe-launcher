use super::logs::Parsed;
use super::{GameState, LogLine, RunState};
use std::collections::{HashMap, HashSet, VecDeque};

pub const MAX_LINES: usize = 50_000;
const KEEP_STOPPED_PER_INSTANCE: usize = 3;
const KEEP_STOPPED_TOTAL: usize = 8;

pub struct Session {
    pub state: GameState,
    pub log: VecDeque<LogLine>,
    pub seq: u64,
    pub pending: Vec<LogLine>,
    pub killed: bool,
    pub task_id: Option<String>,
    pub secret: Option<String>,
    pub spark_report: Option<String>,
    order: u64,
}

pub struct LogBatch {
    pub run_id: String,
    pub instance_id: String,
    pub lines: Vec<LogLine>,
}

#[derive(Default)]
pub struct Registry {
    map: HashMap<String, Session>,
    next: u64,
    clocks: HashMap<String, i64>,
    claimed: HashSet<String>,
}

pub struct BeginOpts<'a> {
    pub exclusive: bool,
    pub world: Option<&'a str>,
    pub server: Option<&'a str>,
}

fn active(s: &Session) -> bool {
    s.state.state != RunState::Stopped
}

impl Registry {
    pub fn begin(&mut self, instance_id: &str, opts: BeginOpts<'_>, now: i64) -> Result<GameState, String> {
        if opts.exclusive && self.is_active(instance_id) {
            return Err("Die Instanz läuft bereits oder wird gerade gestartet.".into());
        }
        if let Some(w) = opts.world {
            if let Some(slot) = self.world_in_use(instance_id, w) {
                return Err(format!("Die Welt „{w}“ ist bereits in Sitzung #{slot} geöffnet."));
            }
        }
        self.next += 1;
        let run_id = format!("run-{}", self.next);
        let slot = self.free_slot(instance_id);
        self.map.retain(|_, s| !(s.state.instance_id == instance_id && !active(s)));
        let st = GameState {
            run_id: run_id.clone(),
            instance_id: instance_id.to_string(),
            slot,
            state: RunState::Preparing,
            pid: None,
            created_at: now,
            started_at: None,
            ended_at: None,
            exit_code: None,
            crashed: false,
            crash_report: None,
            account_name: None,
            account_uuid: None,
            world: opts.world.map(str::to_string),
            server: opts.server.map(str::to_string),
            resumed: None,
        };
        self.map.insert(
            run_id,
            Session { state: st.clone(), log: VecDeque::new(), seq: 0, pending: Vec::new(), killed: false, task_id: None, secret: None, spark_report: None, order: self.next },
        );
        Ok(st)
    }

    fn free_slot(&self, instance_id: &str) -> u32 {
        let used: HashSet<u32> = self.map.values().filter(|s| s.state.instance_id == instance_id && active(s)).map(|s| s.state.slot).collect();
        (1..).find(|n| !used.contains(n)).unwrap_or(1)
    }

    pub fn resolve(&self, key: &str) -> Option<String> {
        if self.map.contains_key(key) {
            return Some(key.to_string());
        }
        self.map
            .iter()
            .filter(|(_, s)| s.state.instance_id == key)
            .max_by_key(|(_, s)| (active(s), s.order))
            .map(|(k, _)| k.clone())
    }

    pub fn get(&self, key: &str) -> Option<&Session> {
        let id = self.resolve(key)?;
        self.map.get(&id)
    }

    pub fn get_mut(&mut self, key: &str) -> Option<&mut Session> {
        let id = self.resolve(key)?;
        self.map.get_mut(&id)
    }

    pub fn is_run(&self, key: &str) -> bool {
        self.map.contains_key(key)
    }

    pub fn active_runs(&self, instance_id: &str) -> Vec<String> {
        let mut v: Vec<&Session> = self.map.values().filter(|s| s.state.instance_id == instance_id && active(s)).collect();
        v.sort_by_key(|s| s.order);
        v.into_iter().map(|s| s.state.run_id.clone()).collect()
    }

    pub fn is_active(&self, instance_id: &str) -> bool {
        self.map.values().any(|s| s.state.instance_id == instance_id && active(s))
    }

    pub fn is_process_running(&self, instance_id: &str) -> bool {
        self.map.values().any(|s| s.state.instance_id == instance_id && s.state.state == RunState::Running)
    }

    pub fn others_active(&self, instance_id: &str, run_id: &str) -> usize {
        self.map.values().filter(|s| s.state.instance_id == instance_id && s.state.run_id != run_id && active(s)).count()
    }

    pub fn running_count(&self) -> usize {
        self.map.values().filter(|s| active(s)).count()
    }

    pub fn any_running(&self) -> bool {
        self.map.values().any(|s| s.state.state == RunState::Running)
    }

    pub fn states(&self) -> Vec<GameState> {
        let mut v: Vec<&Session> = self.map.values().collect();
        v.sort_by_key(|s| s.order);
        v.into_iter().map(|s| s.state.clone()).collect()
    }

    pub fn latest_crash(&self, instance_id: &str) -> Option<GameState> {
        self.map
            .values()
            .filter(|s| s.state.instance_id == instance_id && s.state.crashed && !active(s))
            .max_by_key(|s| s.order)
            .map(|s| s.state.clone())
    }

    pub fn world_in_use(&self, instance_id: &str, world: &str) -> Option<u32> {
        self.map
            .values()
            .find(|s| s.state.instance_id == instance_id && active(s) && s.state.world.as_deref() == Some(world))
            .map(|s| s.state.slot)
    }

    pub fn account_in_use(&self, uuid: &str, except_run: &str) -> Option<GameState> {
        let want = uuid.replace('-', "").to_ascii_lowercase();
        self.map
            .values()
            .filter(|s| s.state.run_id != except_run && active(s))
            .find(|s| s.state.account_uuid.as_deref().is_some_and(|u| u.replace('-', "").to_ascii_lowercase() == want))
            .map(|s| s.state.clone())
    }

    pub fn had_concurrent(&self, run_id: &str) -> bool {
        let Some(me) = self.map.get(run_id) else { return false };
        let Some(start) = me.state.started_at else { return false };
        self.map.values().any(|s| {
            s.state.run_id != run_id
                && s.state.instance_id == me.state.instance_id
                && s.state.started_at.is_some()
                && (active(s) || s.state.ended_at.is_some_and(|e| e >= start))
        })
    }

    pub fn mark_running(&mut self, key: &str, pid: Option<u32>, started_ms: i64) -> Option<GameState> {
        let s = self.get_mut(key)?;
        s.state.state = RunState::Running;
        s.state.pid = pid;
        s.state.started_at = Some(started_ms);
        let st = s.state.clone();
        self.clocks.entry(st.instance_id.clone()).or_insert(started_ms);
        Some(st)
    }

    pub fn mark_stopped(&mut self, key: &str, now: i64, f: impl FnOnce(&mut GameState)) -> Option<GameState> {
        let s = self.get_mut(key)?;
        s.state.state = RunState::Stopped;
        s.state.ended_at = Some(now);
        f(&mut s.state);
        let st = s.state.clone();
        self.prune();
        Some(st)
    }

    pub fn clock_stop(&mut self, instance_id: &str, now: i64) -> Option<u64> {
        if self.is_process_running(instance_id) {
            return None;
        }
        self.clocks.remove(instance_id).map(|start| ((now - start).max(0) / 1000) as u64)
    }

    pub fn claim_report(&mut self, path: &str) -> bool {
        self.claimed.insert(path.to_string())
    }

    pub fn push(&mut self, key: &str, lines: Vec<Parsed>) {
        let Some(s) = self.get_mut(key) else { return };
        for p in lines {
            s.seq += 1;
            let text = match &s.secret {
                Some(t) if p.text.contains(t.as_str()) => p.text.replace(t.as_str(), "••••••"),
                _ => p.text,
            };
            if let Some(url) = super::resources::spark_report(&text) {
                s.spark_report = Some(url);
            }
            let l = LogLine { seq: s.seq, time: p.time, level: p.level, thread: p.thread, logger: p.logger, text };
            if s.log.len() >= MAX_LINES {
                s.log.pop_front();
            }
            s.log.push_back(l.clone());
            s.pending.push(l);
        }
    }

    pub fn take_pending(&mut self) -> Vec<LogBatch> {
        self.map
            .values_mut()
            .filter(|s| !s.pending.is_empty())
            .map(|s| LogBatch { run_id: s.state.run_id.clone(), instance_id: s.state.instance_id.clone(), lines: std::mem::take(&mut s.pending) })
            .collect()
    }

    fn prune(&mut self) {
        let mut stopped: Vec<(u64, String, String)> =
            self.map.values().filter(|s| !active(s) && s.pending.is_empty()).map(|s| (s.order, s.state.run_id.clone(), s.state.instance_id.clone())).collect();
        stopped.sort_by(|a, b| b.0.cmp(&a.0));
        let mut per: HashMap<String, usize> = HashMap::new();
        let mut kept = 0;
        for (_, run, inst) in stopped {
            let n = per.entry(inst).or_default();
            *n += 1;
            if *n > KEEP_STOPPED_PER_INSTANCE || kept >= KEEP_STOPPED_TOTAL {
                self.map.remove(&run);
            } else {
                kept += 1;
            }
        }
    }
}

pub fn rewrite_log_config(xml: &str, slot: u32) -> Option<String> {
    if slot <= 1 || !xml.contains("logs/") {
        return None;
    }
    let dir = format!("logs/vibe-session-{slot}/");
    let out = xml.replace("fileName=\"logs/", &format!("fileName=\"{dir}")).replace("filePattern=\"logs/", &format!("filePattern=\"{dir}"));
    (out != xml).then_some(out)
}

mod adopt;

#[cfg(test)]
mod tests;
