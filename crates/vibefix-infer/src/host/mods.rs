use std::sync::LazyLock;

use serde_json::{json, Value};

use super::pyre::Py;
use super::segment::{Kind, LogLine};
use crate::unicode::{is_word, strip};

static FABRIC: LazyLock<Py> = LazyLock::new(|| {
    Py::full(concat!(
        r"^\s*(?:[|│ ]*(?:[-+\\]|├|└)(?:[-─]{0,3})\s+)?(?P<id>[a-z][a-z0-9_.-]*)",
        r"(?::\s+.+?\s+|\s+)(?P<version>\d[\w.+~-]*|[><=*][\w.*+-]+|unknown|NONE)\s*$"
    ))
});
static FABRIC_FALLBACK: LazyLock<Py> =
    LazyLock::new(|| Py::full(r"^\s*(?:[|│ ]*[-+\\├└][─-]*\s+)([a-z][a-z0-9_.-]*)\s+(\S+)\s*$"));
static LEGACY: LazyLock<Py> =
    LazyLock::new(|| Py::anchored(r"^\s*(?:[A-Z]{1,12}\s+)?([\w.-]+)\{([^{}]+)\}\s+\[[^\]]+\]\s+\(([^)]+)\)"));
static FOUND: LazyLock<Py> = LazyLock::new(|| {
    Py::new(concat!(
        r#"(?i)Found (?:valid )?mod file\s+["']?([^"'\s]+\.jar)["']?.*?\b(?:with mods?\s+(?:\{|\[|\()?|"#,
        r#"with\s+[\{\[]|modid[:=]\s*)([A-Za-z0-9_. ,\-]+)"#
    ))
});
static JAR: LazyLock<Py> = LazyLock::new(|| Py::new(r"(?i)(?:^|[/\\])([^/\\]+\.jar)(?=$|[!(])"));

#[derive(Default)]
pub struct ModTable {
    pub entries: Vec<(String, Option<String>, Option<String>)>,
}

impl ModTable {
    pub fn record(&mut self, id: &str, version: Option<&str>, file: Option<&str>) {
        let i = match self.entries.iter().position(|e| e.0 == id) {
            Some(i) => i,
            None => {
                self.entries.push((id.to_owned(), None, None));
                self.entries.len() - 1
            }
        };
        let entry = &mut self.entries[i];
        if let Some(v) = version.filter(|v| !v.is_empty() && !matches!(*v, "NONE" | "unknown" | "?")) {
            if entry.1.is_none() {
                entry.1 = Some(v.to_owned());
            }
        }
        if let Some(f) = file.filter(|f| !f.is_empty()) {
            if entry.2.is_none() {
                entry.2 = Some(f.to_owned());
            }
        }
    }

    pub fn get(&self, id: &str) -> Option<&(String, Option<String>, Option<String>)> {
        self.entries.iter().find(|e| e.0 == id)
    }

    pub fn values(&self) -> Vec<Value> {
        self.entries.iter().map(|(id, version, file)| json!({"id": id, "version": version, "file": file})).collect()
    }
}

pub fn jar_name(value: &str) -> Option<String> {
    JAR.group(strip(value), 1).map(str::to_owned)
}

fn ident(c: char) -> bool {
    is_word(c) || c == '.' || c == '-'
}

fn is_ident(value: &str) -> bool {
    !value.is_empty() && value.chars().all(ident)
}

fn idents(value: &str) -> Vec<&str> {
    value.split(|c: char| !ident(c)).filter(|s| !s.is_empty()).collect()
}

fn pipe_row(line: &str) -> Option<(String, String, Option<String>)> {
    let cells: Vec<&str> = strip(line).trim_matches('|').split('|').map(strip).collect();
    if cells.len() < 4 {
        return None;
    }
    if jar_name(cells[0]).is_some() && is_ident(cells[2]) {
        return Some((cells[2].to_owned(), cells[3].to_owned(), jar_name(cells[0])));
    }
    if is_ident(cells[0]) && jar_name(cells[3]).is_some() {
        return Some((cells[0].to_owned(), cells[2].to_owned(), jar_name(cells[3])));
    }
    None
}

pub fn extract_mods(lines: &[LogLine]) -> ModTable {
    let mut mods = ModTable::default();
    for line in lines {
        let message = line.message();
        if line.mods_section && line.kind == Kind::Mod {
            if let Some(m) = FABRIC.search(message).or_else(|| FABRIC_FALLBACK.search(message)) {
                mods.record(&m[1], Some(&m[2]), None);
            }
        }
        if message.contains('|') {
            if let Some((id, version, file)) = pipe_row(message) {
                mods.record(&id, Some(&version), file.as_deref());
            }
        }
        if let Some(m) = LEGACY.search(message) {
            mods.record(&m[1], Some(&m[2]), jar_name(&m[3]).as_deref());
        }
        if message.to_lowercase().contains("mod file") {
            if let Some(m) = FOUND.search(message) {
                let file = jar_name(&m[1]);
                for id in idents(strip(&m[2])) {
                    mods.record(id, None, file.as_deref());
                }
            }
        }
    }
    mods
}
