#[derive(Debug, Clone, PartialEq)]
enum Line {
    Pair(String, String),
    Raw(String),
}

#[derive(Debug, Clone, PartialEq)]
pub struct Doc {
    sep: char,
    lines: Vec<Line>,
    trailing: bool,
}

fn pair(line: &str, sep: char) -> Option<(String, String)> {
    if line.trim().is_empty() || line.starts_with('#') {
        return None;
    }
    let (k, v) = line.split_once(sep)?;
    (!k.is_empty() && k.trim() == k).then(|| (k.to_string(), v.to_string()))
}

impl Doc {
    pub fn empty(sep: char) -> Doc {
        Doc { sep, lines: vec![], trailing: true }
    }

    pub fn parse(text: &str, sep: char) -> Doc {
        let trailing = text.is_empty() || text.ends_with('\n');
        let body = text.strip_suffix('\n').unwrap_or(text);
        let body = body.strip_suffix('\r').unwrap_or(body);
        let lines = if body.is_empty() {
            vec![]
        } else {
            body.split('\n')
                .map(|raw| {
                    let raw = raw.strip_suffix('\r').unwrap_or(raw);
                    pair(raw, sep).map(|(k, v)| Line::Pair(k, v)).unwrap_or_else(|| Line::Raw(raw.to_string()))
                })
                .collect()
        };
        Doc { sep, lines, trailing }
    }

    pub fn render(&self) -> String {
        let mut out: Vec<String> = Vec::with_capacity(self.lines.len());
        for l in &self.lines {
            out.push(match l {
                Line::Pair(k, v) => format!("{k}{}{v}", self.sep),
                Line::Raw(r) => r.clone(),
            });
        }
        let mut s = out.join("\n");
        if self.trailing && !s.is_empty() {
            s.push('\n');
        }
        s
    }

    pub fn get(&self, key: &str) -> Option<&str> {
        self.lines.iter().find_map(|l| match l {
            Line::Pair(k, v) if k == key => Some(v.as_str()),
            _ => None,
        })
    }

    fn set(&mut self, key: &str, value: &str) {
        for l in self.lines.iter_mut() {
            if let Line::Pair(k, v) = l {
                if k == key {
                    *v = value.to_string();
                    return;
                }
            }
        }
        self.lines.push(Line::Pair(key.to_string(), value.to_string()));
    }

    pub fn apply(&mut self, other: &Doc, skip: &[String]) -> bool {
        let mut changed = false;
        for l in &other.lines {
            let Line::Pair(k, v) = l else { continue };
            if skip.iter().any(|s| s == k) || self.get(k) == Some(v.as_str()) {
                continue;
            }
            self.set(k, v);
            changed = true;
        }
        changed
    }
}

pub fn separator(format: Option<&str>) -> char {
    if format == Some("plain_key_value") {
        '='
    } else {
        ':'
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn merge_keeps_local_keys_and_order() {
        let mut own = Doc::parse("fov:0.5\nresourcePacks:[\"vanilla\",\"file/Mine.zip\"]\nguiScale:2\n", ':');
        let master = Doc::parse("fov:0.9\nresourcePacks:[\"vanilla\"]\nrenderDistance:16\n", ':');
        assert!(own.apply(&master, &["resourcePacks".to_string()]));
        assert_eq!(own.render(), "fov:0.9\nresourcePacks:[\"vanilla\",\"file/Mine.zip\"]\nguiScale:2\nrenderDistance:16\n");
        assert!(!own.apply(&master, &["resourcePacks".to_string()]));
        let mut kv = Doc::parse("# c\na=1", '=');
        kv.apply(&Doc::parse("a=2\nb=3\n", '='), &[]);
        assert_eq!(kv.render(), "# c\na=2\nb=3");
        assert_eq!(separator(Some("plain_key_value")), '=');
        assert_eq!(Doc::empty(':').render(), "");
    }
}
