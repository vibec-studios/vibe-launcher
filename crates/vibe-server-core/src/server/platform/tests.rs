use super::*;

const FILL_VERSIONS: &str = include_str!("../testdata/fill-paper-versions.json");
const FILL_BUILDS: &str = include_str!("../testdata/fill-paper-builds.json");
const PURPUR_PROJECT: &str = include_str!("../testdata/purpur-project.json");
const PURPUR_BUILDS: &str = include_str!("../testdata/purpur-builds.json");

#[test]
fn fill_versions() {
    let v = parse_fill_versions(FILL_VERSIONS.as_bytes()).unwrap();
    assert_eq!(v[0], PlatformVersion { id: "26.3".into(), release: true, supported: true, java_min: Some(25) });
    let rc = v.iter().find(|x| x.id == "26.3-rc-3").unwrap();
    assert!(!rc.release && !rc.supported);
    assert_eq!(v.iter().find(|x| x.id == "1.20.4").unwrap().java_min, Some(17));
}

#[test]
fn fill_version_java() {
    let one = r#"{"version":{"id":"1.21.11","support":{"status":"UNSUPPORTED","end":"2026-06-15"},
        "java":{"version":{"minimum":21},"flags":{"recommended":["-XX:+UseG1GC","-XX:+AlwaysPreTouch"]}}},"builds":[1,2]}"#;
    let (min, flags) = parse_fill_version_java(one.as_bytes());
    assert_eq!(min, Some(21));
    assert_eq!(flags, vec!["-XX:+UseG1GC", "-XX:+AlwaysPreTouch"]);
    assert_eq!(parse_fill_version_java(b"{}"), (None, vec![]));
}

#[test]
fn fill_builds_and_pick() {
    let b = parse_fill_builds(FILL_BUILDS.as_bytes()).unwrap();
    // neueste zuerst, auch wenn die API anders sortiert
    assert_eq!(b.iter().map(|x| x.id.as_str()).collect::<Vec<_>>(), vec!["257", "256", "255", "254"]);
    assert_eq!(b[0].channel, BuildChannel::Alpha);
    assert_eq!(b[1].channel, BuildChannel::Beta);
    assert_eq!(b[2].channel, BuildChannel::Stable);
    assert_eq!(b[2].sha256.as_deref(), Some("a7116085a8ba88cf00771d5e61a2925007942092650811da7327dc23243f0cec"));
    assert_eq!(b[2].file_name, "paper-26.3-255.jar");
    assert_eq!(b[2].summary.as_deref(), Some("Add BlockSpreadEvent for Fire (#14442)"));
    // Auswahl: neuester stabiler; RECOMMENDED zählt als stabil
    assert_eq!(pick_build(&b, None).unwrap().id, "255");
    assert_eq!(b[3].channel, BuildChannel::Stable);
    assert_eq!(pick_build(&b, Some("257")).unwrap().id, "257");
    assert!(pick_build(&b, Some("999")).is_none());
    // nur experimentelle -> neuester
    let exp: Vec<PlatformBuild> = b.iter().filter(|x| x.channel != BuildChannel::Stable).cloned().collect();
    assert_eq!(pick_build(&exp, None).unwrap().id, "257");
    assert!(pick_build(&[], None).is_none());
}

#[test]
fn purpur() {
    let v = parse_purpur_versions(PURPUR_PROJECT.as_bytes()).unwrap();
    assert_eq!(v[0].id, "26.3");
    assert!(v[0].supported && v[0].release);
    assert!(!v[1].supported);
    assert_eq!(v.last().unwrap().id, "1.14.1");
    let b = parse_purpur_builds(PURPUR_BUILDS.as_bytes()).unwrap();
    // FAILURE-Build 2660 fällt weg, experimentell -> Beta
    assert_eq!(b.iter().map(|x| x.id.as_str()).collect::<Vec<_>>(), vec!["2659", "2658", "2657"]);
    assert_eq!(b[0].channel, BuildChannel::Stable);
    assert_eq!(b[1].channel, BuildChannel::Beta);
    assert_eq!(b[0].md5.as_deref(), Some("e6010134e10554cfeb1952c4b520856c"));
    assert_eq!(b[0].url, "https://api.purpurmc.org/v2/purpur/26.3/2659/download");
    assert_eq!(b[0].time.as_deref(), Some("2026-11-16T19:58:27Z"));
    assert_eq!(pick_build(&b, None).unwrap().id, "2659");
}

#[test]
fn releases() {
    assert!(is_release("26.3"));
    assert!(is_release("1.21.11"));
    assert!(!is_release("1.21.11-rc3"));
    assert!(!is_release("26.3-rc-3"));
    assert!(!is_release("1.13-pre7"));
    assert!(!is_release(""));
}

#[test]
fn java_req() {
    assert_eq!(java_requirement(21, Some("java-runtime-delta".into()), Some(21)), (21, Some("java-runtime-delta".into())));
    assert_eq!(java_requirement(17, Some("java-runtime-gamma".into()), Some(21)), (21, None));
    assert_eq!(java_requirement(8, Some("jre-legacy".into()), None), (8, Some("jre-legacy".into())));
}

#[test]
fn checksum_verify() {
    let dir = std::env::temp_dir().join(format!("vibe-plat-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&dir).unwrap();
    let f = dir.join("x.jar");
    std::fs::write(&f, b"hello").unwrap();
    let mut b = PlatformBuild {
        id: "1".into(),
        channel: BuildChannel::Stable,
        time: None,
        summary: None,
        file_name: "x.jar".into(),
        url: String::new(),
        size: None,
        sha256: Some("2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824".into()),
        md5: None,
    };
    assert!(verify(&f, &b).unwrap());
    b.sha256 = Some("00".into());
    assert!(!verify(&f, &b).unwrap());
    b.sha256 = None;
    b.md5 = Some("5d41402abc4b2a76b9719d911017c592".into());
    assert!(verify(&f, &b).unwrap());
    b.md5 = Some("ffff".into());
    assert!(!verify(&f, &b).unwrap());
    let _ = std::fs::remove_dir_all(&dir);
}
