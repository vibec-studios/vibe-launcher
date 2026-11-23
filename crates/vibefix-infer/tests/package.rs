mod common;

use std::io::Write;
use std::process::Command;

use common::{fixtures, package, read_cases};
use vibefix_infer::{read_log, AnyModel, Error};

fn files() -> Option<(Vec<u8>, Vec<u8>, Vec<u8>)> {
    let dir = package()?;
    let read = |name: &str| std::fs::read(dir.join(name)).unwrap();
    Some((read("config.json"), read("tokenizer.json"), read("weights.bin")))
}

fn scratch(name: &str) -> std::path::PathBuf {
    let dir = std::path::Path::new(env!("CARGO_TARGET_TMPDIR")).join(name);
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

#[test]
fn rejects_newer_versions_with_clear_message() {
    let Some((config, tokenizer, weights)) = files() else { return };
    let mut value: serde_json::Value = serde_json::from_slice(&config).unwrap();
    value["version"] = 99.into();
    let error = AnyModel::from_bytes(&serde_json::to_vec(&value).unwrap(), &tokenizer, &weights).err().unwrap();
    assert!(matches!(error, Error::Version { found: 99, .. }));
    let message = error.to_string();
    assert!(message.contains("99") && message.contains("aktualisieren"), "{message}");
}

#[test]
fn rejects_modified_files() {
    let Some((config, mut tokenizer, mut weights)) = files() else { return };
    weights[10] ^= 1;
    assert!(matches!(AnyModel::from_bytes(&config, &tokenizer, &weights), Err(Error::Checksum("weights.bin"))));
    weights[10] ^= 1;
    tokenizer.push(b' ');
    assert!(matches!(AnyModel::from_bytes(&config, &tokenizer, &weights), Err(Error::Checksum("tokenizer.json"))));
}

#[test]
fn rejects_changed_network_shape() {
    let Some((config, tokenizer, weights)) = files() else { return };
    let mut value: serde_json::Value = serde_json::from_slice(&config).unwrap();
    value["network"]["document_layers"] = 1.into();
    assert!(AnyModel::from_bytes(&serde_json::to_vec(&value).unwrap(), &tokenizer, &weights).is_err());
}

#[test]
fn reads_plain_and_gzip_logs_alike() {
    let cases = read_cases(&fixtures()).unwrap();
    let text = &cases[0].files[0].text;
    let dir = scratch("readlog");
    std::fs::write(dir.join("latest.log"), text).unwrap();
    let mut gz = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::default());
    gz.write_all(text.as_bytes()).unwrap();
    std::fs::write(dir.join("latest.log.gz"), gz.finish().unwrap()).unwrap();
    let plain = read_log(&dir.join("latest.log"));
    assert_eq!(plain, vibefix_infer::normalize(text));
    assert_eq!(read_log(&dir.join("latest.log.gz")), plain);
}

#[test]
fn cli_prints_planner_json() {
    let Some(model) = package() else { return };
    let cases = read_cases(&fixtures()).unwrap();
    let case = cases.iter().find(|c| c.id == "fixture-fabric-missing-dependency").unwrap();
    let dir = scratch("cli");
    let log = dir.join(&case.files[0].name);
    std::fs::write(&log, &case.files[0].text).unwrap();
    let output = Command::new(env!("CARGO_BIN_EXE_vibefix-infer")).arg("--model").arg(model).arg(&log).output().unwrap();
    assert!(output.status.success(), "{}", String::from_utf8_lossy(&output.stderr));
    let value: serde_json::Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(value["status"], "diagnosed");
    assert!(value["causes"][0]["cause"].is_string() && value["ood"].is_number());
    assert_eq!(value["files"][0]["kind"], "latest_log");
}
