//! Laufende Java-Prozesse nach einem Launcher-Neustart wiedererkennen und weiter beobachten.
use std::path::{Path, PathBuf};
use sysinfo::{Pid, ProcessRefreshKind, ProcessesToUpdate, System, UpdateKind};

mod tail;
mod wait;

pub use tail::{follow, Follow};
pub use wait::wait_exit;

pub const START_TOLERANCE_SECS: u64 = 2;

#[derive(Debug, Clone, PartialEq)]
pub struct ProcInfo {
    pub pid: u32,
    pub start_secs: u64,
    pub name: String,
    pub cmd: Vec<String>,
    pub cwd: Option<PathBuf>,
}

fn refresh_kind() -> ProcessRefreshKind {
    ProcessRefreshKind::nothing().with_cmd(UpdateKind::Always).with_cwd(UpdateKind::Always)
}

fn to_info(pid: Pid, p: &sysinfo::Process) -> ProcInfo {
    ProcInfo {
        pid: pid.as_u32(),
        start_secs: p.start_time(),
        name: p.name().to_string_lossy().to_string(),
        cmd: p.cmd().iter().map(|a| a.to_string_lossy().to_string()).collect(),
        cwd: p.cwd().map(Path::to_path_buf),
    }
}

pub fn info(pid: u32) -> Option<ProcInfo> {
    let mut sys = System::new();
    let p = Pid::from_u32(pid);
    sys.refresh_processes_specifics(ProcessesToUpdate::Some(&[p]), true, refresh_kind());
    sys.process(p).map(|x| to_info(p, x))
}

pub fn alive(pid: u32, start_secs: u64) -> bool {
    let mut sys = System::new();
    let p = Pid::from_u32(pid);
    sys.refresh_processes_specifics(ProcessesToUpdate::Some(&[p]), true, ProcessRefreshKind::nothing());
    sys.process(p).is_some_and(|x| start_matches(start_secs, x.start_time()))
}

pub fn java_processes() -> Vec<ProcInfo> {
    let mut sys = System::new();
    sys.refresh_processes_specifics(ProcessesToUpdate::All, true, refresh_kind());
    sys.processes().iter().map(|(pid, p)| to_info(*pid, p)).filter(is_java).collect()
}

pub fn is_java(p: &ProcInfo) -> bool {
    p.name.to_ascii_lowercase().starts_with("java")
}

pub fn start_matches(expected: u64, actual: u64) -> bool {
    expected.abs_diff(actual) <= START_TOLERANCE_SECS
}

pub fn arg_value<'a>(cmd: &'a [String], flag: &str) -> Option<&'a str> {
    let eq = format!("{flag}=");
    cmd.iter().enumerate().find_map(|(i, a)| if a == flag { cmd.get(i + 1).map(String::as_str) } else { a.strip_prefix(eq.as_str()) })
}

pub fn normalize(p: &Path) -> String {
    let s = p.to_string_lossy().replace('\\', "/");
    let s = s.strip_prefix("//?/").unwrap_or(&s).trim_end_matches('/').to_string();
    if cfg!(windows) {
        s.to_ascii_lowercase()
    } else {
        s
    }
}

pub fn same_path(a: &Path, b: &Path) -> bool {
    normalize(a) == normalize(b)
}

pub fn game_dir_of(p: &ProcInfo) -> Option<PathBuf> {
    arg_value(&p.cmd, "--gameDir").map(PathBuf::from).or_else(|| p.cwd.clone())
}

pub fn runs_in(p: &ProcInfo, dir: &Path) -> bool {
    arg_value(&p.cmd, "--gameDir").is_some_and(|g| same_path(Path::new(g), dir)) || p.cwd.as_deref().is_some_and(|c| same_path(c, dir))
}

pub fn is_same(p: &ProcInfo, start_secs: u64, dir: &Path) -> bool {
    is_java(p) && start_matches(start_secs, p.start_secs) && (p.cmd.is_empty() || runs_in(p, dir))
}

#[cfg(test)]
mod tests;
