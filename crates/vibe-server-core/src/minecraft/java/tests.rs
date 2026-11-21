use super::*;
#[test]
fn majors() {
    assert_eq!(parse_major("1.8.0_392"), 8);
    assert_eq!(parse_major("21.0.5"), 21);
    assert_eq!(parse_major("17"), 17);
    assert_eq!(parse_major("25-ea"), 25);
}
#[test]
fn props() {
    let out = "Property settings:\n    java.vendor = Eclipse Adoptium\n    java.version = 21.0.5\n    os.arch = amd64\n\nopenjdk version \"21.0.5\"";
    let (v, vendor, arch) = parse_properties(out).unwrap();
    assert_eq!(v, "21.0.5");
    assert_eq!(vendor.as_deref(), Some("Eclipse Adoptium"));
    assert_eq!(arch, "x64");
    let (v, _, _) = parse_properties("java version \"1.8.0_51\"\nJava(TM) SE Runtime").unwrap();
    assert_eq!(v, "1.8.0_51");
}

fn fake_java(root: &Path, lib: &[u8]) -> PathBuf {
    let bin = root.join("bin");
    std::fs::create_dir_all(bin.join("server")).unwrap();
    std::fs::write(bin.join("server").join("jvm.dll"), lib).unwrap();
    let exe = bin.join("java.exe");
    std::fs::write(&exe, b"exe").unwrap();
    exe
}

fn install(path: &Path, version: &str) -> JavaInstall {
    JavaInstall { path: path.to_string_lossy().to_string(), version: version.into(), major: parse_major(version), vendor: None, arch: "x64".into(), managed: true }
}

#[test]
fn probe_cache_hits_until_jvm_changes() {
    let dir = crate::util::testdir::TestDir::new("java-probe");
    let exe = fake_java(dir.path(), b"jvm-21.0.7");
    let file = dir.path().join("meta").join("java-probe.json");
    let stamp = stamp_of(&exe).unwrap();
    let mut store = ProbeStore::load(file.clone());
    assert!(store.get(&exe, &stamp).is_none());
    store.insert(&exe, stamp.clone(), install(&exe, "21.0.7"));
    let reloaded = ProbeStore::load(file.clone());
    assert_eq!(reloaded.get(&exe, &stamp).unwrap().version, "21.0.7");
    std::fs::write(exe.parent().unwrap().join("server").join("jvm.dll"), b"jvm-21.0.11 update").unwrap();
    let changed = stamp_of(&exe).unwrap();
    assert_ne!(changed, stamp);
    assert!(reloaded.get(&exe, &changed).is_none());
}

#[test]
fn probe_cache_ignores_broken_file() {
    let dir = crate::util::testdir::TestDir::new("java-probe-broken");
    let file = dir.path().join("java-probe.json");
    std::fs::write(&file, b"{kaputt").unwrap();
    let exe = fake_java(dir.path(), b"jvm");
    assert!(ProbeStore::load(file).get(&exe, &stamp_of(&exe).unwrap()).is_none());
    assert_eq!(jvm_library(&exe).unwrap().file_name().unwrap(), "jvm.dll");
}
