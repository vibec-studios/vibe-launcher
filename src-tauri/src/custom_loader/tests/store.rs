use super::super::{delete, import, inspect, list, load, pack_dir};
use super::*;

#[test]
fn import_stores_normalized_pack() {
    let env = Env::new("cl-import");
    let p = import(&env.paths, &env.pack(&manifest()), false).unwrap();
    assert_eq!((p.id.as_str(), p.loader_version.as_str(), p.library_count), ("example", "0.1.0", 2));
    let dir = pack_dir(&env.paths, "example", "0.1.0");
    assert_eq!(p.icon_path.as_deref(), Some(dir.join("icon.png").to_string_lossy().as_ref()));
    let rel = "libraries/com/example/example-loader/0.1.0/example-loader-0.1.0.jar";
    assert_eq!(std::fs::read(dir.join(rel)).unwrap(), JAR);
    let m = load(&env.paths, "example", "0.1.0").unwrap();
    let lib = &m.profile.libraries[0];
    assert_eq!(lib.file.as_deref(), Some(rel));
    assert_eq!(lib.sha1.as_deref(), Some(sha1(JAR).as_str()));
    assert_eq!(lib.size, Some(JAR.len() as u64));
    assert_eq!(m.icon.as_deref(), Some("icon.png"));
    assert!(std::fs::read_dir(super::super::root(&env.paths)).unwrap().flatten().all(|e| !e.file_name().to_string_lossy().starts_with('.')));
}

#[test]
fn existing_pack_needs_replace_and_versions_coexist() {
    let env = Env::new("cl-replace");
    import(&env.paths, &env.pack(&manifest()), false).unwrap();
    let again = import(&env.paths, &env.pack(&manifest()), false).unwrap_err().to_string();
    assert!(again.contains("schon installiert"), "{again}");
    let pv = inspect(&env.paths, &env.pack(&manifest())).unwrap();
    assert!(pv.exists && pv.installed_versions == vec!["0.1.0"]);
    let mut renamed = manifest();
    renamed["name"] = json!("Example Loader Neu");
    import(&env.paths, &env.pack(&renamed), true).unwrap();
    assert_eq!(load(&env.paths, "example", "0.1.0").unwrap().name, "Example Loader Neu");
    let mut v2 = manifest();
    v2["loader_version"] = json!("0.2.0");
    import(&env.paths, &env.pack(&v2), false).unwrap();
    let all: Vec<String> = list(&env.paths).into_iter().map(|p| format!("{} {}", p.id, p.loader_version)).collect();
    assert_eq!(all, vec!["example 0.1.0", "example 0.2.0"]);
    delete(&env.paths, "example", "0.1.0").unwrap();
    assert_eq!(list(&env.paths).len(), 1);
    delete(&env.paths, "example", "0.2.0").unwrap();
    assert!(!super::super::root(&env.paths).join("example").exists());
}

#[test]
fn broken_pack_leaves_nothing_behind() {
    let env = Env::new("cl-broken");
    let bytes = manifest().to_string();
    let p = env.zip("broken.zip", &[("vibeloader.json", bytes.as_bytes()), ("icon.png", PNG)]);
    assert!(import(&env.paths, &p, false).is_err());
    assert!(list(&env.paths).is_empty());
    assert!(!pack_dir(&env.paths, "example", "0.1.0").exists());
}

#[test]
fn load_rejects_traversal_refs() {
    let env = Env::new("cl-refs");
    assert!(load(&env.paths, "..", "0.1.0").is_err());
    assert!(load(&env.paths, "example", "../x").is_err());
    assert!(delete(&env.paths, "example", "..").is_err());
}
