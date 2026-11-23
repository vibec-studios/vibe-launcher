use std::sync::LazyLock;

use regex::bytes::Regex as AsciiRegex;
use regex::Regex;

use crate::category::Category;
use crate::features::feature_ids;
use crate::normalize::normalize;
use crate::segment::{row, split_lines, Row};
use crate::unicode::{dotted_i, is_word, strip};
use crate::LogFile;

const IMPORTANT_SOURCE: &str = concat!(
    r"caused by:|exception in thread|failure message|problematic frame|incompatible mods|outofmemoryerror|",
    r"could not reserve|unsupportedclassversionerror|crash report|missing mandatory|description:|duplicate mod"
);
const SECONDARY_SOURCE: &str = r"exception|error|failed|missing|invalid|mod resolution|conflict";

struct Pattern {
    unicode: Regex,
    ascii: AsciiRegex,
}

impl Pattern {
    fn new(source: &str) -> Self {
        Self {
            unicode: Regex::new(&format!("(?i){source}")).unwrap(),
            ascii: AsciiRegex::new(&format!("(?i-u){source}")).unwrap(),
        }
    }

    fn find_at(&self, text: &str, from: usize) -> Option<(usize, usize)> {
        if text.is_ascii() {
            self.ascii.find_at(text.as_bytes(), from).map(|m| (m.start(), m.end()))
        } else {
            self.unicode.find_at(text, from).map(|m| (m.start(), m.end()))
        }
    }
}

static IMPORTANT: LazyLock<Pattern> = LazyLock::new(|| Pattern::new(IMPORTANT_SOURCE));
static REQUIRES: LazyLock<[Pattern; 2]> =
    LazyLock::new(|| [Pattern::new("requires "), Pattern::new("missing|version")]);
static MIXIN: LazyLock<[Pattern; 2]> = LazyLock::new(|| [Pattern::new("mixin"), Pattern::new("failed|conflict")]);
static SECONDARY: LazyLock<Pattern> = LazyLock::new(|| Pattern::new(SECONDARY_SOURCE));

const IMPORTANT_TERMS: [&str; 14] = [
    "caused by:",
    "exception in thread",
    "requires ",
    "failure message",
    "problematic frame",
    "incompatible mods",
    "outofmemoryerror",
    "could not reserve",
    "unsupportedclassversionerror",
    "crash report",
    "mixin",
    "missing mandatory",
    "description:",
    "duplicate mod",
];
const SECONDARY_TERMS: [&str; 7] = ["exception", "error", "failed", "missing", "invalid", "mod resolution", "conflict"];

#[derive(Debug, Clone, PartialEq)]
pub struct Line {
    pub file: String,
    pub number: usize,
    pub text: String,
    pub features: [u32; 4],
    pub start_byte: usize,
}

fn window(text: &str, pair: &[Pattern; 2], limit: usize) -> bool {
    let mut from = 0;
    while let Some((_, end)) = pair[0].find_at(text, from) {
        let Some((start, _)) = pair[1].find_at(text, end) else { return false };
        let gap = if text.is_ascii() { start - end } else { text[end..start].chars().count() };
        if gap <= limit {
            return true;
        }
        from = end;
    }
    false
}

fn important(text: &str) -> bool {
    IMPORTANT.find_at(text, 0).is_some() || window(text, &REQUIRES, 200) || window(text, &MIXIN, 100)
}

fn bounded(text: &str) -> bool {
    let mut from = 0;
    while let Some((start, end)) = SECONDARY.find_at(text, from) {
        let before = text[..start].chars().next_back().is_some_and(is_word);
        let after = text[end..].chars().next().is_some_and(is_word);
        if !before && !after {
            return true;
        }
        from = start + text[start..].chars().next().map_or(1, char::len_utf8);
    }
    false
}

fn signal(text: &str, terms: &[&str], test: impl Fn(&str) -> bool) -> bool {
    if text.is_ascii() {
        let lower = text.to_ascii_lowercase();
        return terms.iter().any(|t| lower.contains(t)) && test(text);
    }
    test(&dotted_i(text))
}

pub fn priority(row: &Row<'_>) -> u8 {
    let text = row.message;
    if signal(text, &IMPORTANT_TERMS, important) {
        return 7;
    }
    if matches!(row.level, Some("ERROR" | "FATAL")) || signal(text, &SECONDARY_TERMS, bounded) {
        return 6;
    }
    if row.number <= 12 {
        return 5;
    }
    if row.position >= 0.95 || matches!(row.level, Some("WARN" | "WARNING")) {
        return 4;
    }
    match row.category() {
        Category::Exception => 3,
        Category::Heading => 2,
        Category::Other => 1,
    }
}

struct Candidate {
    weight: u8,
    file: usize,
    index: usize,
}

pub type Marks = std::collections::HashMap<String, std::collections::HashMap<usize, u8>>;

pub fn select_lines(files: &[LogFile], limit: usize) -> Vec<Line> {
    select_marked(files, limit, &Marks::new(), true)
}

pub fn select_marked(files: &[LogFile], limit: usize, marks: &Marks, early: bool) -> Vec<Line> {
    let texts: Vec<String> = files.iter().map(|f| normalize(&f.text)).collect();
    let tables: Vec<Vec<&str>> = texts.iter().map(|t| split_lines(t)).collect();
    let mut candidates = Vec::new();
    let mut important = 0;
    'outer: for (file, lines) in tables.iter().enumerate() {
        for index in 0..lines.len() {
            let current = row(lines, index);
            if strip(current.message).is_empty() {
                continue;
            }
            let forced = marks.get(&files[file].name).and_then(|m| m.get(&current.number)).copied();
            let weight = forced.unwrap_or_else(|| priority(&current));
            candidates.push(Candidate { weight, file, index });
            important += usize::from(weight == 7);
            if early && important == limit {
                break 'outer;
            }
        }
    }
    let order = |c: &Candidate| (std::cmp::Reverse(c.weight), c.file, c.index);
    if candidates.len() > limit {
        candidates.select_nth_unstable_by_key(limit, order);
        candidates.truncate(limit);
    }
    candidates.sort_unstable_by_key(|c| (c.file, c.index));
    candidates
        .iter()
        .map(|c| {
            let current = row(&tables[c.file], c.index);
            let source = &files[c.file];
            Line {
                file: source.name.clone(),
                number: current.number,
                text: current.message.to_owned(),
                features: feature_ids(&source.kind, current.level, current.thread, current.position),
                start_byte: current.start,
            }
        })
        .collect()
}
