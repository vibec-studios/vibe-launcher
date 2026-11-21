use super::*;

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

    pub(super) fn store(&mut self, ev: AfkEvent) {
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
