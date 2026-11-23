use std::sync::LazyLock;

use regex::Regex;
use serde_json::Value;

use super::context::{ascii_lower, builtin};

#[derive(Clone, Copy, PartialEq, Eq)]
enum RefKind {
    From,
    Config,
    Handler,
    Class,
}

static REFERENCES: LazyLock<Vec<(Regex, RefKind)>> = LazyLock::new(|| {
    vec![
        (Regex::new(r"from mod ([\w\-]+)").unwrap(), RefKind::From),
        (Regex::new(r"([\w\-.]*mixins?[\w\-.]*\.json)").unwrap(), RefKind::Config),
        (
            Regex::new(r"(?:handler|redirect|modify|localvar|wrapOperation|wrapWithCondition|constant|inject)\$[a-z0-9]{6}\$([a-z][a-z0-9_]*)\$")
                .unwrap(),
            RefKind::Handler,
        ),
        (Regex::new(r"\b([a-z][\w]*(?:\.[a-z][\w]*){2,}\.[\w$]+)").unwrap(), RefKind::Class),
    ]
});

fn text<'a>(entry: &'a Value, key: &str) -> Option<&'a str> {
    entry.get(key).and_then(Value::as_str)
}

fn strings(entry: &Value, key: &str) -> Vec<String> {
    entry
        .get(key)
        .and_then(Value::as_array)
        .map_or(Vec::new(), |items| items.iter().filter_map(Value::as_str).map(str::to_owned).collect())
}

fn truthy(value: Option<&Value>) -> bool {
    match value {
        None | Some(Value::Null) => false,
        Some(Value::Bool(b)) => *b,
        Some(Value::Number(n)) => n.as_f64() != Some(0.0),
        Some(Value::String(s)) => !s.is_empty(),
        Some(Value::Array(a)) => !a.is_empty(),
        Some(Value::Object(o)) => !o.is_empty(),
    }
}

#[derive(Default)]
pub struct Index {
    pub active: Vec<(String, Vec<Value>)>,
    pub disabled: Vec<(String, Value)>,
    pub files: Vec<String>,
    mixins: Vec<(String, String)>,
    packages: Vec<(String, String)>,
}

fn upsert(map: &mut Vec<(String, String)>, key: String, value: &str) {
    match map.iter_mut().find(|(k, _)| *k == key) {
        Some(slot) => slot.1 = value.to_owned(),
        None => map.push((key, value.to_owned())),
    }
}

impl Index {
    pub fn new(mods: &[Value]) -> Self {
        let mut index = Index::default();
        for entry in mods {
            let id = ascii_lower(text(entry, "id").unwrap_or(""));
            let file = text(entry, "file");
            if truthy(entry.get("disabled")) || file.unwrap_or("").ends_with(".jar.disabled") {
                if !id.is_empty() && !index.disabled.iter().any(|(k, _)| *k == id) {
                    index.disabled.push((id, entry.clone()));
                }
                continue;
            }
            if let Some(f) = file.filter(|f| !f.is_empty()) {
                if !index.files.iter().any(|x| x == f) {
                    index.files.push(f.to_owned());
                }
            }
            if id.is_empty() {
                continue;
            }
            match index.active.iter_mut().find(|(k, _)| *k == id) {
                Some(slot) => slot.1.push(entry.clone()),
                None => index.active.push((id.clone(), vec![entry.clone()])),
            }
            for m in strings(entry, "mixins") {
                upsert(&mut index.mixins, ascii_lower(&m), &id);
            }
            for p in strings(entry, "packages") {
                upsert(&mut index.packages, format!("{}.", p.trim_end_matches('.')), &id);
            }
        }
        index
    }

    pub fn entries(&self, id: &str) -> &[Value] {
        self.active.iter().find(|(k, _)| k == id).map_or(&[], |(_, v)| v.as_slice())
    }

    pub fn has(&self, id: &str) -> bool {
        self.active.iter().any(|(k, _)| k == id)
    }

    pub fn disabled_file(&self, id: &str) -> Option<&str> {
        self.disabled.iter().find(|(k, _)| k == id).and_then(|(_, e)| text(e, "file"))
    }

    pub fn file(&self, mod_id: Option<&str>) -> Option<String> {
        let entries = self.entries(&ascii_lower(mod_id.unwrap_or("")));
        entries.first().and_then(|e| text(e, "file")).map(str::to_owned)
    }

    pub fn id_for(&self, file: Option<&str>) -> Option<String> {
        let file = file.filter(|f| !f.is_empty())?;
        self.active
            .iter()
            .find(|(_, entries)| entries.iter().any(|e| text(e, "file") == Some(file)))
            .map(|(k, _)| k.clone())
    }

    fn reference(&self, token: &str, kind: RefKind) -> Option<String> {
        match kind {
            RefKind::From | RefKind::Handler => return Some(ascii_lower(token)),
            RefKind::Class => {
                let mut best: Option<&(String, String)> = None;
                for item in &self.packages {
                    if token.starts_with(item.0.as_str()) && best.map_or(true, |b| item.0.len() > b.0.len()) {
                        best = Some(item);
                    }
                }
                return best.map(|(_, id)| id.clone());
            }
            RefKind::Config => {}
        }
        let name = ascii_lower(token);
        if name.contains("refmap") {
            return None;
        }
        if let Some((_, id)) = self.mixins.iter().find(|(k, _)| *k == name) {
            return Some(id.clone());
        }
        let mut stem = name.as_str();
        for suffix in [".json", ".mixins", ".mixin"] {
            stem = stem.strip_suffix(suffix).unwrap_or(stem);
        }
        stem = stem.strip_prefix("mixins.").unwrap_or(stem);
        stem = stem.strip_suffix("-mixins").unwrap_or(stem);
        let mut stem = stem.split('.').next().unwrap_or("");
        for suffix in ["-common", "-client", "-fabric", "-forge", "-neoforge"] {
            stem = stem.strip_suffix(suffix).unwrap_or(stem);
        }
        (!stem.is_empty() && stem != "mixins").then(|| stem.to_owned())
    }

    pub fn referenced_mods(&self, text: &str) -> Vec<String> {
        let mut refs: Vec<(usize, Option<String>)> = Vec::new();
        for (pattern, kind) in REFERENCES.iter() {
            for caps in pattern.captures_iter(text) {
                let m = caps.get(1).unwrap();
                refs.push((m.start(), self.reference(m.as_str(), *kind)));
            }
        }
        refs.sort_by_key(|(pos, _)| *pos);
        let mut out: Vec<String> = Vec::new();
        for (_, id) in refs {
            let Some(mut id) = id.filter(|i| !i.is_empty()) else { continue };
            if !self.has(&id) {
                let plain = id.replace(['-', '_'], "");
                if let Some((k, _)) = self.active.iter().find(|(k, _)| k.replace(['-', '_'], "") == plain) {
                    id = k.clone();
                }
            }
            if !out.contains(&id) && !builtin(&id) {
                out.push(id);
            }
        }
        out
    }
}
