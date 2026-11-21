//! Log-Verarbeitung: Log4j-XML-Events (Konsolen-Layout von Mojangs Logging-Config) und Klartext,
//! Log-Dateien der Instanz, Upload zu mclo.gs.
use super::{LogFile, MclogsResult};
use crate::error::{AppError, AppResult};
use crate::feedback::redact;
use crate::state::AppState;
use std::path::Path;

pub use vibe_server_core::minecraft::logparse::*;


pub fn list_files(game_dir: &Path) -> Vec<LogFile> {
    let mut out = Vec::new();
    let mut scan = |sub: &str, kind: &str, accept: &dyn Fn(&str) -> bool| {
        let Ok(rd) = std::fs::read_dir(game_dir.join(sub)) else { return };
        for e in rd.flatten() {
            let name = e.file_name().to_string_lossy().to_string();
            let Ok(meta) = e.metadata() else { continue };
            if !meta.is_file() || !accept(&name.to_ascii_lowercase()) {
                continue;
            }
            let modified = meta
                .modified()
                .ok()
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_millis() as i64)
                .unwrap_or(0);
            out.push(LogFile { name: format!("{sub}/{name}"), size: meta.len(), modified, kind: kind.to_string() });
        }
    };
    scan("logs", "log", &|n| n.ends_with(".log") || n.ends_with(".log.gz") || n.ends_with(".txt"));
    scan("crash-reports", "crash", &|n| n.ends_with(".txt"));
    out.sort_by_key(|f| std::cmp::Reverse(f.modified));
    out
}

const MAX_READ: u64 = 64 * 1024 * 1024;

pub fn read_file(game_dir: &Path, name: &str) -> AppResult<String> {
    let norm = name.replace('\\', "/");
    if !(norm.starts_with("logs/") || norm.starts_with("crash-reports/")) {
        return Err(AppError::Invalid("Nur Dateien aus logs/ oder crash-reports/".into()));
    }
    let path = crate::util::safe_join(game_dir, &norm).ok_or_else(|| AppError::Invalid("Ungültiger Pfad".into()))?;
    let f = std::fs::File::open(&path).map_err(|_| AppError::NotFound(format!("Log-Datei {name}")))?;
    use std::io::Read;
    let mut buf = Vec::new();
    if norm.to_ascii_lowercase().ends_with(".gz") {
        flate2::read::GzDecoder::new(f).take(MAX_READ).read_to_end(&mut buf).map_err(|e| AppError::msg(format!("Log-Datei nicht entpackbar: {e}")))?;
    } else {
        f.take(MAX_READ).read_to_end(&mut buf)?;
    }
    Ok(match String::from_utf8(buf) {
        Ok(s) => s,
        Err(e) => decode_line(e.as_bytes()),
    })
}

// ------------------------------------------------------------------ mclo.gs

const MCLOGS_MAX_BYTES: usize = 10 * 1024 * 1024 - 64 * 1024;
const MCLOGS_MAX_LINES: usize = 25_000;

/// Auf die Limits von mclo.gs kürzen (Anfang + Ende behalten, Mitte auslassen).
pub fn truncate_for_mclogs(content: &str) -> String {
    let lines: Vec<&str> = content.lines().collect();
    let mut text = if lines.len() > MCLOGS_MAX_LINES {
        let head = 2_000;
        let tail = MCLOGS_MAX_LINES - head - 1;
        let skipped = lines.len() - head - tail;
        let mut v: Vec<String> = lines[..head].iter().map(|s| s.to_string()).collect();
        v.push(format!("[Vibe Launcher: {skipped} Zeilen ausgelassen]"));
        v.extend(lines[lines.len() - tail..].iter().map(|s| s.to_string()));
        v.join("\n")
    } else {
        content.to_string()
    };
    if text.len() > MCLOGS_MAX_BYTES {
        let head_bytes = 256 * 1024;
        let mut h = head_bytes;
        while !text.is_char_boundary(h) {
            h -= 1;
        }
        let mut t = text.len() - (MCLOGS_MAX_BYTES - head_bytes - 100);
        while !text.is_char_boundary(t) {
            t += 1;
        }
        text = format!("{}\n[Vibe Launcher: Log gekürzt]\n{}", &text[..h], &text[t..]);
    }
    text
}

pub fn prepare_for_mclogs(content: &str, known: &redact::Known) -> String {
    truncate_for_mclogs(&redact::redact(content, known).text)
}

pub async fn mclogs_upload(state: &AppState, content: &str) -> AppResult<MclogsResult> {
    if content.trim().is_empty() {
        return Err(AppError::Invalid("Das Log ist leer".into()));
    }
    let text = prepare_for_mclogs(content, &redact::Known::from_env());
    let resp = state
        .net
        .client
        .post("https://api.mclo.gs/1/log")
        .form(&[("content", text)])
        .send()
        .await
        .map_err(|e| AppError::msg(format!("mclo.gs ist nicht erreichbar: {e}")))?;
    let status = resp.status();
    let v: serde_json::Value = resp.json().await.map_err(|e| AppError::msg(format!("mclo.gs: ungültige Antwort ({status}): {e}")))?;
    if v["success"].as_bool() != Some(true) {
        let err = v["error"].as_str().unwrap_or("unbekannter Fehler");
        return Err(AppError::msg(format!("Upload zu mclo.gs fehlgeschlagen: {err}")));
    }
    let id = v["id"].as_str().unwrap_or_default().to_string();
    Ok(MclogsResult {
        url: v["url"].as_str().map(str::to_string).unwrap_or_else(|| format!("https://mclo.gs/{id}")),
        raw: v["raw"].as_str().map(str::to_string).unwrap_or_else(|| format!("https://api.mclo.gs/1/raw/{id}")),
        id,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::minecraft::LogLevel;

    #[test]
    fn xml_event_single_and_multi() {
        let mut p = LineParser::new(false);
        let out = p.feed(r#"<log4j:Event logger="net.minecraft.client.Minecraft" timestamp="1700000000000" level="INFO" thread="Render thread">"#);
        assert!(out.is_empty());
        assert!(p.feed(r#"  <log4j:Message><![CDATA[Setting user: Steve]]></log4j:Message>"#).is_empty());
        let out = p.feed("</log4j:Event>");
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].text, "Setting user: Steve");
        assert_eq!(out[0].level, LogLevel::Info);
        assert_eq!(out[0].thread.as_deref(), Some("Render thread"));
        assert_eq!(out[0].logger.as_deref(), Some("net.minecraft.client.Minecraft"));
        assert!(out[0].time.is_some());

        let xml = "<log4j:Event logger=\"x\" timestamp=\"1\" level=\"ERROR\" thread=\"main\">\n<log4j:Message><![CDATA[Boom]]></log4j:Message>\n<log4j:Throwable><![CDATA[java.lang.RuntimeException: x\n\tat a.b(C.java:1)\n]]></log4j:Throwable>\n</log4j:Event>";
        let mut all = Vec::new();
        for l in xml.lines() {
            all.extend(p.feed(l));
        }
        assert_eq!(all.len(), 3);
        assert!(all.iter().all(|l| l.level == LogLevel::Error));
        assert_eq!(all[1].text, "java.lang.RuntimeException: x");
        assert_eq!(all[2].text, "\tat a.b(C.java:1)");
    }

    #[test]
    fn xml_escaped_and_split_cdata() {
        let v = parse_event(r#"<log4j:Event logger="a&amp;b" timestamp="1" level="WARN" thread="t"><log4j:Message><![CDATA[x ]]]]><![CDATA[> y]]></log4j:Message></log4j:Event>"#);
        assert_eq!(v[0].text, "x ]]> y");
        assert_eq!(v[0].logger.as_deref(), Some("a&b"));
        let v = parse_event(r#"<log4j:Event logger="a" timestamp="1" level="DEBUG" thread="t"><log4j:Message>1 &lt; 2</log4j:Message></log4j:Event>"#);
        assert_eq!(v[0].text, "1 < 2");
        assert_eq!(v[0].level, LogLevel::Debug);
    }

    #[test]
    fn plain_lines() {
        let mut p = LineParser::new(false);
        let l = &p.feed("[12:34:56] [main/WARN]: Something")[0];
        assert_eq!(l.level, LogLevel::Warn);
        assert_eq!(l.time.as_deref(), Some("12:34:56"));
        assert_eq!(l.thread.as_deref(), Some("main"));
        let l = &p.feed("[12:34:56.789] [Render thread/INFO] [net.minecraft.Foo]: Hello")[0];
        assert_eq!(l.logger.as_deref(), Some("net.minecraft.Foo"));
        assert_eq!(l.text, "Hello");
        let l = &p.feed("\tat foo.Bar(Bar.java:1)")[0];
        assert_eq!(l.level, LogLevel::Info);
        let mut e = LineParser::new(true);
        assert_eq!(e.feed("random text")[0].level, LogLevel::Stderr);
        assert_eq!(LineParser::new(false).feed("hello")[0].level, LogLevel::Stdout);
    }

    #[test]
    fn mclogs_truncation() {
        let big: String = (0..30_000).map(|i| format!("line {i}\n")).collect();
        let t = truncate_for_mclogs(&big);
        assert!(t.lines().count() <= MCLOGS_MAX_LINES);
        assert!(t.starts_with("line 0\n"));
        assert!(t.trim_end().ends_with("line 29999"));
        assert_eq!(truncate_for_mclogs("short"), "short");
    }

    #[test]
    fn mclogs_upload_is_redacted() {
        let known = redact::Known { users: vec!["henny".into()], hosts: vec!["DESKTOP-XYZ".into()] };
        let raw = [
            "Launching with --accessToken eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghij --uuid 0123",
            r"Loading C:\Users\henny\AppData\Roaming\x.jar on DESKTOP-XYZ",
            "Session token:abcdefghijklmnop:0123456789abcdef0123456789abcdef",
        ]
        .join("\n");
        let raw = raw.as_str();
        let t = prepare_for_mclogs(raw, &known);
        assert!(!t.contains("eyJhbGci"));
        assert!(!t.contains("abcdefghijklmnop"));
        assert!(!t.to_lowercase().contains("henny"));
        assert!(!t.contains("DESKTOP-XYZ"));
        assert!(t.contains("--accessToken"));
    }
}
