use super::*;

#[test]
fn neoforge_mapping() {
    assert_eq!(neoforge_mc("21.1.77").as_deref(), Some("1.21.1"));
    assert_eq!(neoforge_mc("21.0.5-beta").as_deref(), Some("1.21"));
    assert_eq!(neoforge_mc("20.4.80-beta").as_deref(), Some("1.20.4"));
    assert_eq!(neoforge_mc("20.2.3-beta").as_deref(), Some("1.20.2"));
    assert_eq!(neoforge_mc("21.11.12").as_deref(), Some("1.21.11"));
    assert_eq!(neoforge_mc("26.1.0.5-beta").as_deref(), Some("26.1"));
    assert_eq!(neoforge_mc("26.3.0.110").as_deref(), Some("26.3"));
    assert_eq!(neoforge_mc("26.1.2.7").as_deref(), Some("26.1.2"));
    assert_eq!(neoforge_mc("0.25w14craftmine.3-beta"), None);
}

#[test]
fn forge_split() {
    assert_eq!(split_forge_version("1.20.1-47.3.0"), Some(("1.20.1".into(), "47.3.0".into())));
    assert_eq!(split_forge_version("1.7.10-10.13.4.1614-1.7.10"), Some(("1.7.10".into(), "10.13.4.1614".into())));
    assert_eq!(split_forge_version("1.10-12.18.0.2000-1.10.0"), Some(("1.10".into(), "12.18.0.2000".into())));
    assert_eq!(split_forge_version("26.3-66.1.8"), Some(("26.3".into(), "66.1.8".into())));
    let idx = ForgeIndex { versions: vec!["1.7.10-10.13.4.1614-1.7.10".into(), "1.20.1-47.3.0".into()], promos: HashMap::new() };
    assert_eq!(forge_full_version(Some(&idx), "1.7.10", "10.13.4.1614"), "1.7.10-10.13.4.1614-1.7.10");
    assert_eq!(forge_full_version(Some(&idx), "1.20.1", "47.3.0"), "1.20.1-47.3.0");
    assert_eq!(forge_full_version(None, "1.20.1", "1.20.1-47.3.0"), "1.20.1-47.3.0");
}

#[test]
fn version_cmp() {
    assert_eq!(cmp_version("21.1.77", "21.1.9"), Ordering::Greater);
    assert_eq!(cmp_version("20.2.3-beta", "20.2.3"), Ordering::Less);
    assert_eq!(cmp_version("47.3.0", "47.10.0"), Ordering::Less);
}
