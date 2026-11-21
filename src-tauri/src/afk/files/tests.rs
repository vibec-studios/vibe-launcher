use super::*;
use crate::util::testdir::TestDir;

fn line(seq: u64, kind: &str) -> String {
    format!("{{\"seq\":{seq},\"ts\":{seq},\"type\":\"{kind}\"}}\n")
}

#[test]
fn parse_keeps_partial_line() {
    let data = b"{\"seq\":1,\"ts\":1,\"type\":\"chat\",\"text\":\"hi\"}\n{\"seq\":2,\"ts\":2,\"type\":\"de";
    let (ev, used) = parse_chunk(data);
    assert_eq!(ev.len(), 1);
    assert_eq!(ev[0].seq, Some(1));
    assert_eq!(ev[0].str("text"), Some("hi"));
    assert_eq!(used, data.iter().position(|&b| b == b'\n').unwrap() + 1);
}

#[test]
fn parse_skips_garbage_and_crlf() {
    let data = b"nope\n{\"seq\":3,\"ts\":3,\"type\":\"death\",\"message\":\"x\"}\r\n{\"seq\":4,\"ts\":4,\"type\":\"\"}\n";
    let (ev, used) = parse_chunk(data);
    assert_eq!(used, data.len());
    assert_eq!(ev.len(), 1);
    assert_eq!(ev[0].kind, "death");
}

#[test]
fn events_follow_offset_and_skip_duplicates() {
    let dir = TestDir::new("afk-ev");
    let p = path(dir.path(), EVENTS_FILE);
    std::fs::write(&p, line(1, "agent_start") + &line(2, "mode")).unwrap();
    let mut cur = Cursor::default();
    assert_eq!(read_events(dir.path(), &mut cur).len(), 2);
    assert!(read_events(dir.path(), &mut cur).is_empty());
    let mut f = std::fs::OpenOptions::new().append(true).open(&p).unwrap();
    f.write_all(line(2, "mode").as_bytes()).unwrap();
    f.write_all(line(3, "chat").as_bytes()).unwrap();
    let next = read_events(dir.path(), &mut cur);
    assert_eq!(next.len(), 1);
    assert_eq!(next[0].kind, "chat");
    assert_eq!(cur.last_seq, 3);
}

#[test]
fn rotation_reads_rest_of_old_file_first() {
    let dir = TestDir::new("afk-rot");
    let main = path(dir.path(), EVENTS_FILE);
    let first = line(1, "agent_start") + &line(2, "chat");
    std::fs::write(&main, &first).unwrap();
    let mut cur = Cursor::default();
    assert_eq!(read_events(dir.path(), &mut cur).len(), 2);
    let old = first + &line(3, "death");
    std::fs::write(path(dir.path(), EVENTS_OLD), &old).unwrap();
    std::fs::write(&main, line(4, "respawn")).unwrap();
    let evs = read_events(dir.path(), &mut cur);
    assert_eq!(evs.iter().map(|e| e.kind.as_str()).collect::<Vec<_>>(), vec!["death", "respawn"]);
    assert_eq!(cur.last_seq, 4);
}

#[test]
fn rotation_detected_by_seq_jump() {
    let dir = TestDir::new("afk-rot2");
    let main = path(dir.path(), EVENTS_FILE);
    let first = line(1, "agent_start");
    std::fs::write(&main, &first).unwrap();
    let mut cur = Cursor::default();
    read_events(dir.path(), &mut cur);
    std::fs::write(path(dir.path(), EVENTS_OLD), first.clone() + &line(2, "chat")).unwrap();
    std::fs::write(&main, line(3, "chat") + &line(4, "chat") + &line(5, "chat") + &line(6, "chat")).unwrap();
    let evs = read_events(dir.path(), &mut cur);
    assert_eq!(evs.iter().filter_map(|e| e.seq).collect::<Vec<_>>(), vec![2, 3, 4, 5, 6]);
}

#[test]
fn afk_file_shape() {
    let dir = TestDir::new("afk-file");
    let f = AfkFile::new("run-1", Mode::Background, false, None, 5);
    write_afk(dir.path(), &f).unwrap();
    let raw: Value = serde_json::from_str(&std::fs::read_to_string(path(dir.path(), AFK_FILE)).unwrap()).unwrap();
    assert_eq!(raw["mode"], "background");
    assert_eq!(raw["session"], "run-1");
    assert_eq!(raw["background_fps"], 2);
    assert_eq!(raw["auto_reconnect"]["enabled"], false);
    assert_eq!(raw["alerts"]["low_food"], 6);
    assert!(raw.get("mappings").is_none());
    assert_eq!(read_afk(dir.path()), Some(f));
    remove_afk_if(dir.path(), "run-2");
    assert!(read_afk(dir.path()).is_some());
    remove_afk_if(dir.path(), "run-1");
    assert!(read_afk(dir.path()).is_none());
}

#[test]
fn state_file_parses_contract_example() {
    let dir = TestDir::new("afk-state");
    let json = r#"{"schema":1,"agent_version":"0.1.0","run":17,"pid":12345,"session":"run-1","mode":"background","running":true,
      "env":{"lwjgl":"3.3.3"},"capabilities":{"window":true,"throttle":true,"mute":true,"chat_events":true,"game_state":false,"send":false,"reconnect":false},
      "game":{"screen":"world","server":"play.example.net","health":20.0,"food":20},"stats":{"window_hidden":true},"updated_at":99,"future":1}"#;
    std::fs::write(path(dir.path(), STATE_FILE), json).unwrap();
    let s = read_state(dir.path()).unwrap();
    assert_eq!(s.mode, Some(Mode::Background));
    assert!(s.capabilities.window && !s.capabilities.send);
    assert_eq!(s.game["server"], "play.example.net");
    assert_eq!(s.updated_at, 99);
    std::fs::write(path(dir.path(), STATE_FILE), "{}").unwrap();
    assert!(read_state(dir.path()).unwrap().running);
}

#[test]
fn outbox_lines_are_jsonl() {
    let dir = TestDir::new("afk-out");
    append_outbox(dir.path(), &outbox_line("a", "Hallo")).unwrap();
    append_outbox(dir.path(), &outbox_line("b", "/spawn")).unwrap();
    let text = std::fs::read_to_string(path(dir.path(), OUTBOX_FILE)).unwrap();
    let lines: Vec<Value> = text.lines().map(|l| serde_json::from_str(l).unwrap()).collect();
    assert_eq!(lines[0], serde_json::json!({ "id": "a", "type": "chat", "text": "Hallo" }));
    assert_eq!(lines[1], serde_json::json!({ "id": "b", "type": "command", "text": "spawn" }));
    std::fs::write(path(dir.path(), STATE_FILE), "{}").unwrap();
    reset(dir.path());
    assert!(!path(dir.path(), OUTBOX_FILE).exists());
    assert!(!path(dir.path(), STATE_FILE).exists());
}

#[test]
fn clean_text_rules() {
    assert_eq!(clean_text("  hi "), Ok("hi".into()));
    assert!(clean_text("").is_err());
    assert!(clean_text("a\nb").is_err());
    assert!(clean_text("\u{a7}cRot").is_err());
    assert!(clean_text(&"x".repeat(257)).is_err());
    assert!(clean_text(&"ä".repeat(256)).is_ok());
}
