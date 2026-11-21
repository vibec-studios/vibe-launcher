use super::*;

#[derive(Debug, Deserialize)]
pub(super) struct RawPattern {
    pub(super) id: String,
    pub(super) kind: String,
    pub(super) confidence: u8,
    #[serde(default)]
    pub(super) fatal: bool,
    pub(super) also: Option<String>,
    pub(super) unless: Option<String>,
    #[serde(default)]
    pub(super) fallback: bool,
    pub(super) loader: Option<Vec<String>>,
    pub(super) regex: String,
    #[allow(dead_code)]
    pub(super) example: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub(super) struct ClassHint {
    pub(super) prefix: String,
    #[serde(rename = "mod")]
    pub(super) slug: String,
    pub(super) name: String,
    pub(super) ids: Vec<String>,
    pub(super) loader: Option<Vec<String>>,
}

#[derive(Debug, Deserialize)]
pub(super) struct RawTable {
    pub(super) fatal_markers: Vec<String>,
    pub(super) pattern: Vec<RawPattern>,
    pub(super) class_hint: Vec<ClassHint>,
}

#[derive(Debug, Clone, Deserialize)]
pub(super) struct PairSide {
    pub(super) name: String,
    pub(super) ids: Vec<String>,
    pub(super) file: Option<String>,
    pub(super) version: Option<String>,
}

#[derive(Debug, Deserialize)]
pub(super) struct RawPair {
    pub(super) id: String,
    pub(super) a: PairSide,
    pub(super) b: PairSide,
    pub(super) source: String,
}

#[derive(Debug, Deserialize)]
pub(super) struct RawPairs {
    pub(super) pair: Vec<RawPair>,
}

pub(super) struct Pattern {
    pub(super) raw: RawPattern,
    pub(super) re: Regex,
    pub(super) also: Option<Regex>,
    pub(super) unless: Option<Regex>,
}

pub(super) struct Pair {
    pub(super) raw: RawPair,
    pub(super) a_file: Option<Regex>,
    pub(super) b_file: Option<Regex>,
}

pub(super) struct Table {
    pub(super) fatal: Vec<String>,
    pub(super) patterns: Vec<Pattern>,
    pub(super) hints: Vec<ClassHint>,
    pub(super) pairs: Vec<Pair>,
}

pub(super) const PATTERNS: &str = include_str!("patterns.toml");
pub(super) const CONFLICTS: &str = include_str!("conflicts.toml");

pub(super) fn compile(s: &str, what: &str) -> Regex {
    Regex::new(s).unwrap_or_else(|e| panic!("Crash-Muster {what}: {e}"))
}

pub(super) fn table() -> &'static Table {
    static T: OnceLock<Table> = OnceLock::new();
    T.get_or_init(|| {
        let raw: RawTable = toml::from_str(PATTERNS).expect("patterns.toml");
        let pairs: RawPairs = toml::from_str(CONFLICTS).expect("conflicts.toml");
        Table {
            fatal: raw.fatal_markers,
            patterns: raw
                .pattern
                .into_iter()
                .map(|p| Pattern {
                    re: compile(&p.regex, &p.id),
                    also: p.also.as_deref().map(|s| compile(s, &p.id)),
                    unless: p.unless.as_deref().map(|s| compile(s, &p.id)),
                    raw: p,
                })
                .collect(),
            hints: raw.class_hint,
            pairs: pairs
                .pair
                .into_iter()
                .map(|p| Pair {
                    a_file: p.a.file.as_deref().map(|s| compile(s, &p.id)),
                    b_file: p.b.file.as_deref().map(|s| compile(s, &p.id)),
                    raw: p,
                })
                .collect(),
        }
    })
}

pub(super) fn re(s: &str) -> Regex {
    Regex::new(s).expect("Regex")
}

pub(super) fn line_of(text: &str, start: usize) -> &str {
    let s = text[..start].rfind('\n').map(|i| i + 1).unwrap_or(0);
    let e = text[start..].find('\n').map(|i| start + i).unwrap_or(text.len());
    &text[s..e]
}

/// Ausschnitt `[start-before, start+after)` an Zeichengrenzen.
pub(super) fn window(text: &str, start: usize, before: usize, after: usize) -> &str {
    let mut a = start.saturating_sub(before);
    while !text.is_char_boundary(a) {
        a -= 1;
    }
    let mut b = (start + after).min(text.len());
    while !text.is_char_boundary(b) {
        b += 1;
    }
    &text[a..b]
}

/// Mod-IDs, die in Fehlermeldungen vorkommen, aber nie Schuldige sind.
pub(super) fn is_builtin(id: &str) -> bool {
    matches!(
        id.to_ascii_lowercase().as_str(),
        "minecraft" | "java" | "fabricloader" | "fabric-loader" | "forge" | "neoforge" | "quilt_loader" | "mixinextras" | "mcp" | "fml" | "javafml"
    )
}

pub(super) const LOADER_IDS: &[&str] = &["fabricloader", "fabric-loader", "forge", "neoforge", "quilt_loader"];

/// Fabric-API-Module tauchen in fast jedem Stacktrace auf – als Konfliktpartner nur, wenn nichts anderes da ist.
pub(super) fn is_noise(id: &str) -> bool {
    is_builtin(id) || id.starts_with("fabric-") || id.starts_with("fabric_") || id == "fabric-api"
}
