mod common;

use std::collections::HashMap;

use common::{close, read_cases, root};
use serde::Deserialize;
use serde_json::{json, Map, Value};
use vibefix_infer::host;

#[derive(Deserialize)]
struct Record {
    id: String,
    bare: Value,
    given: Option<Value>,
}

fn compare(label: &str, expected: &Value, actual: &Value, errors: &mut Vec<String>) {
    let before = errors.len();
    close(label, expected, actual, errors);
    if errors.len() > before + 3 {
        errors.truncate(before + 3);
        errors.push(format!("{label}: weitere Abweichungen"));
    }
}

fn verify(name: &str, inputs: &str, required: bool) -> usize {
    let dir = root().join("tests/parity").join(format!("host-{name}"));
    let Ok(data) = std::fs::read(dir.join("reference.json")) else {
        assert!(!required, "{} fehlt", dir.display());
        return 0;
    };
    let records: Vec<Record> = serde_json::from_slice(&data).unwrap();
    let Some(cases) = read_cases(&root().join(inputs)) else {
        assert!(!required, "{inputs} fehlt");
        return 0;
    };
    let cases: HashMap<&str, &common::Case> = cases.iter().map(|c| (c.id.as_str(), c)).collect::<HashMap<_, _>>();
    let mut errors = Vec::new();
    let mut checked = 0;
    for record in &records {
        let case = cases.get(record.id.as_str()).unwrap_or_else(|| panic!("{} fehlt", record.id));
        let bare = json!(host::run(&case.files, None));
        compare(&format!("{}/bare", record.id), &record.bare, &bare, &mut errors);
        if let Some(given) = &record.given {
            let meta: Option<&Map<String, Value>> = case.meta.as_ref().and_then(Value::as_object);
            compare(&format!("{}/given", record.id), given, &json!(host::run(&case.files, meta)), &mut errors);
        }
        checked += 1;
    }
    eprintln!("host-{name}: {checked} Fälle, {} Abweichungen", errors.len());
    assert!(errors.is_empty(), "{}", errors.join("\n"));
    checked
}

#[test]
fn host_fixtures() {
    assert!(verify("fixtures", "tests/parity/fixtures/inputs.jsonl", true) >= 30);
}
