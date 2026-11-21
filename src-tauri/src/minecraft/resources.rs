use super::process::GameManager;
use super::RunState;
use parking_lot::Mutex;
use serde::Serialize;
use std::collections::HashMap;
use std::sync::LazyLock;
use std::time::{Duration, Instant};
use sysinfo::{Pid, ProcessRefreshKind, ProcessesToUpdate, System};

#[derive(Serialize)]
pub struct RunResources {
    run_id: String,
    cpu_percent: Option<f32>,
    memory_bytes: Option<u64>,
    spark_report: Option<String>,
}

#[derive(Default)]
struct Sampler {
    system: System,
    active: HashMap<String, Pid>,
    last: Option<Instant>,
    cpu_ready: bool,
}

static SAMPLER: LazyLock<Mutex<Sampler>> = LazyLock::new(|| Mutex::new(Sampler::default()));

pub fn sample(game: &GameManager) -> Vec<RunResources> {
    let mut sampler = SAMPLER.lock();
    let runs = game.states();
    let active: HashMap<_, _> = runs.iter()
        .filter(|run| run.state == RunState::Running)
        .filter_map(|run| Some((run.run_id.clone(), Pid::from_u32(run.pid?))))
        .collect();
    let pids: Vec<_> = active.values().copied().collect();
    let now = Instant::now();
    let elapsed = sampler.last.map(|last| now.duration_since(last));
    if active != sampler.active || elapsed.is_some_and(|elapsed| elapsed > Duration::from_secs(10)) {
        *sampler = Sampler::default();
    }
    let mut cpu_ready = sampler.last.is_some();
    if !pids.is_empty() && sampler.last.is_none_or(|last| now.duration_since(last) >= sysinfo::MINIMUM_CPU_UPDATE_INTERVAL) {
        sampler.system.refresh_processes_specifics(
            ProcessesToUpdate::Some(&pids),
            true,
            ProcessRefreshKind::nothing().with_cpu().with_memory(),
        );
        sampler.last = Some(now);
        sampler.active = active.clone();
        sampler.cpu_ready = cpu_ready;
    } else {
        cpu_ready = sampler.cpu_ready;
    }

    let readings = runs.into_iter().filter(|run| run.state != RunState::Stopped).map(|run| {
        let process = active.get(&run.run_id).and_then(|&pid| sampler.system.process(pid));
        let cpu_percent = process.filter(|_| cpu_ready)
            .map(|p| p.cpu_usage()).filter(|v| v.is_finite());
        let memory_bytes = process.map(|p| p.memory());
        let spark_report = game.spark_report(&run.run_id);
        RunResources { run_id: run.run_id, cpu_percent, memory_bytes, spark_report }
    }).collect();
    readings
}

pub fn spark_report(text: &str) -> Option<String> {
    const PREFIX: &str = "https://spark.lucko.me/";
    static LINK: LazyLock<regex::Regex> = LazyLock::new(|| {
        regex::Regex::new(r"https://spark\.lucko\.me/[a-zA-Z0-9]{6,32}(?:$|[\s)>\]])").unwrap()
    });
    if !text.contains(PREFIX) {
        return None;
    }
    LINK.find(text).map(|m| {
        m.as_str().trim_end_matches(|c: char| !c.is_ascii_alphanumeric()).to_string()
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn spark_report_accepts_only_official_viewer_paths() {
        assert_eq!(spark_report("[CHAT] https://spark.lucko.me/AFseRpM7S7"), Some("https://spark.lucko.me/AFseRpM7S7".into()));
        assert!(spark_report("https://spark.lucko.me/docs/installation").is_none());
        assert!(spark_report("https://spark.lucko.me.example.org/AFseRpM7S7").is_none());
        assert!(spark_report("https://spark.lucko.me/AFseRpM7S7?url=https://example.org").is_none());
    }
}
