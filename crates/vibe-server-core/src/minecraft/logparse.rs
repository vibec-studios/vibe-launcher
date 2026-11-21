//! Log4j-XML-Events und Klartext der Konsolen-Ausgabe.
use super::LogLevel;
use regex::Regex;
use std::sync::OnceLock;

/// Geparste Zeile ohne Sequenznummer.
#[derive(Debug, Clone, PartialEq)]
pub struct Parsed {
    pub time: Option<String>,
    pub level: LogLevel,
    pub thread: Option<String>,
    pub logger: Option<String>,
    pub text: String,
}

pub fn level_from(s: &str) -> Option<LogLevel> {
    Some(match s.trim().to_ascii_uppercase().as_str() {
        "TRACE" => LogLevel::Trace,
        "DEBUG" => LogLevel::Debug,
        "INFO" => LogLevel::Info,
        "WARN" | "WARNING" => LogLevel::Warn,
        "ERROR" | "SEVERE" => LogLevel::Error,
        "FATAL" => LogLevel::Fatal,
        _ => return None,
    })
}

pub fn unescape(s: &str) -> String {
    if !s.contains('&') {
        return s.to_string();
    }
    s.replace("&lt;", "<").replace("&gt;", ">").replace("&quot;", "\"").replace("&apos;", "'").replace("&#xD;", "\r").replace("&#xA;", "\n").replace("&amp;", "&")
}

/// Inhalt eines Elements; CDATA-Abschnitte werden zusammengefügt, sonst Entities aufgelöst.
pub fn element_text(xml: &str, tag: &str) -> Option<String> {
    let open = format!("<{tag}>");
    let close = format!("</{tag}>");
    let start = xml.find(&open)? + open.len();
    let end = xml[start..].find(&close).map(|e| start + e).unwrap_or(xml.len());
    let inner = &xml[start..end];
    if inner.contains("<![CDATA[") {
        let mut out = String::new();
        let mut rest = inner;
        while let Some(i) = rest.find("<![CDATA[") {
            out.push_str(&unescape(&rest[..i]));
            let after = &rest[i + 9..];
            match after.find("]]>") {
                Some(j) => {
                    out.push_str(&after[..j]);
                    rest = &after[j + 3..];
                }
                None => {
                    out.push_str(after);
                    rest = "";
                }
            }
        }
        out.push_str(&unescape(rest));
        Some(out)
    } else {
        Some(unescape(inner))
    }
}

pub fn fmt_time_ms(ms: i64) -> Option<String> {
    use chrono::TimeZone;
    chrono::Local.timestamp_millis_opt(ms).single().map(|t| t.format("%H:%M:%S").to_string())
}

/// Ein vollständiges `<log4j:Event>`-Element auswerten.
pub fn parse_event(xml: &str) -> Vec<Parsed> {
    static ATTR: OnceLock<Regex> = OnceLock::new();
    let attr = ATTR.get_or_init(|| Regex::new(r#"(\w+)="([^"]*)""#).expect("regex"));
    let head_end = xml.find('>').unwrap_or(xml.len());
    let head = &xml[..head_end];
    let mut level = LogLevel::Info;
    let mut time = None;
    let mut thread = None;
    let mut logger = None;
    for c in attr.captures_iter(head) {
        let v = unescape(&c[2]);
        match &c[1] {
            "level" => level = level_from(&v).unwrap_or(LogLevel::Info),
            "timestamp" => time = v.parse::<i64>().ok().and_then(fmt_time_ms),
            "thread" => thread = Some(v),
            "logger" => logger = Some(v),
            _ => {}
        }
    }
    let mut text = element_text(xml, "log4j:Message").unwrap_or_default();
    if let Some(t) = element_text(xml, "log4j:Throwable") {
        let t = t.trim_end();
        if !t.is_empty() {
            if !text.is_empty() {
                text.push('\n');
            }
            text.push_str(t);
        }
    }
    let text = text.trim_end_matches(['\n', '\r']);
    text.split('\n')
        .map(|l| Parsed { time: time.clone(), level, thread: thread.clone(), logger: logger.clone(), text: l.trim_end_matches('\r').to_string() })
        .collect()
}

/// Zeilenweiser Parser für die Spielausgabe (XML-Events über mehrere Zeilen, sonst Klartext).
pub struct LineParser {
    buf: Option<String>,
    stderr: bool,
    last: Option<Parsed>,
}

impl LineParser {
    pub fn new(stderr: bool) -> Self {
        LineParser { buf: None, stderr, last: None }
    }

    pub fn feed(&mut self, line: &str) -> Vec<Parsed> {
        let line = line.trim_end_matches(['\r', '\n']);
        if let Some(buf) = &mut self.buf {
            buf.push_str(line);
            buf.push('\n');
            if line.contains("</log4j:Event>") {
                let xml = self.buf.take().unwrap_or_default();
                return self.finish_event(&xml);
            }
            if buf.len() > 4 * 1024 * 1024 {
                let xml = self.buf.take().unwrap_or_default();
                return xml.lines().map(|l| self.plain(l)).collect();
            }
            return vec![];
        }
        if let Some(i) = line.find("<log4j:Event") {
            let mut out = Vec::new();
            let before = &line[..i];
            if !before.trim().is_empty() {
                out.push(self.plain(before));
            }
            let rest = &line[i..];
            if rest.contains("</log4j:Event>") {
                let end = rest.find("</log4j:Event>").unwrap_or(0) + "</log4j:Event>".len();
                out.extend(self.finish_event(&rest[..end]));
                let tail = &rest[end..];
                if !tail.trim().is_empty() {
                    out.extend(self.feed(tail));
                }
            } else {
                self.buf = Some(format!("{rest}\n"));
            }
            return out;
        }
        if line.trim().is_empty() {
            return vec![];
        }
        vec![self.plain(line)]
    }

    /// Rest im Puffer ausgeben (Prozessende).
    pub fn flush(&mut self) -> Vec<Parsed> {
        match self.buf.take() {
            Some(b) => b.lines().filter(|l| !l.trim().is_empty()).map(|l| self.plain(l)).collect(),
            None => vec![],
        }
    }

    fn finish_event(&mut self, xml: &str) -> Vec<Parsed> {
        let v = parse_event(xml);
        self.last = v.last().cloned();
        v
    }

    fn plain(&mut self, line: &str) -> Parsed {
        static RE: OnceLock<Regex> = OnceLock::new();
        let re = RE.get_or_init(|| {
            Regex::new(r"^\[(\d{2}:\d{2}:\d{2})(?:[.,]\d+)?\] \[([^\]]*?)/([A-Za-z]+)\](?: \[([^\]]+)\])?:? ?(.*)$").expect("regex")
        });
        if let Some(c) = re.captures(line) {
            if let Some(level) = level_from(&c[3]) {
                let p = Parsed {
                    time: Some(c[1].to_string()),
                    level,
                    thread: Some(c[2].to_string()),
                    logger: c.get(4).map(|m| m.as_str().to_string()),
                    text: c[5].to_string(),
                };
                self.last = Some(p.clone());
                return p;
            }
        }
        // Fortsetzung eines Stacktraces: Metadaten der vorigen Zeile übernehmen
        let t = line.trim_start();
        let continuation = line.starts_with('\t') || t.starts_with("at ") || t.starts_with("Caused by:") || t.starts_with("... ");
        if continuation {
            if let Some(last) = &self.last {
                return Parsed { text: line.to_string(), ..last.clone() };
            }
        }
        let p = Parsed {
            time: Some(chrono::Local::now().format("%H:%M:%S").to_string()),
            level: if self.stderr { LogLevel::Stderr } else { LogLevel::Stdout },
            thread: None,
            logger: None,
            text: line.to_string(),
        };
        self.last = Some(p.clone());
        p
    }
}

/// Bytes einer Ausgabezeile dekodieren (UTF-8, sonst Latin-1/Windows-1252-nah).
pub fn decode_line(bytes: &[u8]) -> String {
    match std::str::from_utf8(bytes) {
        Ok(s) => s.to_string(),
        Err(_) => bytes.iter().map(|&b| b as char).collect(),
    }
}

// ------------------------------------------------------------------ Dateien
