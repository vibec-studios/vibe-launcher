use super::*;
use crate::minecraft::sessions::{BeginOpts, Registry};

fn rec(run: &str, pid: u32, start: u64, dir: &str) -> Record {
    Record {
        run_id: run.into(),
        instance_id: "inst".into(),
        slot: 1,
        pid,
        start_secs: start,
        started_at: (start as i64) * 1000,
        game_dir: PathBuf::from(dir),
        log_path: log_path(Path::new(dir), 1),
        account_name: Some("Steve".into()),
        account_uuid: None,
        world: None,
        server: None,
        afk: None,
        external: false,
    }
}

fn proc(pid: u32, start: u64, cmd: &[&str]) -> ProcInfo {
    ProcInfo { pid, start_secs: start, name: "java.exe".into(), cmd: cmd.iter().map(|s| s.to_string()).collect(), cwd: None }
}

#[test]
fn store_roundtrip_upsert_and_remove() {
    let root = std::env::temp_dir().join(format!("vl-resume-{}", std::process::id()));
    std::fs::create_dir_all(&root).unwrap();
    store::replace(&root, vec![]);
    assert!(store::load(&root).is_empty());
    let mut a = rec("run-1", 10, 100, "/g/a");
    a.afk = Some(AfkRecord { background: true, agent: true, files: true, ..Default::default() });
    store::upsert(&root, a.clone());
    store::upsert(&root, rec("run-2", 11, 100, "/g/b"));
    store::upsert(&root, rec("run-3", 10, 200, "/g/a"));
    let l = store::load(&root);
    assert_eq!(l.iter().map(|r| r.run_id.as_str()).collect::<Vec<_>>(), vec!["run-2", "run-3"]);
    store::remove(&root, "run-2");
    store::remove(&root, "run-3");
    assert!(!store::path(&root).exists());
    store::upsert(&root, a.clone());
    assert_eq!(store::load(&root), vec![a]);
    std::fs::write(store::path(&root), "kaputt").unwrap();
    assert!(store::load(&root).is_empty());
    std::fs::remove_dir_all(&root).ok();
}

#[test]
fn matches_requires_same_pid_start_and_game_dir() {
    let r = rec("run-1", 10, 100, "/g/a");
    assert!(matches(&r, &[proc(10, 100, &["java", "--gameDir", "/g/a"])]).is_some());
    assert!(matches(&r, &[proc(10, 500, &["java", "--gameDir", "/g/a"])]).is_none());
    assert!(matches(&r, &[proc(10, 100, &["java", "--gameDir", "/g/b"])]).is_none());
    assert!(matches(&r, &[proc(11, 100, &["java", "--gameDir", "/g/a"])]).is_none());
}

#[test]
fn external_finds_untracked_games_in_instance_dirs() {
    let dirs = vec![("a".to_string(), PathBuf::from("/g/a")), ("b".to_string(), PathBuf::from("/g/b"))];
    let procs = vec![
        proc(10, 1, &["java", "--gameDir", "/g/a"]),
        proc(11, 1, &["java", "--gameDir", "/g/b", "--username", "Alex", "--uuid", "12-34"]),
        proc(12, 1, &["java", "--gameDir", "/elsewhere"]),
        proc(13, 1, &["java", "-jar", "server.jar"]),
    ];
    let found = external(&procs, &[10], &dirs);
    assert_eq!(found.len(), 1);
    assert_eq!(found[0].0, "b");
    let r = external_record("b", PathBuf::from("/g/b"), &found[0].1);
    assert!(r.external);
    assert_eq!(r.account_name.as_deref(), Some("Alex"));
    assert_eq!(r.account_uuid.as_deref(), Some("1234"));
    assert_eq!(r.started_at, 1000);
    assert!(r.run_id.is_empty());
}

#[test]
fn log_path_follows_session_slot() {
    let g = Path::new("/g/a");
    assert_eq!(log_path(g, 1), g.join("logs").join("latest.log"));
    assert_eq!(log_path(g, 2), g.join("logs").join("vibe-session-2").join("latest.log"));
}

#[test]
fn registry_adopt_keeps_ids_and_avoids_collisions() {
    let mut reg = Registry::default();
    let st = reg.adopt(to_state(&rec("run-7", 10, 100, "/g/a")));
    assert_eq!(st.run_id, "run-7");
    assert_eq!(st.state, RunState::Running);
    assert_eq!(st.resumed.as_deref(), Some("saved"));
    assert!(reg.is_process_running("inst"));
    let next = reg.begin("inst", BeginOpts { exclusive: false, world: None, server: None }, 0).unwrap();
    assert_eq!(next.run_id, "run-9");
    assert_eq!(next.slot, 2);
    let mut ext = rec("", 11, 100, "/g/a");
    ext.external = true;
    let e = reg.adopt(to_state(&ext));
    assert!(e.run_id.starts_with("run-") && e.run_id != "run-7" && e.run_id != "run-9");
    assert_eq!(e.slot, 3);
    assert_eq!(e.resumed.as_deref(), Some("external"));
    let dup = reg.adopt(to_state(&rec("run-7", 12, 100, "/g/a")));
    assert_ne!(dup.run_id, "run-7");
    reg.mark_stopped("run-7", 200_000, |_| {});
    reg.mark_stopped(&next.run_id, 200_000, |_| {});
    reg.mark_stopped(&e.run_id, 200_000, |_| {});
    reg.mark_stopped(&dup.run_id, 200_000, |_| {});
    assert_eq!(reg.clock_stop("inst", 200_000), Some(100));
}

#[test]
fn afk_restore_skips_old_events_and_keeps_background() {
    let dir = std::env::temp_dir().join(format!("vl-resume-afk-{}", std::process::id()));
    let vibe = dir.join(".vibe");
    std::fs::create_dir_all(&vibe).unwrap();
    std::fs::write(vibe.join(crate::afk::files::EVENTS_FILE), "{\"ts\":1,\"kind\":\"death\"}\n").unwrap();
    let afk = AfkRecord { background: true, requested: true, agent: true, overlay: true, files: true, agent_version: None };
    let run = crate::afk::resume::restore_run("run-1", "inst", &dir, &afk, 5);
    assert_eq!(run.mode, crate::afk::files::Mode::Background);
    assert!(run.overlay && run.requested && run.fg_checked);
    assert!(!run.files);
    assert!(run.cursor.offset > 0);
    std::fs::remove_dir_all(&dir).ok();
}
