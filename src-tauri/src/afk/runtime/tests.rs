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
