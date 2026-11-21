use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};

pub const AFK_FILE: &str = "afk.json";
pub const STATE_FILE: &str = "afk-state.json";
pub const EVENTS_FILE: &str = "afk-events.jsonl";
pub const EVENTS_OLD: &str = "afk-events.1.jsonl";
pub const OUTBOX_FILE: &str = "afk-outbox.jsonl";
pub const MAX_TEXT: usize = 256;
pub const HEARTBEAT_STALE_MS: i64 = 15_000;
const MAX_LINE: usize = 64 * 1024;
const MAX_READ: u64 = 1024 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Mode {
    Background,
    Foreground,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Reconnect {
    pub enabled: bool,
    pub max_attempts: u32,
    pub base_delay_s: u32,
    pub max_delay_s: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Alerts {
    pub low_health: f32,
    pub low_food: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AfkFile {
    pub schema: u32,
    pub session: String,
    pub mode: Mode,
    pub background_fps: u32,
    pub mute: bool,
    pub hide_window: bool,
    pub auto_reconnect: Reconnect,
    pub alerts: Alerts,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mappings: Option<String>,
    pub updated_at: i64,
}

impl AfkFile {
    pub fn new(session: &str, mode: Mode, reconnect: bool, mappings: Option<String>, now: i64) -> Self {
        AfkFile {
            schema: 1,
            session: session.to_string(),
            mode,
            background_fps: 2,
            mute: true,
            hide_window: true,
            auto_reconnect: Reconnect { enabled: reconnect, max_attempts: 5, base_delay_s: 10, max_delay_s: 300 },
            alerts: Alerts { low_health: 6.0, low_food: 6 },
            mappings,
            updated_at: now,
        }
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(default)]
pub struct Capabilities {
    pub window: bool,
    pub throttle: bool,
    pub mute: bool,
    pub chat_events: bool,
    pub game_state: bool,
    pub send: bool,
    pub reconnect: bool,
}

#[derive(Debug, Clone, Default, Deserialize, PartialEq)]
#[serde(default)]
pub struct StateFile {
    pub agent_version: Option<String>,
    pub run: i64,
    pub pid: Option<u32>,
    pub session: Option<String>,
    pub mode: Option<Mode>,
    #[serde(default = "yes")]
    pub running: bool,
    pub capabilities: Capabilities,
    pub game: Map<String, Value>,
    pub stats: Map<String, Value>,
    pub updated_at: i64,
}

fn yes() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AfkEvent {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub seq: Option<u64>,
    #[serde(default)]
    pub ts: i64,
    #[serde(rename = "type")]
    pub kind: String,
    #[serde(flatten)]
    pub data: Map<String, Value>,
}

impl AfkEvent {
    pub fn new(ts: i64, kind: &str) -> Self {
        AfkEvent { seq: None, ts, kind: kind.to_string(), data: Map::new() }
    }
    pub fn with(mut self, key: &str, value: impl Into<Value>) -> Self {
        self.data.insert(key.to_string(), value.into());
        self
    }
    pub fn str(&self, key: &str) -> Option<&str> {
        self.data.get(key).and_then(Value::as_str)
    }
    pub fn bool(&self, key: &str) -> Option<bool> {
        self.data.get(key).and_then(Value::as_bool)
    }
}

#[derive(Debug, Clone, Copy, Default, PartialEq)]
pub struct Cursor {
    pub offset: u64,
    pub last_seq: u64,
}

pub fn path(vibe_dir: &Path, name: &str) -> PathBuf {
    vibe_dir.join(name)
}

pub fn write_afk(vibe_dir: &Path, file: &AfkFile) -> crate::error::AppResult<()> {
    crate::util::write_json_atomic(&path(vibe_dir, AFK_FILE), file)
}

pub fn read_afk(vibe_dir: &Path) -> Option<AfkFile> {
    serde_json::from_str(&std::fs::read_to_string(path(vibe_dir, AFK_FILE)).ok()?).ok()
}

pub fn read_state(vibe_dir: &Path) -> Option<StateFile> {
    serde_json::from_str(&std::fs::read_to_string(path(vibe_dir, STATE_FILE)).ok()?).ok()
}

pub fn reset(vibe_dir: &Path) {
    for name in [EVENTS_FILE, EVENTS_OLD, OUTBOX_FILE, STATE_FILE] {
        let _ = std::fs::remove_file(path(vibe_dir, name));
    }
}

pub fn remove_afk_if(vibe_dir: &Path, session: &str) {
    if read_afk(vibe_dir).is_some_and(|f| f.session == session) {
        let _ = std::fs::remove_file(path(vibe_dir, AFK_FILE));
    }
}

pub fn parse_chunk(bytes: &[u8]) -> (Vec<AfkEvent>, usize) {
    let Some(last) = bytes.iter().rposition(|&b| b == b'\n') else {
        return (Vec::new(), if bytes.len() > MAX_LINE { bytes.len() } else { 0 });
    };
    let consumed = last + 1;
    let events = bytes[..consumed]
        .split(|&b| b == b'\n')
        .filter(|l| !l.is_empty() && l.len() <= MAX_LINE)
        .filter_map(|l| serde_json::from_slice::<AfkEvent>(l.strip_suffix(b"\r").unwrap_or(l)).ok())
        .filter(|e| !e.kind.is_empty() && e.kind.len() <= 32)
        .collect();
    (events, consumed)
}

fn read_from(file: &Path, offset: u64) -> (Vec<AfkEvent>, u64, u64) {
    let Ok(mut f) = std::fs::File::open(file) else { return (Vec::new(), 0, 0) };
    let len = f.metadata().map(|m| m.len()).unwrap_or(0);
    if len <= offset || f.seek(SeekFrom::Start(offset)).is_err() {
        return (Vec::new(), offset.min(len), len);
    }
    let mut buf = Vec::new();
    if f.take(MAX_READ).read_to_end(&mut buf).is_err() {
        return (Vec::new(), offset, len);
    }
    let (events, consumed) = parse_chunk(&buf);
    (events, offset + consumed as u64, len)
}

pub fn read_events(vibe_dir: &Path, cur: &mut Cursor) -> Vec<AfkEvent> {
    let main = path(vibe_dir, EVENTS_FILE);
    let (evs, end, len) = read_from(&main, cur.offset);
    let jumped = cur.last_seq > 0 && evs.first().and_then(|e| e.seq).is_some_and(|s| s > cur.last_seq + 1);
    let all = if len < cur.offset || jumped {
        let (old, _, _) = read_from(&path(vibe_dir, EVENTS_OLD), cur.offset);
        let (new, end2, _) = read_from(&main, 0);
        cur.offset = end2;
        old.into_iter().chain(new).collect::<Vec<_>>()
    } else {
        cur.offset = end;
        evs
    };
    let mut out = Vec::new();
    for e in all {
        if e.kind == "agent_start" {
            cur.last_seq = 0;
        }
        if let Some(s) = e.seq {
            if s <= cur.last_seq {
                continue;
            }
            cur.last_seq = s;
        }
        out.push(e);
    }
    out
}

pub fn clean_text(text: &str) -> Result<String, &'static str> {
    let t = text.trim();
    if t.is_empty() {
        return Err("empty");
    }
    if t.chars().any(|c| c.is_control() || c == '\u{a7}') {
        return Err("control");
    }
    if t.chars().count() > MAX_TEXT {
        return Err("too_long");
    }
    Ok(t.to_string())
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct OutboxLine {
    pub id: String,
    #[serde(rename = "type")]
    pub kind: &'static str,
    pub text: String,
}

pub fn outbox_line(id: &str, text: &str) -> OutboxLine {
    match text.strip_prefix('/') {
        Some(cmd) => OutboxLine { id: id.to_string(), kind: "command", text: cmd.to_string() },
        None => OutboxLine { id: id.to_string(), kind: "chat", text: text.to_string() },
    }
}

pub fn append_outbox(vibe_dir: &Path, line: &OutboxLine) -> std::io::Result<()> {
    std::fs::create_dir_all(vibe_dir)?;
    let mut data = serde_json::to_vec(line).map_err(std::io::Error::other)?;
    data.push(b'\n');
    let mut f = std::fs::OpenOptions::new().create(true).append(true).open(path(vibe_dir, OUTBOX_FILE))?;
    f.write_all(&data)
}

#[cfg(test)]
mod tests {
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
}
