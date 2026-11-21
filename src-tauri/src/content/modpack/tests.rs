use super::*;

#[test]
fn record_roundtrip() {
    let r = PackRecord {
        source: Some(Source::Modrinth),
        project_id: Some("p".into()),
        files: [("mods/a.jar".to_string(), RecFile { sha1: Some("aa".into()), project: Some("modrinth|x".into()) })].into(),
        ..Default::default()
    };
    let s = serde_json::to_string(&r).unwrap();
    let back: PackRecord = serde_json::from_str(&s).unwrap();
    assert_eq!(back.files["mods/a.jar"].project.as_deref(), Some("modrinth|x"));
    assert_eq!(proj_key(&Some((Source::Curseforge, "1".into(), "2".into()))).as_deref(), Some("curseforge|1"));
    assert_eq!(norm_rel(".\\mods\\a.jar"), "mods/a.jar");
}
