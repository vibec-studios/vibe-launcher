use super::*;

fn entry(version_id: &str, sha1: &str, date: &str, release_type: Option<&str>) -> IndexEntry {
    IndexEntry {
        source: Source::Modrinth,
        project_id: "P1OZGk5p".into(),
        version_id: version_id.into(),
        sha1: Some(sha1.into()),
        sha512: None,
        title: None,
        icon_url: None,
        version_number: None,
        url: None,
        size: None,
        date: Some(date.into()),
        release_type: release_type.map(Into::into),
        side: None,
    }
}

fn version(id: &str, sha1: &str, date: &str) -> ProjectVersion {
    ProjectVersion {
        source: Source::Modrinth,
        id: id.into(),
        project_id: "P1OZGk5p".into(),
        name: id.into(),
        version_number: id.into(),
        game_versions: vec![],
        loaders: vec!["fabric".into()],
        release_type: "release".into(),
        date: date.into(),
        downloads: 0,
        files: vec![VersionFile { url: None, filename: "a.jar".into(), size: 1, sha1: Some(sha1.into()), primary: true, sha512: None, fingerprint: None }],
        dependencies: vec![],
        changelog: None,
    }
}

#[test]
fn same_file_under_another_version_is_no_update() {
    let e = entry("MBRBVfoZ", "952dcb4e", "2026-11-24T18:49:38Z", Some("release"));
    let nv = version("7kZCSaR5", "952DCB4E", "2026-11-24T18:49:39Z");
    assert!(!is_newer(&e, Some("952dcb4e"), &nv));
}

#[test]
fn newer_file_is_an_update() {
    let e = entry("old", "aaaa", "2026-10-27T19:47:00Z", Some("release"));
    let nv = version("new", "bbbb", "2026-11-24T18:49:36Z");
    assert!(is_newer(&e, Some("aaaa"), &nv));
}

#[test]
fn same_or_older_version_is_no_update() {
    let e = entry("cur", "aaaa", "2026-11-24T18:49:36Z", Some("release"));
    assert!(!is_newer(&e, Some("aaaa"), &version("cur", "cccc", "2026-11-25T00:00:00Z")));
    assert!(!is_newer(&e, Some("aaaa"), &version("older", "dddd", "2026-11-01T00:00:00Z")));
}

#[test]
fn release_channel_follows_installed_version() {
    assert!(wants_release(&entry("a", "a", "d", Some("release"))));
    assert!(wants_release(&entry("a", "a", "d", None)));
    assert!(!wants_release(&entry("a", "a", "d", Some("beta"))));
    assert!(!wants_release(&entry("a", "a", "d", Some("alpha"))));
}
