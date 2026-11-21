use super::*;

#[test]
fn facets() {
    let q = SearchQuery {
        source: Source::Modrinth,
        query: "".into(),
        project_type: ProjectType::Mod,
        game_version: Some("1.20.1".into()),
        loader: Some(LoaderKind::Quilt),
        categories: vec!["technology".into()],
        sort: SortOrder::Downloads,
        offset: 0,
        limit: 20,
        created_after: None,
    };
    assert_eq!(
        build_facets(&q),
        r#"[["project_type:mod"],["versions:1.20.1"],["categories:quilt","categories:fabric"],["categories:technology"]]"#
    );
    let q2 = SearchQuery { project_type: ProjectType::Shader, loader: Some(LoaderKind::Fabric), categories: vec![], ..q };
    assert_eq!(build_facets(&q2), r#"[["project_type:shader"],["versions:1.20.1"]]"#);
    let q3 = SearchQuery { game_version: None, created_after: Some(1_757_000_000), ..q2 };
    assert_eq!(build_facets(&q3), r#"[["project_type:shader"],["created_timestamp>1757000000"]]"#);
}

#[test]
fn search_hit_banner() {
    let h: MrHit = serde_json::from_str(
        r#"{"project_id":"a","title":"A","gallery":["g1","g2"],"featured_gallery":"f","color":123,"date_created":"2025-01-01T00:00:00Z"}"#,
    )
    .unwrap();
    assert_eq!(h.featured_gallery.as_deref(), Some("f"));
    assert_eq!(h.gallery.len(), 2);
    assert_eq!(h.color, Some(123));
}

#[test]
fn version_mapping() {
    let raw = r#"{"id":"abc","project_id":"P1","name":"Sodium 0.5","version_number":"mc1.20.1-0.5.3","changelog":"",
          "dependencies":[{"version_id":null,"project_id":"P2","file_name":null,"dependency_type":"required"},
                          {"project_id":"P3","dependency_type":"incompatible"}],
          "game_versions":["1.20.1"],"version_type":"beta","loaders":["fabric","quilt"],"date_published":"2023-01-01T00:00:00Z",
          "downloads":5,"files":[{"hashes":{"sha1":"aa","sha512":"bb"},"url":"https://cdn.modrinth.com/x.jar","filename":"x.jar","primary":true,"size":10}]}"#;
    let v: MrVersion = serde_json::from_str(raw).unwrap();
    let pv = convert_version(v);
    assert_eq!(pv.release_type, "beta");
    assert_eq!(pv.changelog, None);
    assert_eq!(pv.dependencies[0].kind, DependencyKind::Required);
    assert_eq!(pv.dependencies[1].kind, DependencyKind::Incompatible);
    assert_eq!(pv.files[0].sha512.as_deref(), Some("bb"));
}

#[test]
fn pretty() {
    assert_eq!(pretty_name("game-mechanics"), "Game Mechanics");
    assert_eq!(pretty_name("worldgen"), "Worldgen");
}
