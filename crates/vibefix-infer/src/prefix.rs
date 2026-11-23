use crate::unicode::{is_digit, is_space, skip_space};

const LEVELS: [&str; 7] = ["TRACE", "DEBUG", "INFO", "WARN", "WARNING", "ERROR", "FATAL"];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Prefix<'a> {
    pub end: usize,
    pub thread: Option<&'a str>,
    pub level: Option<&'a str>,
}

fn first(text: &str, from: usize) -> Option<char> {
    text[from..].chars().next()
}

fn digits(text: &str, from: usize, count: usize) -> Option<usize> {
    let mut at = from;
    for _ in 0..count {
        let c = first(text, at).filter(|&c| is_digit(c))?;
        at += c.len_utf8();
    }
    Some(at)
}

fn literal(text: &str, from: usize, value: &str) -> Option<usize> {
    text[from..].starts_with(value).then_some(from + value.len())
}

fn run(text: &str, from: usize, keep: impl Fn(char) -> bool) -> usize {
    match text[from..].char_indices().find(|&(_, c)| !keep(c)) {
        Some((i, _)) => from + i,
        None => text.len(),
    }
}

fn date(text: &str) -> Option<usize> {
    let at = digits(text, 0, 4)?;
    let at = literal(text, at, "-")?;
    let at = digits(text, at, 2)?;
    let at = literal(text, at, "-")?;
    let at = digits(text, at, 2)?;
    let sep = first(text, at).filter(|&c| c == 'T' || c == ' ')?;
    let at = at + sep.len_utf8();
    let end = run(text, at, |c| !is_space(c));
    if end == at {
        return None;
    }
    let after = run(text, end, is_space);
    (after > end).then_some(after)
}

fn stamp(text: &str) -> Option<usize> {
    let at = literal(text, 0, "[")?;
    first(text, at).filter(|&c| is_digit(c))?;
    let close = at + text[at..].find(']')?;
    Some(skip_space(text, close + 1))
}

fn level_at(text: &str, from: usize, ok: impl Fn(&str, usize) -> Option<usize>) -> Option<(&str, usize)> {
    LEVELS.iter().find_map(|level| {
        let end = literal(text, from, level)?;
        ok(text, end).map(|after| (&text[from..end], after))
    })
}

fn bracketed(text: &str, from: usize) -> Option<Prefix<'_>> {
    let at = literal(text, from, "[")?;
    let slash = run(text, at, |c| c != ']' && c != '/');
    let after = literal(text, slash, "/")?;
    let (level, mut end) = level_at(text, after, |t, e| literal(t, e, "]"))?;
    let spaced = run(text, end, is_space);
    if spaced > end {
        if let Some(open) = literal(text, spaced, "[") {
            if let Some(close) = text[open..].find(']') {
                end = open + close + 1;
            }
        }
    }
    let mut end = skip_space(text, end);
    if let Some(colon) = literal(text, end, ":") {
        end = colon;
    }
    Some(Prefix { end: skip_space(text, end), thread: Some(&text[at..slash]), level: Some(level) })
}

fn bare(text: &str, from: usize) -> Option<Prefix<'_>> {
    let separators = |t: &str, e: usize| {
        let end = run(t, e, |c| c == ':' || c == ' ');
        (end > e).then_some(end)
    };
    let (level, end) = level_at(text, from, separators)?;
    Some(Prefix { end, thread: None, level: Some(level) })
}

pub fn parse(line: &str) -> Option<Prefix<'_>> {
    stamp(line)
        .and_then(|at| bracketed(line, at))
        .or_else(|| date(line).and_then(|at| bracketed(line, at)))
        .or_else(|| bracketed(line, 0))
        .or_else(|| date(line).and_then(|at| bare(line, at)))
        .or_else(|| bare(line, 0))
}
