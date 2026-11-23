use crate::category::{exception, mod_header, section_name, stack};
use crate::normalize::normalize;
use crate::prefix;
use crate::segment::split_lines;
use crate::unicode::strip;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Kind {
    Heading,
    Exception,
    Mod,
    Blank,
    Message,
}

#[derive(Debug, Clone)]
pub struct LogLine {
    pub number: usize,
    pub text: String,
    pub start: usize,
    pub level: Option<String>,
    pub thread: Option<String>,
    pub mods_section: bool,
    pub kind: Kind,
    pub position: f64,
}

impl LogLine {
    pub fn message(&self) -> &str {
        &self.text[self.start..]
    }
}

pub fn segment(text: &str) -> Vec<LogLine> {
    let normalized = normalize(text);
    let lines = split_lines(&normalized);
    let mut in_mods = false;
    let mut out = Vec::with_capacity(lines.len());
    let last = lines.len().saturating_sub(1).max(1) as f64;
    for (index, line) in lines.iter().enumerate() {
        let parsed = prefix::parse(line);
        let start = parsed.map_or(0, |p| p.end);
        let message = &line[start..];
        let stripped = strip(message);
        let heading = section_name(stripped);
        let header = heading.is_none() && mod_header(stripped);
        if let Some(name) = heading {
            in_mods = strip(name).eq_ignore_ascii_case("mods");
        } else if header {
            in_mods = true;
        } else if parsed.is_some() && in_mods {
            in_mods = false;
        }
        let category = if heading.is_some() || header {
            Kind::Heading
        } else if stack(message) || exception(message).is_some() {
            Kind::Exception
        } else if in_mods && !stripped.is_empty() {
            Kind::Mod
        } else if stripped.is_empty() {
            Kind::Blank
        } else {
            Kind::Message
        };
        out.push(LogLine {
            number: index + 1,
            text: (*line).to_owned(),
            start,
            level: parsed.and_then(|p| p.level).map(str::to_owned),
            thread: parsed.and_then(|p| p.thread).map(str::to_owned),
            mods_section: in_mods,
            kind: category,
            position: index as f64 / last,
        });
    }
    out
}
