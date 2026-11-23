use serde::ser::{SerializeMap, Serializer};
use serde::Serialize;
use serde_json::Value;

#[derive(Debug, Clone, Default, PartialEq)]
pub struct OMap(pub Vec<(String, Value)>);

impl OMap {
    pub fn get(&self, key: &str) -> Option<&Value> {
        self.0.iter().find(|(k, _)| k == key).map(|(_, v)| v)
    }

    pub fn text(&self, key: &str) -> Option<&str> {
        self.get(key).and_then(Value::as_str)
    }

    pub fn insert(&mut self, key: &str, value: Value) {
        match self.0.iter_mut().find(|(k, _)| k == key) {
            Some(slot) => slot.1 = value,
            None => self.0.push((key.to_owned(), value)),
        }
    }

    pub fn remove(&mut self, key: &str) -> Option<Value> {
        let i = self.0.iter().position(|(k, _)| k == key)?;
        Some(self.0.remove(i).1)
    }

    pub fn contains(&self, key: &str) -> bool {
        self.get(key).is_some()
    }

    pub fn from_pairs<K: Into<String>>(pairs: impl IntoIterator<Item = (K, Value)>) -> Self {
        let mut map = OMap::default();
        for (k, v) in pairs {
            map.insert(&k.into(), v);
        }
        map
    }

    pub fn present(self) -> Self {
        OMap(self.0.into_iter().filter(|(_, v)| !(v.is_null() || v.as_str() == Some(""))).collect())
    }
}

impl Serialize for OMap {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let mut map = serializer.serialize_map(Some(self.0.len()))?;
        for (k, v) in &self.0 {
            map.serialize_entry(k, v)?;
        }
        map.end()
    }
}

pub fn text(value: Option<&str>) -> Value {
    value.map_or(Value::Null, |v| Value::String(v.to_owned()))
}

#[derive(Debug, Clone, PartialEq)]
pub struct Evidence {
    pub file: String,
    pub line: usize,
}

#[derive(Debug, Clone, PartialEq)]
pub struct HostFinding {
    pub cause: String,
    pub confidence: f64,
    pub entities: OMap,
    pub evidence: Option<Evidence>,
}

impl Serialize for HostFinding {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let mut map = serializer.serialize_map(None)?;
        map.serialize_entry("cause", &self.cause)?;
        map.serialize_entry("confidence", &self.confidence)?;
        map.serialize_entry("entities", &self.entities)?;
        if let Some(ev) = &self.evidence {
            map.serialize_entry("evidence", &serde_json::json!({"file": ev.file, "line": ev.line}))?;
        }
        map.end()
    }
}

#[derive(Debug, Clone, Default, Serialize)]
pub struct HostLabel {
    pub causes: Vec<HostFinding>,
    pub healthy: bool,
}
