mod common;

use std::collections::HashMap;

use common::{close, read_cases, root};
use serde::Deserialize;
use serde_json::{json, Map, Value};
use vibefix_infer::v2::capping::Budget;
use vibefix_infer::v2::prepare::{prepare, Prepared};

#[derive(Deserialize)]
struct Record {
    id: String,
    bare: Value,
    given: Option<Value>,
}

#[derive(Deserialize)]
struct Reference {
    causes: Vec<String>,
    records: Vec<Record>,
}

fn dump(p: &Prepared) -> Value {
    let lines: Vec<Value> = p
        .lines
        .iter()
        .map(|l| json!([l.file, l.number, l.start_byte, l.features[0], l.features[1], l.features[2], l.features[3]]))
        .collect();
    let candidates: Vec<Value> =
        p.candidates.iter().map(|c| json!([c.value, c.line, c.start, c.end, c.bits, c.rule, c.heuristic])).collect();
    json!({"lines": lines, "line_rules": p.line_rules, "rule_vector": p.rule_vector, "flags": p.flags,
           "candidates": candidates, "rules": p.rules, "heuristics": p.heuristics})
}

fn compare(label: &str, expected: &Value, actual: &Value, errors: &mut Vec<String>) {
    let before = errors.len();
    close(label, expected, actual, errors);
    if errors.len() > before + 4 {
        errors.truncate(before + 4);
        errors.push(format!("{label}: weitere Abweichungen"));
    }
}

fn verify(name: &str, inputs: &str, required: bool) -> usize {
    let dir = root().join("tests/parity").join(format!("v2prep-{name}"));
    let Ok(data) = std::fs::read(dir.join("reference.json")) else {
        assert!(!required, "{} fehlt", dir.display());
        return 0;
    };
    let reference: Reference = serde_json::from_slice(&data).unwrap();
    let Some(cases) = read_cases(&root().join(inputs)) else {
        assert!(!required, "{inputs} fehlt");
        return 0;
    };
    let cases: HashMap<&str, &common::Case> = cases.iter().map(|c| (c.id.as_str(), c)).collect();
    let budget = Budget::default();
    let mut errors = Vec::new();
    for record in &reference.records {
        let case = cases[record.id.as_str()];
        let bare = prepare(&case.files, None, &reference.causes, &budget, 512);
        compare(&format!("{}/bare", record.id), &record.bare, &dump(&bare), &mut errors);
        if let Some(given) = &record.given {
            let meta: Option<&Map<String, Value>> = case.meta.as_ref().and_then(Value::as_object);
            let actual = prepare(&case.files, meta, &reference.causes, &budget, 512);
            compare(&format!("{}/given", record.id), given, &dump(&actual), &mut errors);
        }
    }
    eprintln!("v2prep-{name}: {} Fälle, {} Abweichungen", reference.records.len(), errors.len());
    assert!(errors.is_empty(), "{}", errors.join("\n"));
    reference.records.len()
}

#[test]
fn v2prep_fixtures() {
    assert!(verify("fixtures", "tests/parity/fixtures/inputs.jsonl", true) >= 30);
}
