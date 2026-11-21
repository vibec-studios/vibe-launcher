//! `server.properties` lesen/schreiben (Reihenfolge und Kommentare bleiben erhalten).
use crate::error::AppResult;
use std::path::Path;

fn unescape(s: &str) -> String {
    let mut out = String::new();
    let mut it = s.chars().peekable();
    while let Some(c) = it.next() {
        if c != '\\' {
            out.push(c);
            continue;
        }
        match it.next() {
            Some('n') => out.push('\n'),
            Some('t') => out.push('\t'),
            Some('r') => out.push('\r'),
            Some('u') => {
                let hex: String = it.by_ref().take(4).collect();
                match u32::from_str_radix(&hex, 16).ok().and_then(char::from_u32) {
                    Some(ch) => out.push(ch),
                    None => {
                        out.push_str("\\u");
                        out.push_str(&hex);
                    }
                }
            }
            Some(o) => out.push(o),
            None => {}
        }
    }
    out
}

fn escape_value(s: &str) -> String {
    let mut out = String::new();
    for (i, c) in s.chars().enumerate() {
        match c {
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            ':' => out.push_str("\\:"),
            '=' => out.push_str("\\="),
            ' ' if i == 0 => out.push_str("\\ "),
            c if (c as u32) > 0x7e => out.push_str(&format!("\\u{:04x}", c as u32)),
            c => out.push(c),
        }
    }
    out
}

fn split_line(line: &str) -> Option<(String, String)> {
    let t = line.trim_start();
    if t.is_empty() || t.starts_with('#') || t.starts_with('!') {
        return None;
    }
    let mut key = String::new();
    let mut chars = t.char_indices();
    let mut rest_start = t.len();
    let mut escaped = false;
    for (i, c) in chars.by_ref() {
        if escaped {
            key.push('\\');
            key.push(c);
            escaped = false;
            continue;
        }
        if c == '\\' {
            escaped = true;
            continue;
        }
        if c == '=' || c == ':' || c.is_whitespace() {
            rest_start = i;
            break;
        }
        key.push(c);
    }
    let mut rest = &t[rest_start.min(t.len())..];
    rest = rest.trim_start();
    if rest.starts_with('=') || rest.starts_with(':') {
        rest = rest[1..].trim_start();
    }
    Some((unescape(&key), unescape(rest)))
}

/// Alle Einträge in Datei-Reihenfolge.
pub fn parse(text: &str) -> Vec<(String, String)> {
    text.lines().filter_map(split_line).collect()
}

pub fn read(path: &Path) -> Vec<(String, String)> {
    std::fs::read_to_string(path).map(|t| parse(&t)).unwrap_or_default()
}

pub fn get(path: &Path, key: &str) -> Option<String> {
    read(path).into_iter().find(|(k, _)| k == key).map(|(_, v)| v)
}

/// Werte setzen: vorhandene Zeilen ersetzen, neue anhängen.
pub fn update_text(text: &str, values: &[(String, String)]) -> String {
    let mut done = vec![false; values.len()];
    let mut out: Vec<String> = Vec::new();
    for line in text.lines() {
        if let Some((k, _)) = split_line(line) {
            if let Some(i) = values.iter().position(|(vk, _)| *vk == k) {
                out.push(format!("{}={}", k, escape_value(&values[i].1)));
                done[i] = true;
                continue;
            }
        }
        out.push(line.to_string());
    }
    for (i, (k, v)) in values.iter().enumerate() {
        if !done[i] {
            out.push(format!("{}={}", k, escape_value(v)));
        }
    }
    let mut s = out.join("\n");
    s.push('\n');
    s
}

pub fn set(path: &Path, values: &[(String, String)]) -> AppResult<()> {
    let text = std::fs::read_to_string(path).unwrap_or_default();
    let new = update_text(&text, values);
    if let Some(p) = path.parent() {
        std::fs::create_dir_all(p)?;
    }
    std::fs::write(path, new)?;
    Ok(())
}

/// Standardwerte für neue Server.
pub fn defaults(port: u16, motd: &str) -> Vec<(String, String)> {
    vec![
        ("server-port".into(), port.to_string()),
        ("motd".into(), motd.to_string()),
        ("gamemode".into(), "survival".into()),
        ("difficulty".into(), "normal".into()),
        ("max-players".into(), "10".into()),
        ("pvp".into(), "true".into()),
        ("white-list".into(), "false".into()),
        ("enforce-whitelist".into(), "false".into()),
        ("online-mode".into(), "true".into()),
        ("view-distance".into(), "10".into()),
        ("simulation-distance".into(), "10".into()),
        ("spawn-protection".into(), "0".into()),
        ("level-name".into(), "world".into()),
        ("level-seed".into(), String::new()),
        ("enable-command-block".into(), "false".into()),
    ]
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn roundtrip() {
        let text = "#Minecraft server properties\n#Mon\nmotd=A Minecraft Server\nserver-port=25565\nlevel-seed=\nfoo\\:bar = x y\n";
        let p = parse(text);
        assert_eq!(p[0], ("motd".into(), "A Minecraft Server".into()));
        assert_eq!(p[2], ("level-seed".into(), "".into()));
        assert_eq!(p[3], ("foo:bar".into(), "x y".into()));
        let t = update_text(text, &[("server-port".into(), "25570".into()), ("pvp".into(), "false".into()), ("motd".into(), "Hallo Wörld: 1".into())]);
        assert!(t.starts_with("#Minecraft server properties\n#Mon\nmotd=Hallo W\\u00f6rld\\: 1\nserver-port=25570\n"));
        assert!(t.ends_with("pvp=false\n"));
        let p = parse(&t);
        assert_eq!(p[0].1, "Hallo Wörld: 1");
    }
}
