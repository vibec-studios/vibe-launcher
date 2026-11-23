mod common;

use std::collections::HashMap;

use common::{close, fixtures, package, read_cases, root};
use serde::Deserialize;
use serde_json::{json, Value};
use vibefix_infer::{v3::Model3, AnyModel};

#[derive(Deserialize)]
struct Record {
    id: String,
    features: [f32; 24],
    prediction: Value,
    analysis: Value,
}

#[derive(Deserialize)]
struct Reference {
    meta: bool,
    records: Vec<Record>,
}

fn verify(name: &str) {
    let Some(package) = package() else { return };
    let reference_path = root().join(format!("tests/parity/v3model-{name}/reference.json"));
    let data = std::fs::read(&reference_path).expect("v3-Referenz");
    let reference: Reference = serde_json::from_slice(&data).unwrap();
    let model = Model3::load(&package).expect("v3-Paritätspaket");
    let cases = read_cases(&fixtures()).expect("v3-Paritätseingaben");
    let by_id: HashMap<&str, &common::Case> = cases.iter().map(|case| (case.id.as_str(), case)).collect();
    let mut errors = Vec::new();
    for record in &reference.records {
        let case = by_id[record.id.as_str()];
        let meta = case.meta.as_ref().and_then(Value::as_object).filter(|_| reference.meta);
        let prepared = model.prepare(&case.files, meta);
        let features = model.features(&case.files, meta, &prepared);
        if features != record.features {
            errors.push(format!("{}: Merkmale {:?} != {:?}", record.id, features, record.features));
        }
        let (_, outputs) = model.run(&prepared);
        let prediction = model.decide(&prepared, &outputs, features);
        close(&record.id, &record.prediction, &json!(prediction), &mut errors);
        close(&format!("{}/analysis", record.id), &record.analysis, &json!(model.convert(prediction)), &mut errors);
    }
    assert_eq!(AnyModel::load(package).unwrap().version(), 3);
    eprintln!("v3model-{name}: {} Fälle, {} Fehler", reference.records.len(), errors.len());
    assert!(errors.is_empty(), "{}", errors[..errors.len().min(20)].join("\n"));
}

#[test]
fn v3model_fixtures() {
    verify("fixtures");
}

#[test]
fn v3_model_suppresses_diagnosis_and_routes_unknown() {
    let Some(package) = package() else { return };
    let read = |file| std::fs::read(package.join(file)).unwrap();
    let mut manifest: Value = serde_json::from_slice(&read("config.json")).unwrap();
    manifest["version"] = json!(3);
    manifest["crash_head"] = json!({"weight": vec![0.0; 24], "bias": 0.0});
    manifest["crash_policy"] = json!({"diagnosed_min": 0.9, "unknown_min": 0.5});
    let config = serde_json::to_vec(&manifest).unwrap();
    let model = AnyModel::from_bytes(&config, &read("tokenizer.json"), &read("weights.bin")).unwrap();
    let cases = read_cases(&fixtures()).unwrap();
    let case = cases.iter().find(|case| case.id == "fixture-fabric-missing-dependency").unwrap();
    let analysis = model.analyze(&case.files);
    assert_eq!(analysis.status, "unknown");
    assert_eq!(analysis.crash_score, Some(0.5));
    assert!(analysis.causes.is_empty() && analysis.entities.is_empty());
}
