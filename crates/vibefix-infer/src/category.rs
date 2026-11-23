use crate::unicode::{fold_prefix, is_digit, is_space, is_word, skip_space, strip};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Category {
    Heading,
    Exception,
    Other,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ExceptionMatch<'a> {
    pub relation: Option<&'a str>,
    pub kind: &'a str,
    pub message: Option<&'a str>,
}

const MARKERS: [&str; 5] = ["Exception", "Error", "Throwable", "Caused by:", "Suppressed:"];
const SUFFIXES: [&str; 4] = ["Exception", "Error", "Throwable", "ExceptionInfo"];

fn run(text: &str, from: usize, keep: impl Fn(char) -> bool) -> usize {
    match text[from..].char_indices().find(|&(_, c)| !keep(c)) {
        Some((i, _)) => from + i,
        None => text.len(),
    }
}

pub fn section_name(stripped: &str) -> Option<&str> {
    let ok = stripped.len() >= 6 && stripped.starts_with("-- ") && stripped.ends_with(" --");
    ok.then(|| &stripped[3..stripped.len() - 3])
}

pub fn mod_header(text: &str) -> bool {
    if let Some(at) = fold_prefix(text, "loading ") {
        let end = run(text, at, is_digit);
        if end > at && fold_prefix(&text[end..], " mods:").is_some() {
            return true;
        }
    }
    ["mod list:", "fabric mods:", "quilt mods:"].iter().any(|p| fold_prefix(text, p).is_some())
}

pub fn is_heading(message: &str) -> bool {
    let text = strip(message);
    section_name(text).is_some() || mod_header(text)
}

pub fn stack(message: &str) -> bool {
    let at = skip_space(message, 0);
    let text = &message[at..];
    if let Some(rest) = text.strip_prefix("at ") {
        let end = run(rest, 0, |c| is_word(c) || matches!(c, '.' | '$' | '/' | '<' | '>'));
        return end > 0 && rest[end..].starts_with('(');
    }
    if text.starts_with("Caused by:") || text.starts_with("Suppressed:") {
        return true;
    }
    if let Some(rest) = text.strip_prefix("... ") {
        let end = run(rest, 0, is_digit);
        return end > 0 && (rest[end..].starts_with(" more") || rest[end..].starts_with(" common frames"));
    }
    false
}

fn type_tail(text: &str, from: usize, relation: bool) -> Option<(usize, Option<&str>)> {
    let end = run(text, from, |c| is_word(c) || c == '$' || c == '.');
    if end == from {
        return None;
    }
    let rest = &text[end..];
    let colon = rest.strip_prefix(':').and_then(|r| r.chars().next()).is_some_and(is_space);
    if !(rest.is_empty() || colon || rest.chars().all(is_space)) {
        return None;
    }
    let parts: Vec<&str> = text[from..end].split('.').collect();
    let (last, init) = parts.split_last().unwrap();
    let valid = !init.iter().any(|p| p.is_empty())
        && if relation { !last.is_empty() } else { SUFFIXES.iter().any(|s| last.ends_with(s)) };
    if !valid {
        return None;
    }
    let message = rest.strip_prefix(':').map(|r| &r[skip_space(r, 0)..]);
    Some((end, message))
}

fn exception_at(text: &str, at: usize) -> Option<ExceptionMatch<'_>> {
    let rest = &text[at..];
    for relation in ["Caused by", "Suppressed"] {
        if rest.starts_with(relation) && rest[relation.len()..].starts_with(':') {
            let from = skip_space(text, at + relation.len() + 1);
            if let Some((end, message)) = type_tail(text, from, true) {
                return Some(ExceptionMatch { relation: Some(relation), kind: &text[from..end], message });
            }
        }
    }
    if let Some(name) = rest.strip_prefix("Exception in thread \"") {
        let start = at + rest.len() - name.len();
        if let Some(close) = name.find('"').filter(|&i| i > 0) {
            let from = skip_space(text, start + close + 1);
            if let Some((end, message)) = type_tail(text, from, false) {
                return Some(ExceptionMatch { relation: None, kind: &text[from..end], message });
            }
        }
    }
    type_tail(text, at, false).map(|(end, message)| ExceptionMatch { relation: None, kind: &text[at..end], message })
}

pub fn exception(message: &str) -> Option<ExceptionMatch<'_>> {
    if !MARKERS.iter().any(|m| message.contains(m)) {
        return None;
    }
    let text = strip(message);
    exception_at(text, 0).or_else(|| text.match_indices(": ").find_map(|(i, _)| exception_at(text, i + 2)))
}

pub fn categorize(message: &str) -> Category {
    if is_heading(message) {
        Category::Heading
    } else if stack(message) || exception(message).is_some() {
        Category::Exception
    } else {
        Category::Other
    }
}
