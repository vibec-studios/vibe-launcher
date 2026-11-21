use super::*;

const HREF: &str = "https://api.norisk.gg/api/v1/payback/mod-downloads";

fn sample() -> DownloadList {
    serde_json::from_value(serde_json::json!({
        "release": { "version": "v0.6.30", "publishedAt": "2026-11-15T16:02:47Z", "sizes": {} },
        "mods": [
            { "loader": "fabric", "mcVersion": "26.3", "href": format!("{HREF}/standalone/26.3/fabric/download") },
            { "loader": "fabric", "mcVersion": "1.21.1", "href": format!("{HREF}/standalone/1.21.1/fabric/download") },
            { "loader": "neoforge", "mcVersion": "1.21.1", "href": format!("{HREF}/standalone/1.21.1/neoforge/download") },
            { "loader": "forge", "mcVersion": "1.8.9", "href": format!("{HREF}/standalone/1.8.9/forge/download") },
            // fremder Link wird ignoriert
            { "loader": "fabric", "mcVersion": "1.20.1", "href": "https://evil.example/standalone/1.20.1/fabric/download" }
        ],
        "mini": [
            { "loader": "fabric", "mcVersion": "26.3", "href": format!("{HREF}/mini/26.3/fabric/download") },
            { "loader": "fabric", "mcVersion": "26.2", "href": format!("{HREF}/mini/26.2/fabric/download") },
            // falsches Segment (standalone in der mini-Liste)
            { "loader": "fabric", "mcVersion": "1.21.1", "href": format!("{HREF}/standalone/1.21.1/fabric/download") }
        ],
        "neuesFeld": 1
    }))
    .unwrap()
}

#[test]
fn select_matches_version_and_loader() {
    let l = sample();
    let e = l.select(Flavor::Standalone, "26.3", LoaderKind::Fabric).unwrap();
    assert!(e.href.ends_with("/standalone/26.3/fabric/download"));
    assert!(l.select(Flavor::Standalone, "1.21.1", LoaderKind::Neoforge).is_some());
    // Version gibt es nur für einen anderen Loader
    assert!(l.select(Flavor::Standalone, "26.3", LoaderKind::Neoforge).is_none());
    // Prefix-Treffer zählen nicht (26.3 ≠ 26.3.1, 1.21 ≠ 1.21.1)
    assert!(l.select(Flavor::Standalone, "26.3.1", LoaderKind::Fabric).is_none());
    assert!(l.select(Flavor::Standalone, "1.21", LoaderKind::Fabric).is_none());
    // Quilt/Vanilla gibt es nicht
    assert!(l.select(Flavor::Standalone, "26.3", LoaderKind::Quilt).is_none());
    assert!(l.select(Flavor::Standalone, "26.3", LoaderKind::Vanilla).is_none());
    // Mini getrennt von Standalone
    assert!(l.select(Flavor::Mini, "26.2", LoaderKind::Fabric).is_some());
    assert!(l.select(Flavor::Standalone, "26.2", LoaderKind::Fabric).is_none());
    // ungültige Links werden übersprungen
    assert!(l.select(Flavor::Standalone, "1.20.1", LoaderKind::Fabric).is_none());
    assert!(l.select(Flavor::Mini, "1.21.1", LoaderKind::Fabric).is_none());
    // Loader-Groß-/Kleinschreibung egal
    let mut l2 = l.clone();
    l2.mods[0].loader = "Fabric".into();
    assert!(l2.select(Flavor::Standalone, "26.3", LoaderKind::Fabric).is_some());
}

#[test]
fn versions_per_loader() {
    let l = sample();
    assert_eq!(l.mc_versions(Flavor::Standalone, LoaderKind::Fabric), vec!["26.3", "1.21.1"]);
    assert_eq!(l.mc_versions(Flavor::Standalone, LoaderKind::Forge), vec!["1.8.9"]);
    assert_eq!(l.mc_versions(Flavor::Mini, LoaderKind::Fabric), vec!["26.3", "26.2"]);
    assert!(l.mc_versions(Flavor::Mini, LoaderKind::Quilt).is_empty());
}

#[test]
fn hrefs() {
    assert!(valid_href(&format!("{HREF}/mini/26.3/fabric/download"), Flavor::Mini));
    assert!(!valid_href(&format!("{HREF}/mini/26.3/fabric/download"), Flavor::Standalone));
    assert!(!valid_href(&format!("{HREF}/mini/../fabric/download"), Flavor::Mini));
    assert!(!valid_href(&format!("{HREF}/mini/26.3/fabric/download?x=1"), Flavor::Mini));
    assert!(!valid_href(&format!("{HREF}/mini/26.3/fabric"), Flavor::Mini));
    assert!(!valid_href("http://api.norisk.gg/api/v1/payback/mod-downloads/mini/26.3/fabric/download", Flavor::Mini));
    assert!(!valid_href("https://api.norisk.gg.evil.example/api/v1/payback/mod-downloads/mini/26.3/fabric/download", Flavor::Mini));
}

#[test]
fn redirect_hosts() {
    assert!(allowed_host(&Url::parse("https://maven.norisk.gg/x.jar").unwrap()));
    assert!(allowed_host(&Url::parse("https://norisk.gg/x").unwrap()));
    assert!(!allowed_host(&Url::parse("http://maven.norisk.gg/x.jar").unwrap()));
    assert!(!allowed_host(&Url::parse("https://evilnorisk.gg/x.jar").unwrap()));
    assert!(!allowed_host(&Url::parse("https://maven.norisk.gg.evil.example/x.jar").unwrap()));
}

#[test]
fn file_and_version() {
    let u = Url::parse("https://maven.norisk.gg/repository/norisk-production/gg/norisk/nrc-mini/26.4.3940900+fabric.26.3/nrc-mini-26.4.3940900+fabric.26.3.jar").unwrap();
    let f = file_from_url(&u).unwrap();
    assert_eq!(f, "nrc-mini-26.4.3940900+fabric.26.3.jar");
    let v = version_from_file(&f, Flavor::Mini).unwrap();
    assert_eq!(v, "26.4.3940900+fabric.26.3");
    assert_eq!(display_version(&v), "26.4.3940900");
    assert_eq!(version_from_file(&f, Flavor::Standalone), None);
    // %2B wird dekodiert
    let u2 = Url::parse("https://maven.norisk.gg/a/nrc-standalone-26.4.1%2Bfabric.26.3.jar").unwrap();
    assert_eq!(file_from_url(&u2).unwrap(), "nrc-standalone-26.4.1+fabric.26.3.jar");
    // keine Pfade/fremden Endungen
    assert!(file_from_url(&Url::parse("https://maven.norisk.gg/a/evil.exe").unwrap()).is_none());
    assert!(file_from_url(&Url::parse("https://maven.norisk.gg/a/..%2Fevil.jar").unwrap()).is_none());
}
