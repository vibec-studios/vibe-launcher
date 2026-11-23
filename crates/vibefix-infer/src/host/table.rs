use std::sync::LazyLock;

use regex::Regex;
use serde::Deserialize;

#[derive(Deserialize)]
struct RawRule {
    id: String,
    kind: String,
    confidence: i64,
    regex: String,
    #[serde(default)]
    fatal: bool,
    #[serde(default)]
    fallback: bool,
    also: Option<String>,
    unless: Option<String>,
    loader: Option<Vec<String>>,
}

#[derive(Deserialize, Clone)]
pub struct ClassHint {
    pub prefix: String,
    #[serde(rename = "mod")]
    pub module: String,
    #[serde(default)]
    pub ids: Vec<String>,
    pub loader: Option<Vec<String>>,
}

#[derive(Deserialize)]
struct RawTable {
    fatal_markers: Vec<String>,
    pattern: Vec<RawRule>,
    #[serde(default)]
    class_hint: Vec<ClassHint>,
}

pub struct Rule {
    pub id: String,
    pub kind: String,
    pub confidence: i64,
    pub regex: Regex,
    pub fatal: bool,
    pub fallback: bool,
    pub also: Option<Regex>,
    pub unless: Option<Regex>,
    pub loader: Option<Vec<String>>,
}

pub struct Table {
    pub fatal_markers: Vec<String>,
    pub rules: Vec<Rule>,
    pub class_hints: Vec<ClassHint>,
}

#[derive(Deserialize)]
struct RawSide {
    ids: Vec<String>,
    file: Option<String>,
    version: Option<String>,
}

#[derive(Deserialize)]
struct RawPair {
    id: String,
    a: RawSide,
    b: RawSide,
}

#[derive(Deserialize)]
struct RawPairs {
    pair: Vec<RawPair>,
}

pub struct Side {
    pub ids: Vec<String>,
    pub file: Option<Regex>,
    pub version: Option<String>,
}

pub struct Pair {
    pub id: String,
    pub a: Side,
    pub b: Side,
}

fn compile(pattern: &str) -> Regex {
    Regex::new(pattern).unwrap_or_else(|e| panic!("Muster {pattern}: {e}"))
}

pub static TABLE: LazyLock<Table> = LazyLock::new(|| {
    let raw: RawTable = toml::from_str(include_str!("../../data/patterns.toml")).expect("patterns.toml");
    let rules = raw
        .pattern
        .into_iter()
        .map(|r| Rule {
            regex: compile(&r.regex),
            also: r.also.as_deref().map(compile),
            unless: r.unless.as_deref().map(compile),
            id: r.id,
            kind: r.kind,
            confidence: r.confidence,
            fatal: r.fatal,
            fallback: r.fallback,
            loader: r.loader,
        })
        .collect();
    Table { fatal_markers: raw.fatal_markers, rules, class_hints: raw.class_hint }
});

fn side(raw: RawSide) -> Side {
    Side { ids: raw.ids, file: raw.file.as_deref().map(compile), version: raw.version }
}

pub static PAIRS: LazyLock<Vec<Pair>> = LazyLock::new(|| {
    let raw: RawPairs = toml::from_str(include_str!("../../data/conflicts.toml")).expect("conflicts.toml");
    raw.pair.into_iter().map(|p| Pair { id: p.id, a: side(p.a), b: side(p.b) }).collect()
});
