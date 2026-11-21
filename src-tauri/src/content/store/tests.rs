use super::*;

const SAMPLE: &str = r#"{
      "format":"vibe-store","version":1,"id":"test-store","name":"Test",
      "projects":[{"id":"hh-armors","title":"H&H Armors","description":"Rüstungen","project_type":"mod","categories":["equipment"],
        "versions":[
          {"id":"v2-fabric","version_number":"1.1","date":"2026-02-01","game_versions":["1.21.11"],"loaders":["fabric"],
           "files":[{"url":"https://x/a.jar","filename":"a.jar","size":3,"sha1":"ABC"}],
           "dependencies":[{"source":"modrinth","project_id":"P7dR8mSH","kind":"required"},{"source":"self","project_id":"core"}]},
          {"id":"v1-neo","version_number":"1.0","release_type":"beta","date":"2026-01-01","game_versions":["1.21.1"],"loaders":["neoforge"],"files":[{"url":"https://x/b.jar","size":3}]}
        ]}]}"#;

#[test]
fn official_store_same_under_old_and_new_url() {
    assert_eq!(DEFAULT_URL, "https://vibe.axolite.app/api/v1/store.json");
    assert!(same_url(DEFAULT_URL, crate::domains::LEGACY_STORE_URL));
    assert!(same_url("https://example.org/a.json", "https://example.org/a.json"));
    assert!(!same_url(DEFAULT_URL, "https://example.org/a.json"));
}

#[test]
fn parse_and_convert() {
    let f: StoreFile = serde_json::from_str(SAMPLE).unwrap();
    validate(&f).unwrap();
    let key = StoreKey::intern("test-store");
    let h = hit(key, &f, &f.projects[0]);
    assert_eq!(h.source.as_string(), "store:test-store");
    assert_eq!(h.game_versions, vec!["1.21.11", "1.21.1"]);
    assert_eq!(h.author, "Test");
    let v = convert_version(key, &f.projects[0], &f.projects[0].versions[0]);
    assert_eq!(v.files[0].sha1.as_deref(), Some("abc"));
    assert!(v.files[0].primary);
    assert_eq!(v.dependencies[0].source, Some(Source::Modrinth));
    assert_eq!(v.dependencies[1].source, Some(Source::Store(key)));
    assert_eq!(v.dependencies[1].kind, DependencyKind::Required);
    let v1 = convert_version(key, &f.projects[0], &f.projects[0].versions[1]);
    assert_eq!(v1.release_type, "beta");
    assert_eq!(v1.files[0].filename, "b.jar");
    assert!(matches_loader(&f.projects[0], ProjectType::Mod, Some(LoaderKind::Quilt), Some("1.21.11")));
    assert!(!matches_loader(&f.projects[0], ProjectType::Mod, Some(LoaderKind::Forge), Some("1.21.11")));
}

#[test]
fn source_serde() {
    let s: Source = serde_json::from_str("\"store:vibe-craft-studios\"").unwrap();
    assert_eq!(serde_json::to_string(&s).unwrap(), "\"store:vibe-craft-studios\"");
    assert_eq!(serde_json::from_str::<Source>("\"modrinth\"").unwrap(), Source::Modrinth);
    assert!(serde_json::from_str::<Source>("\"store:\"").is_err());
    assert!(serde_json::from_str::<Source>("\"foo\"").is_err());
}

#[test]
fn invalid_files() {
    let mut f: StoreFile = serde_json::from_str(SAMPLE).unwrap();
    f.version = 2;
    assert!(validate(&f).is_err());
    f.version = 1;
    f.id = "Bad ID!".into();
    assert!(validate(&f).is_err());
    f.id = "ok".into();
    f.format = "x".into();
    assert!(validate(&f).is_err());
}
