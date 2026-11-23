#![allow(dead_code)]

use std::path::{Path, PathBuf};

use serde::Deserialize;
use serde_json::Value;
use vibefix_infer::LogFile;

pub const TOL: f64 = 1e-3;

#[derive(Deserialize)]
pub struct Case {
    pub id: String,
    pub files: Vec<LogFile>,
    #[serde(default)]
    pub meta: Option<Value>,
}

pub fn root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).to_path_buf()
}

pub fn fixtures() -> PathBuf {
    root().join("tests/parity/fixtures/inputs.jsonl")
}

pub fn package() -> Option<PathBuf> {
    let dir = PathBuf::from(std::env::var_os("VIBEFIX_MODEL_DIR")?);
    if dir.join("config.json").is_file() {
        Some(dir)
    } else {
        eprintln!("VIBEFIX_MODEL_DIR ohne config.json, übersprungen");
        None
    }
}

pub fn read_cases(path: &Path) -> Option<Vec<Case>> {
    let text = std::fs::read_to_string(path).ok()?;
    Some(text.lines().filter(|l| !l.trim().is_empty()).map(|l| serde_json::from_str(l).unwrap()).collect())
}

pub fn close(path: &str, expected: &Value, actual: &Value, errors: &mut Vec<String>) {
    match (expected, actual) {
        (Value::Number(a), Value::Number(b)) => {
            let (a, b) = (a.as_f64().unwrap(), b.as_f64().unwrap());
            if (a - b).abs() > TOL {
                errors.push(format!("{path}: {a} != {b}"));
            }
        }
        (Value::Array(a), Value::Array(b)) => {
            if a.len() != b.len() {
                errors.push(format!("{path}: Länge {} != {}", a.len(), b.len()));
                return;
            }
            for (i, (x, y)) in a.iter().zip(b).enumerate() {
                close(&format!("{path}[{i}]"), x, y, errors);
            }
        }
        (Value::Object(a), Value::Object(b)) => {
            for (key, x) in a {
                match b.get(key) {
                    Some(y) => close(&format!("{path}.{key}"), x, y, errors),
                    None => errors.push(format!("{path}.{key} fehlt")),
                }
            }
        }
        _ if expected != actual => errors.push(format!("{path}: {expected} != {actual}")),
        _ => {}
    }
}
