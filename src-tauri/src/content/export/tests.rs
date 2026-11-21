use super::*;
#[test]
fn known_entries() {
    let mut idx = ContentIndex::default();
    idx.files.insert(
        "mods/a.jar".into(),
        IndexEntry {
            source: Source::Modrinth,
            project_id: "P".into(),
            version_id: "V".into(),
            sha1: Some("aa".into()),
            sha512: None,
            title: None,
            icon_url: None,
            version_number: None,
            url: None,
            size: None,
            date: None,
            release_type: None,
            side: None,
        },
    );
    idx.local.insert("mods/a.jar".into(), index::LocalMeta { sha1: Some("AA".into()), ..Default::default() });
    assert!(known(&idx, "mods/a.jar").is_some());
    assert!(known(&idx, "mods/a.jar.disabled").is_none());
    assert!(known(&idx, "config/a.jar").is_none());
    idx.local.insert("mods/a.jar".into(), index::LocalMeta { sha1: Some("bb".into()), ..Default::default() });
    assert!(known(&idx, "mods/a.jar").is_none(), "Datei wurde ersetzt");
    assert_eq!(compression("mods/x.JAR"), zip::CompressionMethod::Stored);
    assert_eq!(compression("config/x.toml"), zip::CompressionMethod::Deflated);
}
