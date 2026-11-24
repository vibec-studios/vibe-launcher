use super::super::{inspect, PackIssue};
use super::*;

fn issue(env: &Env, files: &[(&str, &[u8])]) -> PackIssue {
    let p = env.zip("bad.zip", files);
    inspect(&env.paths, &p).expect_err("ungültiges Pack")
}

fn manifest_bytes() -> Vec<u8> {
    manifest().to_string().into_bytes()
}

#[test]
fn preview_computes_hashes_and_sizes() {
    let env = Env::new("cl-preview");
    let p = inspect(&env.paths, &env.pack(&manifest())).unwrap();
    assert_eq!((p.id.as_str(), p.name.as_str(), p.loader_version.as_str()), ("example", "Example Loader", "0.1.0"));
    assert_eq!((p.library_count, p.local_count), (2, 1));
    assert_eq!(p.library_bytes, JAR.len() as u64 + 123);
    assert_eq!(p.remote.len(), 1);
    assert_eq!(p.remote[0].url, "https://repo1.maven.org/maven2/org/ow2/asm/asm/9.7/asm-9.7.jar");
    assert_eq!(p.jvm_args, vec!["-Dexample.flag=true"]);
    assert!(p.icon.as_deref().is_some_and(|i| i.starts_with("data:image/png;base64,")));
    assert!(!p.exists && p.installed_versions.is_empty());
}

#[test]
fn rejects_unsafe_paths() {
    let env = Env::new("cl-unsafe");
    let m = manifest_bytes();
    for bad in ["../evil.jar", "/abs.jar", "a/../../evil.jar", "a\\..\\evil.jar", "C:/evil.jar", "./x.jar"] {
        let i = issue(&env, &[("vibeloader.json", &m), (bad, b"x")]);
        assert_eq!(i.code, "unsafe_path", "{bad}");
    }
}

#[test]
fn rejects_missing_or_broken_parts() {
    let env = Env::new("cl-parts");
    let m = manifest_bytes();
    assert_eq!(issue(&env, &[("icon.png", PNG)]).code, "manifest_missing");
    assert_eq!(issue(&env, &[("sub/vibeloader.json", &m)]).code, "manifest_missing");
    assert_eq!(issue(&env, &[("vibeloader.json", &m), ("libraries/example-loader-0.1.0.jar", JAR)]).code, "icon_missing");
    assert_eq!(issue(&env, &[("vibeloader.json", &m), ("icon.png", b"GIF89a"), ("libraries/example-loader-0.1.0.jar", JAR)]).code, "icon_invalid");
    let big = vec![0u8; 512 * 1024 + 1];
    assert_eq!(issue(&env, &[("vibeloader.json", &m), ("icon.png", &big)]).code, "icon_too_big");
    assert_eq!(issue(&env, &[("vibeloader.json", &m), ("icon.png", PNG)]).code, "library_file_missing");
    assert_eq!(issue(&env, &[("vibeloader.json", &m), ("icon.png", PNG), ("libraries/example-loader-0.1.0.jar", b"")]).code, "library_file_empty");
    let huge = vec![b' '; 1024 * 1024 + 1];
    assert_eq!(issue(&env, &[("vibeloader.json", &huge)]).code, "manifest_too_big");
    std::fs::write(env.dir.path().join("plain.zip"), b"not a zip").unwrap();
    assert_eq!(inspect(&env.paths, &env.dir.path().join("plain.zip")).unwrap_err().code, "not_zip");
}

#[test]
fn rejects_too_many_entries() {
    let env = Env::new("cl-entries");
    let m = manifest_bytes();
    let names: Vec<String> = (0..1000).map(|i| format!("f{i}.txt")).collect();
    let mut files: Vec<(&str, &[u8])> = vec![("vibeloader.json", &m)];
    files.extend(names.iter().map(|n| (n.as_str(), b"x" as &[u8])));
    let i = issue(&env, &files);
    assert_eq!((i.code, i.params["n"].as_str()), ("too_many_entries", "1001"));
}

#[test]
fn rejects_unpacked_size_over_limit() {
    let env = Env::new("cl-size");
    let m = manifest_bytes();
    let zeros = vec![0u8; 301 * 1024 * 1024];
    assert_eq!(issue(&env, &[("vibeloader.json", &m), ("blob.bin", &zeros)]).code, "too_big");
}
