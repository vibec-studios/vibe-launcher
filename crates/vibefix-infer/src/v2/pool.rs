use serde::Serialize;

use crate::unicode::{casefold, strip};

pub const MAX_CANDIDATES: usize = 64;
pub const BITS: [&str; 20] = [
    "rule",
    "heuristic",
    "modlist",
    "builtin",
    "stack_first",
    "stack_later",
    "exception_line",
    "caused_by",
    "shape_class",
    "shape_file",
    "shape_version",
    "shape_range",
    "shape_config",
    "shape_modid",
    "evidence_line",
    "bracketed",
    "attributed",
    "keyword",
    "mixin_config",
    "suspect_line",
];
const KEYS: [(&str, usize); 12] = [
    ("mod_id", 0),
    ("dep_id", 1),
    ("dependency", 1),
    ("range", 2),
    ("present_version", 3),
    ("mc_version", 4),
    ("java_major", 5),
    ("class", 6),
    ("file", 7),
    ("jar", 7),
    ("filename", 7),
    ("config_path", 8),
];

pub fn bit(name: &str) -> u32 {
    1 << BITS.iter().position(|b| *b == name).unwrap()
}

pub fn entity_kind(key: &str) -> Option<usize> {
    KEYS.iter().find(|(k, _)| *k == key).map(|(_, v)| *v)
}

pub fn norm(value: &str) -> String {
    let value = strip(value).trim_matches(['\'', '"', '`']);
    casefold(value.trim_end_matches(['.', ',', ';', ':']))
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Candidate {
    pub value: String,
    pub line: i64,
    pub start: usize,
    pub end: usize,
    pub bits: u32,
    pub rule: u32,
    pub heuristic: u32,
}

struct Item {
    candidate: Candidate,
    rank: u32,
}

#[derive(Default)]
pub struct Pool {
    keys: std::collections::HashMap<String, usize>,
    items: Vec<Item>,
}

impl Pool {
    #[allow(clippy::too_many_arguments)]
    pub fn add(
        &mut self,
        value: &str,
        bits: u32,
        line: i64,
        span: (usize, usize),
        rule: u32,
        heuristic: u32,
        rank: u32,
    ) {
        let key = norm(value);
        if key.is_empty() || key.chars().count() > 160 {
            return;
        }
        let i = match self.keys.get(&key) {
            Some(&i) => i,
            None => {
                self.keys.insert(key, self.items.len());
                let candidate = Candidate {
                    value: strip(value).to_owned(),
                    line: -1,
                    start: 0,
                    end: 0,
                    bits: 0,
                    rule: 0,
                    heuristic: 0,
                };
                self.items.push(Item { candidate, rank: 99 });
                self.items.len() - 1
            }
        };
        let item = &mut self.items[i];
        item.candidate.bits |= bits;
        item.candidate.rule |= rule;
        item.candidate.heuristic |= heuristic;
        if line >= 0 && rank < item.rank {
            item.candidate.line = line;
            item.candidate.start = span.0;
            item.candidate.end = span.1;
            item.rank = rank;
        }
    }

    pub fn ordered(self, limit: usize) -> Vec<Candidate> {
        let flag = |bits: u32, mask: u32| u8::from(bits & mask == 0);
        let mut items = self.items;
        items.sort_by_key(|item| {
            let b = item.candidate.bits;
            (
                flag(b, bit("rule") | bit("heuristic")),
                flag(b, bit("stack_first")),
                flag(b, bit("evidence_line")),
                flag(b, bit("attributed")),
                flag(b, bit("exception_line")),
                item.rank,
            )
        });
        items.into_iter().take(limit).map(|i| i.candidate).collect()
    }
}
