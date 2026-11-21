use super::*;
use std::cmp::Ordering;

#[test]
fn versions() {
    assert_eq!(cmp_versions("1.21.10", "1.21.9"), Ordering::Greater);
    assert_eq!(cmp_versions("1.21", "1.21.1"), Ordering::Less);
    assert_eq!(cmp_versions("26.1", "1.21.11"), Ordering::Greater);
    assert_eq!(cmp_versions("26.3", "26.3"), Ordering::Equal);
}

#[test]
fn loaders() {
    assert_eq!(loader_name(LoaderKind::Fabric), Some("fabric"));
    assert_eq!(loader_name(LoaderKind::Neoforge), Some("neoforge"));
    assert_eq!(loader_name(LoaderKind::Forge), None);
    assert_eq!(loader_name(LoaderKind::Vanilla), None);
}

#[test]
fn state_roundtrip() {
    let s = InstanceState { enabled: true, version: Some("0.2.0".into()), requires: vec!["P7dR8mSH".into()], ..Default::default() };
    let j = serde_json::to_string(&s).unwrap();
    assert_eq!(serde_json::from_str::<InstanceState>(&j).unwrap(), s);
    // Unbekannte/fehlende Felder sind ok
    let s2: InstanceState = serde_json::from_str(r#"{"enabled":true,"neu":1}"#).unwrap();
    assert!(s2.enabled && s2.file.is_none());
}
