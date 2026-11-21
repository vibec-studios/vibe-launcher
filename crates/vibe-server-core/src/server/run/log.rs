use super::*;

impl ServerManager {
    pub(super) fn ensure_flusher(&self) {
        self.flusher.call_once(|| {
            let me = self.me.clone();
            crate::rt::spawn(async move {
                loop {
                    tokio::time::sleep(Duration::from_millis(100)).await;
                    let Some(m) = me.upgrade() else { break };
                    m.flush();
                }
            });
        });
    }

    pub(super) fn flush(&self) {
        let batches: Vec<(String, Vec<LogLine>)> = {
            let mut map = self.sessions.lock();
            map.iter_mut().filter(|(_, s)| !s.pending.is_empty()).map(|(k, s)| (k.clone(), std::mem::take(&mut s.pending))).collect()
        };
        for (id, lines) in batches {
            events::emit(&self.events, EV_LOG, &serde_json::json!({ "server_id": id, "lines": lines }));
        }
    }

    pub fn push(&self, id: &str, lines: Vec<Parsed>) {
        if lines.is_empty() {
            return;
        }
        let mut map = self.sessions.lock();
        let s = map.entry(id.to_string()).or_insert_with(|| Session::new(id));
        for p in lines {
            s.seq += 1;
            let l = LogLine { seq: s.seq, time: p.time, level: p.level, thread: p.thread, logger: p.logger, text: p.text };
            if s.log.len() >= MAX_LINES {
                s.log.pop_front();
            }
            s.log.push_back(l.clone());
            s.pending.push(l);
        }
    }

    pub fn launcher_line(&self, id: &str, level: LogLevel, text: impl Into<String>) {
        let time = Some(chrono::Local::now().format("%H:%M:%S").to_string());
        let lines = text
            .into()
            .lines()
            .map(|t| Parsed { time: time.clone(), level, thread: None, logger: Some("Vibe Launcher".into()), text: t.to_string() })
            .collect();
        self.push(id, lines);
    }

    /// Ausgabezeile auswerten: Start fertig, Spieler, `list`-Antwort.
    pub(super) fn inspect(&self, state: &Core, id: &str, text: &str) {
        static DONE: OnceLock<Regex> = OnceLock::new();
        static JOIN: OnceLock<Regex> = OnceLock::new();
        static LEFT: OnceLock<Regex> = OnceLock::new();
        static LIST: OnceLock<Regex> = OnceLock::new();
        let done = DONE.get_or_init(|| re(r#"Done \([0-9.,]+s\)! For help, type "help""#));
        let join = JOIN.get_or_init(|| re(r"(?:^|System chat: |\]: )([A-Za-z0-9_]{1,16}) joined the game$"));
        let left = LEFT.get_or_init(|| re(r"(?:^|System chat: |\]: )([A-Za-z0-9_]{1,16}) left the game$"));
        let list = LIST.get_or_init(|| re(r"There are (\d+) ?(?:of a max of|/|out of maximum) ?(\d+) players online\.?:?(.*)$"));
        if done.is_match(text) {
            let max = crate::server::props::get(&server_dir(&self.paths, id).join("server.properties"), "max-players").and_then(|v| v.parse().ok());
            self.update(id, |s| {
                if s.status.state == RunState::Starting {
                    s.status.state = RunState::Running;
                }
                s.status.max_players = max;
            });
            self.launcher_line(id, LogLevel::Launcher, "Server ist bereit.");
            start_tunnel(state, id);
        } else if let Some(c) = join.captures(text) {
            let name = c[1].to_string();
            self.update(id, |s| {
                if !s.status.players.contains(&name) {
                    s.status.players.push(name);
                }
            });
        } else if let Some(c) = left.captures(text) {
            let name = c[1].to_string();
            self.update(id, |s| s.status.players.retain(|p| *p != name));
        } else if let Some(c) = list.captures(text) {
            let max = c[2].parse().ok();
            let names: Vec<String> =
                c[3].split(',').map(|n| n.trim().to_string()).filter(|n| !n.is_empty() && n.len() <= 16).collect();
            let count: usize = c[1].parse().unwrap_or(0);
            self.update(id, |s| {
                s.status.max_players = max;
                if names.len() == count {
                    s.status.players = names;
                }
            });
        } else if text.contains("FAILED TO BIND TO PORT") {
            self.launcher_line(id, LogLevel::Error, "Der Port ist belegt – läuft dort schon ein anderer Server? Ändere den Port in den Einstellungen.");
        }
    }
}

/// ANSI-Farbcodes entfernen (Paper/Velocity färben die Konsole, falls sie ein Terminal vermuten).
pub fn strip_ansi(s: &str) -> std::borrow::Cow<'_, str> {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| re(r"\x1b\[[0-9;?]*[ -/]*[@-~]")).replace_all(s, "")
}

/// Konsolenformat von Paper/Purpur/Folia (`[12:34:56 INFO]: [Plugin] Text`) in Zeit/Level/Logger zerlegen.
/// Vanilla-Zeilen (`[12:34:56] [Server thread/INFO]: …`) erkennt schon der allgemeine Parser.
pub fn paper_line(p: &mut Parsed) {
    static RE: OnceLock<Regex> = OnceLock::new();
    if !matches!(p.level, LogLevel::Stdout | LogLevel::Stderr) {
        return;
    }
    if p.text.contains('\x1b') {
        p.text = strip_ansi(&p.text).into_owned();
    }
    let rx = RE.get_or_init(|| re(r"^\[(\d{2}:\d{2}:\d{2})(?:[.,]\d+)? (TRACE|DEBUG|INFO|WARN|WARNING|ERROR|SEVERE|FATAL)\]:? ?(.*)$"));
    let Some(c) = rx.captures(&p.text) else { return };
    let level = match &c[2] {
        "TRACE" => LogLevel::Trace,
        "DEBUG" => LogLevel::Debug,
        "INFO" => LogLevel::Info,
        "WARN" | "WARNING" => LogLevel::Warn,
        "FATAL" => LogLevel::Fatal,
        _ => LogLevel::Error,
    };
    let time = c[1].to_string();
    let mut text = c[3].to_string();
    // „[LuckPerms] Lade …“ -> Logger = Plugin (nur ein Wort, damit „[Not Secure] <Bob> …“ Text bleibt)
    let mut logger = None;
    if let Some(rest) = text.strip_prefix('[') {
        if let Some((name, after)) = rest.split_once("] ") {
            if !name.is_empty() && name.len() <= 40 && !name.contains(' ') && !name.contains(':') {
                logger = Some(name.to_string());
                text = after.to_string();
            }
        }
    }
    p.time = Some(time);
    p.level = level;
    p.logger = logger;
    p.text = text;
}
