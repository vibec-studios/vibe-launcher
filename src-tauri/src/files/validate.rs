//! Syntaxprüfung für den Datei-Editor: JSON (Kommentare erlaubt), JSON5 (Kommentare + abschließende Kommas)
//! und TOML. Zeilen/Spalten sind 1-basiert und zählen Zeichen, nicht Bytes.
use serde::Serialize;

const BOM: char = '\u{feff}';

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct ValidationError {
    /// 1-basiert
    pub line: u32,
    /// 1-basiert (Zeichen, nicht Bytes)
    pub column: u32,
    pub message: String,
}

/// Syntax prüfen: JSON (Kommentare erlaubt), JSON5 (Kommentare + abschließende Kommas), TOML. Sonst keine Fehler.
pub fn validate(rel: &str, content: &str) -> Vec<ValidationError> {
    let content = content.strip_prefix(BOM).unwrap_or(content);
    if content.trim().is_empty() {
        return Vec::new();
    }
    match super::language_of(&rel.replace('\\', "/")) {
        "json" => validate_json(&strip_json(content, false), false),
        "json5" => validate_json(&strip_json(content, true), true),
        "toml" => validate_toml(content),
        _ => Vec::new(),
    }
}

/// Kommentare (`//`, `/* */`) und ggf. abschließende Kommas durch Leerzeichen ersetzen –
/// Zeilen und Spalten (in Zeichen) bleiben gleich.
pub fn strip_json(s: &str, trailing_commas: bool) -> String {
    let c: Vec<char> = s.chars().collect();
    let mut out = c.clone();
    let mut i = 0;
    let mut in_str: Option<char> = None;
    while i < c.len() {
        let ch = c[i];
        if let Some(q) = in_str {
            if ch == '\\' {
                i += 2;
                continue;
            }
            if ch == q || ch == '\n' {
                in_str = None;
            }
            i += 1;
            continue;
        }
        match ch {
            '"' => in_str = Some('"'),
            '\'' if trailing_commas => in_str = Some('\''),
            '/' if c.get(i + 1) == Some(&'/') => {
                while i < c.len() && c[i] != '\n' {
                    out[i] = ' ';
                    i += 1;
                }
                continue;
            }
            '/' if c.get(i + 1) == Some(&'*') => {
                out[i] = ' ';
                out[i + 1] = ' ';
                i += 2;
                while i < c.len() && !(c[i] == '*' && c.get(i + 1) == Some(&'/')) {
                    if c[i] != '\n' && c[i] != '\r' {
                        out[i] = ' ';
                    }
                    i += 1;
                }
                if i < c.len() {
                    out[i] = ' ';
                    if i + 1 < c.len() {
                        out[i + 1] = ' ';
                    }
                    i += 2;
                }
                continue;
            }
            _ => {}
        }
        i += 1;
    }
    if trailing_commas {
        // Zweiter Durchgang auf dem kommentarfreien Text
        let mut in_str: Option<char> = None;
        let mut i = 0;
        while i < out.len() {
            let ch = out[i];
            if let Some(q) = in_str {
                if ch == '\\' {
                    i += 2;
                    continue;
                }
                if ch == q || ch == '\n' {
                    in_str = None;
                }
            } else if ch == '"' || ch == '\'' {
                in_str = Some(ch);
            } else if ch == ',' {
                let next = out[i + 1..].iter().find(|c| !c.is_whitespace());
                if matches!(next, Some('}') | Some(']')) {
                    out[i] = ' ';
                }
            }
            i += 1;
        }
    }
    out.into_iter().collect()
}

/// serde_json-Spalte (Bytes) in Zeichen-Spalte umrechnen.
fn char_column(text: &str, line: usize, byte_col: usize) -> usize {
    let Some(l) = text.split('\n').nth(line.saturating_sub(1)) else { return byte_col };
    let mut end = byte_col.min(l.len());
    while end > 0 && !l.is_char_boundary(end) {
        end -= 1;
    }
    l[..end].chars().count().max(1)
}

fn json_message(raw: &str) -> String {
    let m = match raw.rfind(" at line ") {
        Some(i) => &raw[..i],
        None => raw,
    };
    if m.starts_with("EOF while parsing") {
        "Unerwartetes Dateiende – fehlt eine schließende Klammer oder ein Anführungszeichen?".to_string()
    } else if m == "trailing comma" {
        "Überflüssiges Komma vor der schließenden Klammer".to_string()
    } else if m == "expected `,` or `}`" {
        "„,“ oder „}“ erwartet – fehlt ein Komma?".to_string()
    } else if m == "expected `,` or `]`" {
        "„,“ oder „]“ erwartet – fehlt ein Komma?".to_string()
    } else if m == "expected `:`" {
        "„:“ erwartet".to_string()
    } else if m == "key must be a string" {
        "Schlüssel muss in doppelten Anführungszeichen stehen".to_string()
    } else if m == "expected value" {
        "Wert erwartet".to_string()
    } else if m == "expected ident" {
        "Ungültiger Wert (erlaubt: true, false, null, Zahl, \"Text\")".to_string()
    } else if m == "trailing characters" {
        "Zusätzliche Zeichen nach dem Ende des Dokuments".to_string()
    } else if m.starts_with("control character") {
        "Steuerzeichen in Zeichenkette (Zeilenumbruch in \"…\"?)".to_string()
    } else if m == "invalid escape" {
        "Ungültige Escape-Sequenz".to_string()
    } else if m == "invalid number" {
        "Ungültige Zahl".to_string()
    } else {
        format!("JSON-Fehler: {m}")
    }
}

fn validate_json(text: &str, json5: bool) -> Vec<ValidationError> {
    match serde_json::from_str::<serde_json::Value>(text) {
        Ok(_) => Vec::new(),
        Err(e) => {
            let raw = e.to_string();
            let line = e.line().max(1);
            let col = char_column(text, line, e.column());
            if json5 {
                // JSON5-Erweiterungen (Schlüssel ohne Anführungszeichen, '…', Hex, Infinity …) nicht als Fehler melden
                let at = text.split('\n').nth(line - 1).and_then(|l| l.chars().nth(col.saturating_sub(1)));
                let ext = raw.starts_with("key must be a string")
                    || matches!(at, Some('\'') | Some('+') | Some('.'))
                    || at.is_some_and(|c| c.is_alphabetic() || c == '_' || c == '$')
                    || raw.starts_with("invalid number");
                if ext {
                    return Vec::new();
                }
            }
            vec![ValidationError { line: line as u32, column: col as u32, message: json_message(&raw) }]
        }
    }
}

fn validate_toml(text: &str) -> Vec<ValidationError> {
    match text.parse::<toml::Table>() {
        Ok(_) => Vec::new(),
        Err(e) => {
            let (line, column) = match e.span() {
                Some(sp) => {
                    let start = sp.start.min(text.len());
                    let mut s = start;
                    while s > 0 && !text.is_char_boundary(s) {
                        s -= 1;
                    }
                    let before = &text[..s];
                    let line = before.matches('\n').count() + 1;
                    let col = before.rsplit('\n').next().map(|l| l.chars().count()).unwrap_or(0) + 1;
                    (line, col)
                }
                None => (1, 1),
            };
            let m = e.message().trim().replace('\n', " – ").replace(" in table ", " in Tabelle ");
            let msg = if let Some(k) = m.strip_prefix("duplicate key ") {
                format!("Doppelter Schlüssel {k}")
            } else {
                format!("TOML-Fehler: {m}")
            };
            vec![ValidationError { line: line as u32, column: column as u32, message: msg }]
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validation() {
        assert!(validate("config/a.json", "{\"a\": 1}").is_empty());
        assert!(validate("config/a.json", "  ").is_empty());
        assert!(validate("config/a.json", "// Kommentar\n{\"a\": /* x */ 1}").is_empty());
        let e = validate("config/a.json", "{\n  \"a\": 1\n  \"b\": 2\n}");
        assert_eq!(e.len(), 1);
        assert_eq!(e[0].line, 3);
        assert_eq!(e[0].column, 3);
        let e = validate("config/a.json", "{\"a\": 1,}");
        assert_eq!(e.len(), 1);
        // JSON5: Kommentare und abschließende Kommas erlaubt, echte Fehler bleiben
        assert!(validate("config/a.json5", "{\n // c\n \"a\": [1, 2,],\n}").is_empty());
        assert!(validate("config/a.json5", "{ a: 1 }").is_empty());
        assert_eq!(validate("config/a.json5", "{\"a\": 1 \"b\": 2}").len(), 1);
        // "//" in Strings ist kein Kommentar
        assert!(validate("config/a.json", "{\"url\": \"https://x.y\"}").is_empty());
        // TOML
        assert!(validate("config/a.toml", "[general]\nx = 1\ny = \"z\"\n").is_empty());
        let e = validate("config/a.toml", "[general]\nx = 1\nx = 2\n");
        assert_eq!(e.len(), 1);
        assert_eq!(e[0].line, 3);
        let e = validate("config/a.toml", "a = \n");
        assert_eq!(e.len(), 1);
        assert_eq!(e[0].line, 1);
        // Andere Formate: nie Fehler
        assert!(validate("config/a.properties", "{{{").is_empty());
        // Spalten in Zeichen (Umlaute)
        let e = validate("config/a.json", "{\"ä\": 1 \"b\": 2}");
        // `{"ä": 1 "b": 2}` – das zweite `"` ist das 9. Zeichen (Byte-Spalte wäre 10)
        assert_eq!(e[0].column, 9);
    }
}
