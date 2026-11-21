use super::*;

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
