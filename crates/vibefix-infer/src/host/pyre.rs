use std::sync::Arc;

enum Engine {
    Plain(regex::Regex),
    Fancy(fancy_regex::Regex),
}

pub struct Py {
    engine: Engine,
    names: Arc<Vec<Option<String>>>,
    needles: Vec<String>,
}

pub struct Hay<'t> {
    pub text: &'t str,
    folded: String,
}

fn fold_char(c: char) -> char {
    match c {
        '\u{212A}' => 'k',
        '\u{17F}' => 's',
        '\u{130}' | '\u{131}' => 'i',
        _ => c.to_ascii_lowercase(),
    }
}

impl<'t> Hay<'t> {
    pub fn new(text: &'t str) -> Self {
        Self { text, folded: text.chars().map(fold_char).collect() }
    }

    pub fn has(&self, needle: &str) -> bool {
        self.folded.contains(needle)
    }
}

#[derive(Clone, Copy)]
pub struct M<'t> {
    text: &'t str,
    start: usize,
    end: usize,
}

impl<'t> M<'t> {
    pub fn start(&self) -> usize {
        self.start
    }

    pub fn end(&self) -> usize {
        self.end
    }

    pub fn as_str(&self) -> &'t str {
        &self.text[self.start..self.end]
    }
}

pub struct Caps<'t> {
    text: &'t str,
    spans: Vec<Option<(usize, usize)>>,
    names: Arc<Vec<Option<String>>>,
}

impl<'t> Caps<'t> {
    pub fn get(&self, i: usize) -> Option<M<'t>> {
        self.spans.get(i).copied().flatten().map(|(start, end)| M { text: self.text, start, end })
    }

    pub fn name(&self, name: &str) -> Option<M<'t>> {
        let i = self.names.iter().position(|n| n.as_deref() == Some(name))?;
        self.get(i)
    }
}

impl std::ops::Index<usize> for Caps<'_> {
    type Output = str;

    fn index(&self, i: usize) -> &str {
        self.get(i).map_or("", |m| m.as_str())
    }
}

fn translate(pattern: &str) -> String {
    let chars: Vec<char> = pattern.chars().collect();
    let mut out = String::with_capacity(pattern.len() + 8);
    let mut class = false;
    let mut first = false;
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        if c == '\\' && i + 1 < chars.len() {
            let next = chars[i + 1];
            if next.is_ascii_punctuation() && !r"\.+*?()|[]{}^$#&-~".contains(next) {
                out.push(next);
            } else {
                out.push(c);
                out.push(next);
            }
            i += 2;
            first = false;
            continue;
        }
        if class {
            let doubled = matches!(c, '&' | '~' | '-') && chars.get(i + 1) == Some(&c);
            if c == ']' && !first {
                class = false;
                out.push(c);
            } else if c == '[' || (c == ']' && first) || doubled {
                out.push('\\');
                out.push(c);
            } else {
                out.push(c);
            }
            first = false;
        } else {
            out.push(c);
            if c == '[' {
                class = true;
                first = true;
                if chars.get(i + 1) == Some(&'^') {
                    out.push('^');
                    i += 1;
                }
            }
        }
        i += 1;
    }
    out
}

impl Py {
    pub fn new(pattern: &str) -> Self {
        let translated = translate(pattern);
        let (engine, names): (Engine, Vec<Option<String>>) = match regex::Regex::new(&translated) {
            Ok(re) => {
                let names = re.capture_names().map(|n| n.map(str::to_owned)).collect();
                (Engine::Plain(re), names)
            }
            Err(_) => {
                let re = fancy_regex::Regex::new(&translated).unwrap_or_else(|e| panic!("Muster {pattern}: {e}"));
                let names = re.capture_names().map(|n| n.map(str::to_owned)).collect();
                (Engine::Fancy(re), names)
            }
        };
        Self { engine, names: Arc::new(names), needles: Vec::new() }
    }

    pub fn needing(mut self, needles: &[&str]) -> Self {
        self.needles = needles.iter().map(|n| (*n).to_owned()).collect();
        self
    }

    fn possible(&self, hay: &Hay<'_>) -> bool {
        self.needles.is_empty() || self.needles.iter().any(|n| hay.has(n))
    }

    pub fn search_in<'t>(&self, hay: &Hay<'t>) -> Option<Caps<'t>> {
        if self.possible(hay) {
            self.search(hay.text)
        } else {
            None
        }
    }

    pub fn is_match_in(&self, hay: &Hay<'_>) -> bool {
        self.possible(hay) && self.is_match(hay.text)
    }

    pub fn iter_in<'t>(&self, hay: &Hay<'t>) -> Vec<Caps<'t>> {
        if self.possible(hay) {
            self.iter(hay.text)
        } else {
            Vec::new()
        }
    }

    pub fn full(pattern: &str) -> Self {
        Self::new(&format!(r"\A(?:{pattern})\z"))
    }

    pub fn anchored(pattern: &str) -> Self {
        Self::new(&format!(r"\A(?:{pattern})"))
    }

    pub fn search_at<'t>(&self, text: &'t str, pos: usize) -> Option<Caps<'t>> {
        let spans = match &self.engine {
            Engine::Plain(re) => {
                let caps = re.captures_at(text, pos)?;
                (0..caps.len()).map(|i| caps.get(i).map(|m| (m.start(), m.end()))).collect()
            }
            Engine::Fancy(re) => {
                let caps = re.captures_from_pos(text, pos).ok().flatten()?;
                (0..caps.len()).map(|i| caps.get(i).map(|m| (m.start(), m.end()))).collect()
            }
        };
        Some(Caps { text, spans, names: self.names.clone() })
    }

    pub fn search<'t>(&self, text: &'t str) -> Option<Caps<'t>> {
        self.search_at(text, 0)
    }

    pub fn is_match(&self, text: &str) -> bool {
        match &self.engine {
            Engine::Plain(re) => re.is_match(text),
            Engine::Fancy(re) => re.is_match(text).unwrap_or(false),
        }
    }

    pub fn iter<'t>(&self, text: &'t str) -> Vec<Caps<'t>> {
        let mut out = Vec::new();
        let mut pos = 0;
        while pos <= text.len() {
            let Some(caps) = self.search_at(text, pos) else { break };
            let (start, end) = caps.spans[0].unwrap();
            pos = if end > start { end } else { end + text[end..].chars().next().map_or(1, char::len_utf8) };
            out.push(caps);
        }
        out
    }

    pub fn group<'t>(&self, text: &'t str, index: usize) -> Option<&'t str> {
        self.search(text).and_then(|c| c.get(index)).map(|m| m.as_str())
    }

    pub fn names(&self) -> Vec<String> {
        self.names.iter().flatten().cloned().collect()
    }
}

#[cfg(test)]
mod tests {
    use super::translate;

    #[test]
    fn escapes_python_only_class_syntax() {
        assert_eq!(translate(r"[^][+\s]+"), r"[^\]\[+\s]+");
        assert_eq!(translate(r"[\w.-]"), r"[\w.-]");
        assert_eq!(translate(r"[a--]"), r"[a\--]");
        assert_eq!(translate(r#"config[\/]["\:]"#), r#"config[/][":]"#);
    }
}
