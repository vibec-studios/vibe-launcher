use std::sync::LazyLock;

use serde_json::Value;

use super::pool::{bit, Pool, MAX_CANDIDATES};
use super::shapes;
use crate::host::pyre::Py;
use crate::host::HostFinding;
use crate::select::Line;
use crate::unicode::casefold;

pub use super::pool::{norm, Candidate};

pub const ENTITY_TYPES: [&str; 9] =
    ["MOD_ID", "DEP_ID", "RANGE", "PRESENT_VERSION", "MC_VERSION", "JAVA_MAJOR", "CLASS", "FILE", "CONFIG_PATH"];
const CORE: &str =
    "minecraft forge neoforge fml fmlcore fmlloader javafmllanguage lowcodelanguage mclanguage modlauncher \
securejarhandler bootstraplauncher eventbus mixin mixinextras server client fabric-loader fabricloader \
knot java jdk quilt_loader quilt-loader spongepowered asm none unknown";

static CONFIG: LazyLock<Py> = LazyLock::new(|| Py::new(r#"config[\/][^\s'\"()\[\],;]+"#));
static RANGE: LazyLock<Py> =
    LazyLock::new(|| Py::new(r"(?:[<>]=?|[=~^])\s*\d[\w.+*-]*|[\[(]\s*[\w.+-]*\s*,\s*[\w.+-]*\s*[\])]"));
static TRANSFORMER: LazyLock<Py> = LazyLock::new(|| Py::new(r"TRANSFORMER/([\w.\-]+)@"));
static JAR_FRAME: LazyLock<Py> = LazyLock::new(|| Py::new(r"~\[([^\]%/\:]+?\.jar)"));
static FROM_MOD: LazyLock<Py> = LazyLock::new(|| Py::new(r"(?i)from mod (\w+(?:-\w+)*)"));
static MIXIN_CONFIG: LazyLock<Py> =
    LazyLock::new(|| Py::new(r"([\w\-]+?)(?:[.-](?:common|client|fabric|forge|neoforge))?[.-]mixins?\.json"));
static KEYWORD: LazyLock<Py> =
    LazyLock::new(|| Py::new(r#"(?i)(?:requires|of|mod|dependency|depends on|Mod ID:|Requested by:)\s*['\"]?$"#));
static EXCEPTION: LazyLock<Py> = LazyLock::new(|| Py::new(r"(?:Exception|Error|Throwable)\b"));
static STEM: LazyLock<Py> = LazyLock::new(|| {
    Py::anchored(
        r"(?i)^([A-Za-z][A-Za-z_]*?(?:[-_][A-Za-z]+)*?)(?:[-_+ ](?:v?\d|mc\d|fabric|forge|neoforge|quilt)|\.jar$)",
    )
});
static UPPER: LazyLock<Py> = LazyLock::new(|| Py::new(r"[A-Z$]"));

fn core(value: &str) -> bool {
    CORE.split(' ').any(|c| c == value)
}

fn jar_stem(name: &str) -> Option<String> {
    STEM.group(name, 1).map(|m| m.to_lowercase().replace('_', "-"))
}

fn mod_reference(text: &str, files: &[(String, String)]) -> Option<String> {
    let key = casefold(text);
    let stem = files
        .iter()
        .rev()
        .find(|(f, _)| *f == key)
        .map(|(_, id)| id.clone())
        .filter(|s| !s.is_empty())
        .or_else(|| jar_stem(text));
    stem.filter(|s| !s.is_empty() && !core(s))
}

fn char_window(text: &str, end: usize, chars: usize) -> &str {
    let start = text[..end].char_indices().rev().nth(chars.saturating_sub(1)).map_or(0, |(i, _)| i);
    if chars == 0 {
        return "";
    }
    &text[start..end]
}

struct Scan<'a> {
    mod_ids: &'a [String],
    files: &'a [(String, String)],
    stack: Vec<String>,
}

fn scan_line(pool: &mut Pool, index: i64, text: &str, evidence: bool, scan: &mut Scan<'_>) {
    let lower = casefold(text);
    let mut base = 0;
    if EXCEPTION.is_match(text) {
        base |= bit("exception_line");
    }
    if lower.contains("caused by:") {
        base |= bit("caused_by");
    }
    if evidence {
        base |= bit("evidence_line");
    }
    if lower.contains("suspected mod") {
        base |= bit("suspect_line");
    }
    let rank = if evidence {
        0
    } else if base & bit("exception_line") != 0 {
        1
    } else {
        2
    };
    let regex =
        |p: &Py| p.iter(text).into_iter().map(|c| c.get(0).map(|m| (m.start(), m.end())).unwrap()).collect::<Vec<_>>();
    let shapes = [
        (shapes::classes(text), "shape_class"),
        (shapes::files(text), "shape_file"),
        (regex(&CONFIG), "shape_config"),
        (regex(&RANGE), "shape_range"),
        (shapes::versions(text), "shape_version"),
    ];
    for (spans, shape) in shapes {
        for (start, end) in spans {
            let value = text[start..end].trim_end_matches('.');
            if shape == "shape_class" {
                let tail = value.rsplit('.').next().unwrap_or("").rsplit('/').next().unwrap_or("");
                if !UPPER.is_match(tail) {
                    continue;
                }
            }
            pool.add(value, base | bit(shape), index, (start, start + value.len()), 0, 0, rank);
        }
    }
    for (start, end) in shapes::idents(text) {
        let value = &text[start..end];
        let before = char_window(text, start, 24);
        let after: &str = text[end..].chars().next().map_or("", |c| &text[end..end + c.len_utf8()]);
        let mut bits = base | bit("shape_modid");
        if scan.mod_ids.iter().any(|i| i == value) {
            bits |= bit("modlist");
        }
        if core(value) {
            bits |= bit("builtin");
        }
        let last = before.chars().next_back();
        let opens = last.map_or(true, |c| "('\"{[".contains(c));
        let closes = after.chars().next().map_or(true, |c| ")'\"}]".contains(c));
        if opens && closes {
            bits |= bit("bracketed");
        }
        if KEYWORD.is_match(before) {
            bits |= bit("keyword");
        }
        if bits & (bit("modlist") | bit("bracketed") | bit("keyword")) != 0
            || value.contains('-')
            || value.contains('_')
        {
            pool.add(value, bits, index, (start, end), 0, 0, rank);
        }
    }
    let references: [(&Py, bool, bool); 4] = [
        (&TRANSFORMER, true, false),
        (&JAR_FRAME, true, true),
        (&FROM_MOD, true, false),
        (&MIXIN_CONFIG, false, false),
    ];
    for (pattern, attributed, jar) in references {
        for caps in pattern.iter(text) {
            let g = caps.get(1).unwrap();
            let value = if jar { mod_reference(g.as_str(), scan.files) } else { Some(g.as_str().to_lowercase()) };
            let Some(value) = value.filter(|v| !v.is_empty() && !core(v)) else { continue };
            let mut bits = base | if attributed { bit("attributed") } else { bit("mixin_config") };
            if scan.mod_ids.contains(&value) {
                bits |= bit("modlist");
            }
            if attributed
                && text.trim_start_matches(crate::unicode::is_space).starts_with("at ")
                && !scan.stack.contains(&value)
            {
                scan.stack.push(value.clone());
            }
            pool.add(&value, bits, index, (g.start(), g.end()), 0, 0, rank + 1);
        }
    }
}

pub fn entity_pairs(findings: &[&HostFinding]) -> Vec<(usize, String)> {
    let mut out = Vec::new();
    for record in findings {
        for (key, value) in &record.entities.0 {
            let Some(kind) = super::pool::entity_kind(&key.to_lowercase()) else { continue };
            let items: Vec<&Value> = match value {
                Value::Array(items) => items.iter().collect(),
                other => vec![other],
            };
            for item in items {
                let text = match item {
                    Value::String(s) => s.clone(),
                    Value::Number(n) if n.is_i64() || n.is_u64() => n.to_string(),
                    Value::Bool(b) => {
                        if *b {
                            "True".into()
                        } else {
                            "False".into()
                        }
                    }
                    _ => continue,
                };
                let text = crate::unicode::strip(&text).to_owned();
                if !text.is_empty() {
                    out.push((kind, text));
                }
            }
        }
    }
    out
}

pub fn extract(lines: &[Line], mods: &[Value], rules: &[&HostFinding], heuristics: &[&HostFinding]) -> Vec<Candidate> {
    let mut pool = Pool::default();
    let field = |m: &Value, k: &str| m.get(k).map(|v| v.as_str().map(str::to_owned).unwrap_or_else(|| v.to_string()));
    let mod_ids: Vec<String> = mods
        .iter()
        .filter_map(|m| field(m, "id").filter(|_| truthy(m.get("id"))))
        .map(|i| casefold(&i))
        .filter(|i| !i.is_empty())
        .collect();
    let files: Vec<(String, String)> = mods
        .iter()
        .filter(|m| truthy(m.get("file")) && truthy(m.get("id")))
        .map(|m| (casefold(&field(m, "file").unwrap_or_default()), casefold(&field(m, "id").unwrap_or_default())))
        .collect();
    let evidence: Vec<(String, usize)> =
        rules.iter().chain(heuristics).filter_map(|r| r.evidence.as_ref().map(|e| (e.file.clone(), e.line))).collect();
    let mut scan = Scan { mod_ids: &mod_ids, files: &files, stack: Vec::new() };
    for (i, line) in lines.iter().enumerate() {
        let hit = evidence.iter().any(|(f, n)| *f == line.file && *n == line.number);
        scan_line(&mut pool, i as i64, &line.text, hit, &mut scan);
    }
    for (i, value) in scan.stack.iter().take(4).enumerate() {
        pool.add(value, if i == 0 { bit("stack_first") } else { bit("stack_later") }, -1, (0, 0), 0, 0, 9);
    }
    for (findings, name) in [(rules, "rule"), (heuristics, "heuristic")] {
        for (kind, value) in entity_pairs(findings) {
            let bits = bit(name) | if mod_ids.contains(&norm(&value)) { bit("modlist") } else { 0 };
            let (r, h) = if name == "rule" { (1 << kind, 0) } else { (0, 1 << kind) };
            pool.add(&value, bits, -1, (0, 0), r, h, 9);
        }
    }
    pool.ordered(MAX_CANDIDATES)
}

fn truthy(value: Option<&Value>) -> bool {
    match value {
        None | Some(Value::Null) => false,
        Some(Value::String(s)) => !s.is_empty(),
        Some(Value::Bool(b)) => *b,
        Some(Value::Number(n)) => n.as_f64() != Some(0.0),
        Some(_) => true,
    }
}
