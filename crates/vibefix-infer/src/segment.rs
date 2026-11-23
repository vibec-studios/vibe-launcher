use crate::category::{categorize, Category};
use crate::prefix;

pub struct Row<'a> {
    pub number: usize,
    pub message: &'a str,
    pub start: usize,
    pub level: Option<&'a str>,
    pub thread: Option<&'a str>,
    pub position: f64,
}

impl Row<'_> {
    pub fn category(&self) -> Category {
        categorize(self.message)
    }
}

pub fn split_lines(text: &str) -> Vec<&str> {
    let mut lines: Vec<&str> = text.split('\n').collect();
    if lines.last().is_some_and(|line| line.is_empty()) {
        lines.pop();
    }
    lines
}

pub fn row<'a>(lines: &[&'a str], index: usize) -> Row<'a> {
    let line = lines[index];
    let parsed = prefix::parse(line);
    let start = parsed.map_or(0, |p| p.end);
    Row {
        number: index + 1,
        message: &line[start..],
        start,
        level: parsed.and_then(|p| p.level),
        thread: parsed.and_then(|p| p.thread),
        position: index as f64 / (lines.len().saturating_sub(1).max(1)) as f64,
    }
}
