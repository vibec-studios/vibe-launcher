//! Protokolle für die Crash-Analyse einlesen. Große Dateien werden zeilenweise gestreamt: behalten werden der Anfang,
//! alle verdächtigen Zeilen samt Folgezeilen (Stacktraces) und das Ende – mit den ursprünglichen Zeilennummern für
//! die Fundstelle.
use std::collections::VecDeque;
use std::io::{BufRead, BufReader, Read};
use std::path::Path;

/// Bis zu dieser Größe wird eine Datei vollständig gelesen.
const FULL_LIMIT: u64 = 4 << 20;
const HEAD_LINES: u32 = 400;
const TAIL_LINES: usize = 2000;
/// Folgezeilen nach einer verdächtigen Zeile (Stacktrace, „Caused by“-Kette)
const CONTEXT_LINES: u32 = 60;
/// Obergrenze der behaltenen Zeilen aus der Mitte
const MAX_KEPT: usize = 40_000;
const MAX_LINE: usize = 16 * 1024;

/// Ein ausgewertetes Protokoll (Crash-Report, latest.log, Konsolenausgabe …).
#[derive(Debug, Clone)]
pub struct LogText {
    /// Anzeigename der Fundstelle, z. B. `logs/latest.log`
    pub name: String,
    pub text: String,
    /// Ursprüngliche Zeilennummer je Textzeile (leer = fortlaufend ab 1)
    lines: Vec<u32>,
}

impl LogText {
    pub fn new(name: impl Into<String>, text: &str) -> LogText {
        // Windows-Zeilenenden vereinheitlichen (Zeilennummern bleiben gleich)
        let text = if text.contains('\r') { text.replace("\r\n", "\n") } else { text.to_string() };
        LogText { name: name.into(), text: strip_codes(&text), lines: vec![] }
    }

    /// Zeilennummer (ab 1) zur Byte-Position im Text.
    pub fn line_no(&self, byte: usize) -> u32 {
        let idx = self.text.as_bytes()[..byte.min(self.text.len())].iter().filter(|b| **b == b'\n').count();
        if self.lines.is_empty() {
            idx as u32 + 1
        } else {
            self.lines.get(idx).copied().unwrap_or(idx as u32 + 1)
        }
    }

    /// Datei lesen (große Dateien gestreamt). `None`, wenn sie fehlt oder leer ist.
    pub fn read(path: &Path, name: impl Into<String>) -> Option<LogText> {
        let f = std::fs::File::open(path).ok()?;
        let len = f.metadata().ok()?.len();
        if len == 0 {
            return None;
        }
        let name = name.into();
        if len <= FULL_LIMIT {
            let mut b = Vec::with_capacity(len as usize);
            BufReader::new(f).read_to_end(&mut b).ok()?;
            return Some(LogText::new(name, &String::from_utf8_lossy(&b)));
        }
        Some(stream(BufReader::new(f), name))
    }
}

/// Minecraft-Farbcodes (`§a`) entfernen – NeoForge schreibt Ladefehler damit ins Log.
fn strip_codes(s: &str) -> String {
    if !s.contains('§') {
        return s.to_string();
    }
    let mut out = String::with_capacity(s.len());
    let mut it = s.chars();
    while let Some(c) = it.next() {
        if c == '§' {
            it.next();
        } else {
            out.push(c);
        }
    }
    out
}

/// Günstiger Vorfilter: Zeilen, in denen eine Regel überhaupt treffen kann.
fn suspicious(l: &str) -> bool {
    const KEYS: &[&str] = &[
        "Exception", "Error", "ERROR", "FATAL", "rror:", "Caused by", "requires", "missing", "Mixin", "mixin",
        "conflict", "Mod ID", "uplicate", "share ID", "multiple times", "OutOfMemory", "GLFW", "OpenGL", "WGL",
        "Pixel format", "class file", "config", "Suspected", "Failed", "failed", "ncompatible", "Currently,",
        "cannot be loaded", "heap", "insufficient memory", "# ", ".dll", "TRANSFORMER/", "Unterminated", "Expected",
    ];
    KEYS.iter().any(|k| l.contains(k))
}

fn stream<R: BufRead>(mut r: R, name: String) -> LogText {
    let mut kept: Vec<(u32, String)> = vec![];
    let mut tail: VecDeque<(u32, String)> = VecDeque::with_capacity(TAIL_LINES + 1);
    let mut buf = Vec::new();
    let mut n: u32 = 0;
    let mut ctx: u32 = 0;
    loop {
        buf.clear();
        match r.read_until(b'\n', &mut buf) {
            Ok(0) | Err(_) => break,
            Ok(_) => {}
        }
        n += 1;
        buf.truncate(MAX_LINE);
        let line = String::from_utf8_lossy(&buf).trim_end_matches(['\r', '\n']).to_string();
        let hit = suspicious(&line);
        if hit {
            ctx = CONTEXT_LINES;
        }
        if n <= HEAD_LINES || hit || ctx > 0 {
            if !hit && ctx > 0 {
                ctx -= 1;
            }
            kept.push((n, line));
            if kept.len() > MAX_KEPT {
                // Ältere Treffer aus der Mitte verwerfen (Anfang bleibt) – das Ende ist wichtiger
                let head = kept.iter().take_while(|(k, _)| *k <= HEAD_LINES).count();
                kept.drain(head..head + MAX_KEPT / 4);
            }
            continue;
        }
        tail.push_back((n, line));
        if tail.len() > TAIL_LINES {
            tail.pop_front();
        }
    }
    kept.extend(tail);
    kept.sort_by_key(|(k, _)| *k);
    let mut text = String::new();
    let mut lines = Vec::with_capacity(kept.len());
    for (k, l) in kept {
        text.push_str(&strip_codes(&l));
        text.push('\n');
        lines.push(k);
    }
    LogText { name, text, lines }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn streams_large_logs_and_keeps_line_numbers() {
        let mut s = String::new();
        for i in 1..=200_000u32 {
            if i == 123_456 {
                s.push_str("[main/ERROR]: java.lang.OutOfMemoryError: Java heap space\n");
            } else {
                s.push_str(&format!("[12:00:00] [Server thread/INFO]: Saving chunks for level 'ServerLevel[World]' {i}\n"));
            }
        }
        let t = stream(BufReader::new(s.as_bytes()), "logs/latest.log".into());
        assert!(t.text.len() < s.len() / 10, "{} von {}", t.text.len(), s.len());
        let pos = t.text.find("OutOfMemoryError").unwrap();
        assert_eq!(t.line_no(pos), 123_456);
        assert!(t.text.contains("level 'ServerLevel[World]' 200000"), "Ende bleibt erhalten");
        assert!(t.text.contains("level 'ServerLevel[World]' 1\n"), "Anfang bleibt erhalten");
    }

    #[test]
    fn windows_line_endings() {
        let t = LogText::new("x", "a\r\nb\r\nMod ID: 'x'\r\n");
        assert_eq!(t.text, "a\nb\nMod ID: 'x'\n");
        assert_eq!(t.line_no(t.text.find("Mod").unwrap()), 3);
    }

    #[test]
    fn strips_color_codes() {
        let t = LogText::new("x", "Mod §eSodium Extras§r requires §6sodium§r 0.6.0");
        assert_eq!(t.text, "Mod Sodium Extras requires sodium 0.6.0");
        assert_eq!(t.line_no(0), 1);
    }
}
