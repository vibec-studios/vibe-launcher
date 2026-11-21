use super::files::{AfkEvent, AfkFile, Capabilities, Cursor, Mode, StateFile, HEARTBEAT_STALE_MS};
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::collections::{HashMap, VecDeque};
use std::path::PathBuf;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::LazyLock;

pub const MAX_EVENTS: usize = 500;
const NOTIFY_GAP_MS: i64 = 15_000;
pub const NOTIFY_KINDS: &[&str] = &["death", "disconnect", "mention", "whisper", "reconnect_gave_up"];

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum AgentState {
    Pending,
    Active,
    Missing,
    Unsupported,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(default)]
pub struct Features {
    pub window: bool,
    pub fps: bool,
    pub sound: bool,
    pub chat_read: bool,
    pub chat_send: bool,
    pub reconnect: bool,
    pub game_state: bool,
}

impl From<&Capabilities> for Features {
    fn from(c: &Capabilities) -> Self {
        Features { window: c.window, fps: c.throttle, sound: c.mute, chat_read: c.chat_events, chat_send: c.send, reconnect: c.reconnect, game_state: c.game_state }
    }
}

#[derive(Debug, Clone)]
pub struct Run {
    pub run_id: String,
    pub instance_id: String,
    pub game_dir: PathBuf,
    pub requested: bool,
    pub mode: Mode,
    pub mode_at: i64,
    pub ack_at: Option<i64>,
    pub agent: AgentState,
    pub agent_version: Option<String>,
    pub features: Features,
    pub overlay: bool,
    pub files: bool,
    pub hidden: Vec<isize>,
    pub window: Option<&'static str>,
    pub window_seen_at: Option<i64>,
    pub fg_checked: bool,
    pub status: Map<String, Value>,
    pub events: VecDeque<AfkEvent>,
    pub cursor: Cursor,
    pub heartbeat: Option<i64>,
    pub player: Option<String>,
    pub notified: HashMap<String, i64>,
    pub ended: bool,
    pub agent_chat: bool,
    pub file: Option<AfkFile>,
    pub last_snapshot: String,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Snapshot {
    pub run_id: String,
    pub instance_id: String,
    pub requested: bool,
    pub mode: Mode,
    pub mode_at: i64,
    pub agent: AgentState,
    pub agent_version: Option<String>,
    pub features: Features,
    pub window: Option<&'static str>,
    pub window_hidden: bool,
    pub overlay: bool,
    pub can_send: bool,
    pub status: Map<String, Value>,
    pub events: usize,
    pub ended: bool,
}

impl Run {
    pub fn new(run_id: &str, instance_id: &str, game_dir: PathBuf, mode: Mode, now: i64) -> Self {
        Run {
            run_id: run_id.into(),
            instance_id: instance_id.into(),
            game_dir,
            requested: mode == Mode::Background,
            mode,
            mode_at: now,
            ack_at: None,
            agent: AgentState::Missing,
            agent_version: None,
            features: Features::default(),
            overlay: false,
            files: false,
            hidden: Vec::new(),
            window: None,
            window_seen_at: None,
            fg_checked: false,
            status: Map::new(),
            events: VecDeque::new(),
            cursor: Cursor::default(),
            heartbeat: None,
            player: None,
            notified: HashMap::new(),
            ended: false,
            agent_chat: false,
            file: None,
            last_snapshot: String::new(),
        }
    }

    pub fn vibe_dir(&self) -> PathBuf {
        self.game_dir.join(".vibe")
    }

    pub fn can_send(&self) -> bool {
        self.files && self.agent == AgentState::Active && self.features.chat_send && !self.ended
    }

    pub fn agent_handles_window(&self, now: i64) -> bool {
        self.agent == AgentState::Active && self.features.window && (self.ack_at.is_some() || now - self.mode_at < 4_000)
    }

    pub fn snapshot(&self) -> Snapshot {
        Snapshot {
            run_id: self.run_id.clone(),
            instance_id: self.instance_id.clone(),
            requested: self.requested,
            mode: self.mode,
            mode_at: self.mode_at,
            agent: self.agent,
            agent_version: self.agent_version.clone(),
            features: self.features.clone(),
            window: self.window,
            window_hidden: !self.hidden.is_empty() || (self.mode == Mode::Background && self.window == Some("agent")),
            overlay: self.overlay,
            can_send: self.can_send(),
            status: self.status.clone(),
            events: self.events.len(),
            ended: self.ended,
        }
    }

    pub fn set_mode(&mut self, mode: Mode, now: i64) {
        self.mode = mode;
        self.mode_at = now;
        self.ack_at = None;
        self.window_seen_at = None;
        self.fg_checked = false;
        if mode == Mode::Background {
            self.requested = true;
        }
    }

    fn store(&mut self, ev: AfkEvent) {
        self.events.push_back(ev);
        while self.events.len() > MAX_EVENTS {
            self.events.pop_front();
        }
    }

    pub fn apply(&mut self, ev: AfkEvent) -> Option<AfkEvent> {
        match ev.kind.as_str() {
            "agent_start" => {
                self.agent = AgentState::Active;
                self.agent_version = ev.str("agent_version").map(str::to_string).or(self.agent_version.take());
            }
            "capabilities" => {
                if let Ok(c) = serde_json::from_value::<Capabilities>(Value::Object(ev.data.clone())) {
                    self.features = Features::from(&c);
                }
                return None;
            }
            "mode" => {
                if ev.str("mode") == Some(mode_str(self.mode)) {
                    self.ack_at = Some(ev.ts);
                    if ev.bool("window") == Some(true) {
                        self.window = Some("agent");
                    }
                }
            }
            "health" => {
                for k in ["health", "max_health", "food"] {
                    if let Some(v) = ev.data.get(k) {
                        self.status.insert(k.into(), v.clone());
                    }
                }
                return None;
            }
            "connect" => {
                self.status.insert("connected".into(), true.into());
                self.status.insert("server".into(), ev.data.get("server").cloned().unwrap_or(Value::Null));
                if let Some(w) = ev.data.get("world") {
                    self.status.insert("world".into(), w.clone());
                }
            }
            "disconnect" => {
                self.status.insert("connected".into(), false.into());
            }
            "death" => {
                self.status.insert("dead".into(), true.into());
            }
            "respawn" => {
                self.status.insert("dead".into(), false.into());
            }
            "chat" if ev.bool("fallback") != Some(true) => self.agent_chat = true,
            _ => {}
        }
        self.store(ev.clone());
        Some(ev)
    }

    pub fn apply_state(&mut self, st: &StateFile, now: i64) {
        if st.session.as_deref().is_some_and(|s| s != self.run_id) {
            return;
        }
        if !st.running || now - st.updated_at > HEARTBEAT_STALE_MS {
            if self.agent == AgentState::Active {
                self.agent = AgentState::Missing;
                self.features = Features::default();
            }
            return;
        }
        self.heartbeat = Some(st.updated_at);
        self.agent = AgentState::Active;
        if st.agent_version.is_some() {
            self.agent_version = st.agent_version.clone();
        }
        self.features = Features::from(&st.capabilities);
        if st.mode == Some(self.mode) && self.ack_at.is_none() {
            self.ack_at = Some(now);
        }
        if self.mode == Mode::Background && st.stats.get("window_hidden").and_then(Value::as_bool) == Some(true) {
            self.window = Some("agent");
        }
        if !st.game.is_empty() {
            for (k, v) in &st.game {
                self.status.insert(k.clone(), v.clone());
            }
            let screen = st.game.get("screen").and_then(Value::as_str).unwrap_or_default();
            self.status.insert("connected".into(), matches!(screen, "world" | "death").into());
            self.status.insert("updated_at".into(), st.updated_at.into());
        }
    }

    pub fn accepts_log(&self) -> bool {
        !self.ended && !self.agent_chat && matches!(self.agent, AgentState::Missing | AgentState::Unsupported)
    }

    pub fn should_notify(&mut self, ev: &AfkEvent, enabled: bool) -> bool {
        if !enabled || self.mode != Mode::Background || !NOTIFY_KINDS.contains(&ev.kind.as_str()) || ev.bool("left") == Some(true) {
            return false;
        }
        let key = match ev.kind.as_str() {
            "whisper" => "mention",
            "reconnect_gave_up" => "disconnect",
            k => k,
        };
        let last = self.notified.get(key).copied().unwrap_or(i64::MIN / 2);
        if ev.ts - last < NOTIFY_GAP_MS {
            return false;
        }
        self.notified.insert(key.to_string(), ev.ts);
        true
    }

    pub fn changed(&mut self) -> Option<Snapshot> {
        let snap = self.snapshot();
        let key = serde_json::to_string(&snap).unwrap_or_default();
        if key == self.last_snapshot {
            return None;
        }
        self.last_snapshot = key;
        Some(snap)
    }
}

pub fn mode_str(m: Mode) -> &'static str {
    match m {
        Mode::Background => "background",
        Mode::Foreground => "foreground",
    }
}

static REG: LazyLock<Mutex<HashMap<String, Run>>> = LazyLock::new(Default::default);
static COUNT: AtomicUsize = AtomicUsize::new(0);
static REQUESTED: LazyLock<Mutex<std::collections::HashSet<String>>> = LazyLock::new(Default::default);

pub fn any() -> bool {
    COUNT.load(Ordering::Relaxed) > 0
}

pub fn with<R>(f: impl FnOnce(&mut HashMap<String, Run>) -> R) -> R {
    let mut reg = REG.lock();
    let r = f(&mut reg);
    COUNT.store(reg.len(), Ordering::Relaxed);
    r
}

pub fn request(run_id: &str) {
    REQUESTED.lock().insert(run_id.to_string());
}

pub fn take_request(run_id: &str) -> bool {
    REQUESTED.lock().remove(run_id)
}

#[cfg(test)]
mod tests {
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
}
