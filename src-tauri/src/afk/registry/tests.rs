use super::*;

fn ev(ts: i64, kind: &str) -> AfkEvent {
    AfkEvent::new(ts, kind)
}

fn run() -> Run {
    Run::new("run-1", "inst", PathBuf::from("x"), Mode::Background, 0)
}

#[test]
fn agent_events_flow() {
    let mut r = run();
    r.files = true;
    r.agent = AgentState::Pending;
    assert!(r.apply(ev(1, "agent_start").with("agent_version", "0.1.0")).is_some());
    assert_eq!(r.agent, AgentState::Active);
    assert!(!r.can_send());
    assert!(r.apply(ev(2, "capabilities").with("window", true).with("send", true).with("chat_events", true)).is_none());
    assert!(r.can_send());
    assert!(!r.accepts_log());
    r.apply(ev(3, "mode").with("mode", "foreground"));
    assert_eq!(r.ack_at, None);
    r.apply(ev(4, "mode").with("mode", "background").with("window", true));
    assert_eq!(r.ack_at, Some(4));
    assert_eq!(r.window, Some("agent"));
    assert!(r.snapshot().window_hidden);
    r.apply(ev(5, "connect").with("server", "play.example.net"));
    assert_eq!(r.status["connected"], true);
    assert!(r.apply(ev(6, "health").with("health", 5.0).with("food", 3)).is_none());
    assert_eq!(r.status["food"], 3);
    r.apply(ev(7, "disconnect").with("reason", "AFK"));
    assert_eq!(r.status["connected"], false);
    assert_eq!(r.events.len(), 5);
}

#[test]
fn state_file_heartbeat() {
    let mut r = run();
    r.agent = AgentState::Pending;
    let mut st = StateFile { running: true, updated_at: 1_000, session: Some("run-1".into()), mode: Some(Mode::Background), ..Default::default() };
    st.capabilities.window = true;
    st.capabilities.send = true;
    st.game.insert("screen".into(), "world".into());
    st.game.insert("server".into(), "mc.example.org".into());
    st.stats.insert("window_hidden".into(), true.into());
    r.apply_state(&st, 2_000);
    assert_eq!(r.agent, AgentState::Active);
    assert!(r.features.window && r.features.chat_send);
    assert_eq!(r.ack_at, Some(2_000));
    assert_eq!(r.window, Some("agent"));
    assert_eq!(r.status["connected"], true);
    assert_eq!(r.status["server"], "mc.example.org");
    r.apply_state(&st, 1_000 + HEARTBEAT_STALE_MS + 1);
    assert_eq!(r.agent, AgentState::Missing);
    assert!(!r.features.window);
    let other = StateFile { session: Some("run-9".into()), running: true, updated_at: 50_000, ..Default::default() };
    r.apply_state(&other, 50_000);
    assert_eq!(r.agent, AgentState::Missing);
}

#[test]
fn events_are_capped_and_log_fallback_rules() {
    let mut r = run();
    assert!(r.accepts_log());
    for i in 0..(MAX_EVENTS as i64 + 20) {
        r.apply(ev(i, "chat").with("fallback", true));
    }
    assert_eq!(r.events.len(), MAX_EVENTS);
    assert_eq!(r.events.front().unwrap().ts, 20);
    assert!(r.accepts_log());
    r.apply(ev(1, "chat").with("source", "log"));
    assert!(!r.accepts_log());
    let mut p = run();
    p.agent = AgentState::Pending;
    assert!(!p.accepts_log());
}

#[test]
fn notifications_only_in_background_and_rate_limited() {
    let mut r = run();
    assert!(r.should_notify(&ev(100_000, "death"), true));
    assert!(!r.should_notify(&ev(101_000, "death"), true));
    assert!(r.should_notify(&ev(101_000, "disconnect").with("reason", "x"), true));
    assert!(!r.should_notify(&ev(200_000, "disconnect").with("left", true), true));
    assert!(r.should_notify(&ev(200_000, "whisper"), true));
    assert!(!r.should_notify(&ev(201_000, "mention"), true));
    assert!(!r.should_notify(&ev(300_000, "chat"), true));
    assert!(!r.should_notify(&ev(400_000, "mention"), false));
    r.set_mode(Mode::Foreground, 400_000);
    assert!(!r.should_notify(&ev(500_000, "death"), true));
}

#[test]
fn snapshot_change_detection() {
    let mut r = run();
    assert!(r.changed().is_some());
    assert!(r.changed().is_none());
    r.hidden.push(5);
    let s = r.changed().unwrap();
    assert!(s.window_hidden);
    assert!(!s.can_send);
}
