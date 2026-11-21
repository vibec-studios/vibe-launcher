use super::*;
use crate::minecraft::LogLevel;

fn opts() -> BeginOpts<'static> {
    BeginOpts { exclusive: false, world: None, server: None }
}

fn line(t: &str) -> Parsed {
    Parsed { time: None, level: LogLevel::Info, thread: None, logger: None, text: t.into() }
}

#[test]
fn same_instance_can_run_twice_with_own_slots() {
    let mut r = Registry::default();
    let a = r.begin("inst", opts(), 1).unwrap();
    let b = r.begin("inst", opts(), 2).unwrap();
    assert_ne!(a.run_id, b.run_id);
    assert_eq!((a.slot, b.slot), (1, 2));
    assert_eq!(r.active_runs("inst"), vec![a.run_id.clone(), b.run_id.clone()]);
    assert_eq!(r.running_count(), 2);
    assert_eq!(r.others_active("inst", &a.run_id), 1);
}

#[test]
fn exclusive_begin_is_refused_while_active() {
    let mut r = Registry::default();
    r.begin("bedrock", BeginOpts { exclusive: true, world: None, server: None }, 1).unwrap();
    assert!(r.begin("bedrock", BeginOpts { exclusive: true, world: None, server: None }, 2).is_err());
}

#[test]
fn instance_key_resolves_to_newest_active_session() {
    let mut r = Registry::default();
    let a = r.begin("inst", opts(), 1).unwrap();
    let b = r.begin("inst", opts(), 2).unwrap();
    assert_eq!(r.resolve("inst").as_deref(), Some(b.run_id.as_str()));
    r.mark_stopped(&b.run_id, 3, |_| {});
    assert_eq!(r.resolve("inst").as_deref(), Some(a.run_id.as_str()));
    assert_eq!(r.resolve(&b.run_id).as_deref(), Some(b.run_id.as_str()));
    assert!(r.resolve("other").is_none());
}

#[test]
fn instance_stays_running_until_last_session_ends() {
    let mut r = Registry::default();
    let a = r.begin("inst", opts(), 0).unwrap();
    let b = r.begin("inst", opts(), 0).unwrap();
    r.mark_running(&a.run_id, Some(1), 1_000);
    r.mark_running(&b.run_id, Some(2), 5_000);
    r.mark_stopped(&a.run_id, 11_000, |_| {});
    assert!(r.is_process_running("inst"));
    assert_eq!(r.clock_stop("inst", 11_000), None);
    r.mark_stopped(&b.run_id, 21_000, |_| {});
    assert!(!r.is_active("inst"));
    assert_eq!(r.clock_stop("inst", 21_000), Some(20));
    assert_eq!(r.clock_stop("inst", 30_000), None);
}

#[test]
fn logs_are_kept_per_session_and_masked() {
    let mut r = Registry::default();
    let a = r.begin("inst", opts(), 0).unwrap();
    let b = r.begin("inst", opts(), 0).unwrap();
    r.get_mut(&a.run_id).unwrap().secret = Some("geheimestoken".into());
    r.push(&a.run_id, vec![line("token geheimestoken"), line("zwei")]);
    r.push(&b.run_id, vec![line("b")]);
    assert_eq!(r.get(&a.run_id).unwrap().log.len(), 2);
    assert_eq!(r.get(&a.run_id).unwrap().log[0].text, "token ••••••");
    assert_eq!(r.get(&b.run_id).unwrap().log[0].seq, 1);
    let mut batches = r.take_pending();
    batches.sort_by(|x, y| x.run_id.cmp(&y.run_id));
    assert_eq!(batches.len(), 2);
    assert!(batches.iter().all(|b| b.instance_id == "inst"));
    assert!(r.take_pending().is_empty());
}

#[test]
fn new_begin_drops_old_stopped_sessions_of_that_instance() {
    let mut r = Registry::default();
    let a = r.begin("inst", opts(), 0).unwrap();
    r.mark_stopped(&a.run_id, 1, |s| s.crashed = true);
    assert!(r.latest_crash("inst").is_some());
    let b = r.begin("inst", opts(), 2).unwrap();
    assert!(!r.is_run(&a.run_id));
    assert_eq!(b.slot, 1);
    assert!(r.latest_crash("inst").is_none());
}

#[test]
fn stopped_sessions_are_capped() {
    let mut r = Registry::default();
    let runs: Vec<String> = (0..5).map(|i| r.begin("inst", opts(), i).unwrap().run_id).collect();
    for (i, run) in runs.iter().enumerate() {
        r.take_pending();
        r.mark_stopped(run, i as i64, |_| {});
    }
    assert_eq!(r.states().len(), KEEP_STOPPED_PER_INSTANCE);
    assert!(r.is_run(&runs[4]));
    assert!(!r.is_run(&runs[0]));
}

#[test]
fn same_world_cannot_be_opened_twice() {
    let mut r = Registry::default();
    r.begin("inst", BeginOpts { exclusive: false, world: Some("Welt"), server: None }, 0).unwrap();
    assert!(r.begin("inst", BeginOpts { exclusive: false, world: Some("Welt"), server: None }, 1).is_err());
    assert!(r.begin("inst", BeginOpts { exclusive: false, world: Some("Andere"), server: None }, 1).is_ok());
    assert!(r.begin("other", BeginOpts { exclusive: false, world: Some("Welt"), server: None }, 1).is_ok());
}

#[test]
fn account_in_use_matches_uuid_formats() {
    let mut r = Registry::default();
    let a = r.begin("inst", opts(), 0).unwrap();
    let b = r.begin("other", opts(), 0).unwrap();
    r.get_mut(&a.run_id).unwrap().state.account_uuid = Some("ABCD-ef01".into());
    assert_eq!(r.account_in_use("abcdef01", &b.run_id).map(|s| s.run_id), Some(a.run_id.clone()));
    assert!(r.account_in_use("abcdef01", &a.run_id).is_none());
    r.mark_stopped(&a.run_id, 1, |_| {});
    assert!(r.account_in_use("abcdef01", &b.run_id).is_none());
}

#[test]
fn concurrency_and_report_claims() {
    let mut r = Registry::default();
    let a = r.begin("inst", opts(), 0).unwrap();
    r.mark_running(&a.run_id, None, 10);
    assert!(!r.had_concurrent(&a.run_id));
    let b = r.begin("inst", opts(), 0).unwrap();
    r.mark_running(&b.run_id, None, 20);
    assert!(r.had_concurrent(&a.run_id));
    assert!(r.claim_report("x.txt"));
    assert!(!r.claim_report("x.txt"));
}

#[test]
fn log_config_is_redirected_for_extra_sessions() {
    let xml = r#"<RollingRandomAccessFile name="File" fileName="logs/latest.log" filePattern="logs/%d{yyyy-MM-dd}-%i.log.gz">"#;
    assert!(rewrite_log_config(xml, 1).is_none());
    let out = rewrite_log_config(xml, 2).unwrap();
    assert!(out.contains(r#"fileName="logs/vibe-session-2/latest.log""#));
    assert!(out.contains(r#"filePattern="logs/vibe-session-2/%d"#));
    assert!(rewrite_log_config("<Console/>", 3).is_none());
}
