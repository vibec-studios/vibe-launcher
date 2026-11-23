use super::*;
use crate::util::testdir::TestDir;

#[test]
fn activates_staged_package_and_cleans_up() {
    let t = TestDir::new("vibefix-store");
    let store = Store::new(t.path());
    let s = Signer::new();
    let old = store.staging().unwrap();
    let m3 = write_package(&old, &s, "3");
    store.activate(&old, &m3, &s.public).unwrap();
    assert_eq!(store.current().as_deref(), Some("3"));
    let staged = store.staging().unwrap();
    let m4 = write_package(&staged, &s, "4");
    store.activate(&staged, &m4, &s.public).unwrap();
    assert_eq!(store.current().as_deref(), Some("4"));
    let pkg = store.read_package(&s.public).unwrap();
    assert_eq!(pkg.manifest.version, "4");
    assert_eq!(pkg.weights, package_files("4")[2].1);
    let dirs: Vec<String> =
        std::fs::read_dir(&store.dir).unwrap().flatten().filter(|e| e.path().is_dir()).map(|e| e.file_name().to_string_lossy().into()).collect();
    assert_eq!(dirs, vec!["4".to_string()]);
}

#[test]
fn hash_mismatch_blocks_activation() {
    let t = TestDir::new("vibefix-hash");
    let store = Store::new(t.path());
    let s = Signer::new();
    let first = store.staging().unwrap();
    let m3 = write_package(&first, &s, "3");
    store.activate(&first, &m3, &s.public).unwrap();
    let staged = store.staging().unwrap();
    let m4 = write_package(&staged, &s, "4");
    std::fs::write(staged.join("weights.bin"), b"manipuliert").unwrap();
    assert_eq!(store.activate(&staged, &m4, &s.public), Err(ModelError::Mismatch("weights.bin".into())));
    assert_eq!(store.current().as_deref(), Some("3"));
    assert!(store.read_package(&s.public).is_ok());
}

#[test]
fn local_files_are_verified_on_every_load() {
    let t = TestDir::new("vibefix-local");
    let store = Store::new(t.path());
    let s = Signer::new();
    let staged = store.staging().unwrap();
    let m = write_package(&staged, &s, "3");
    store.activate(&staged, &m, &s.public).unwrap();
    let dir = store.version_dir("3");
    let mut cfg = std::fs::read(dir.join("config.json")).unwrap();
    cfg.push(b' ');
    std::fs::write(dir.join("config.json"), cfg).unwrap();
    assert_eq!(store.read_package(&s.public).err(), Some(ModelError::Mismatch("config.json".into())));
    std::fs::write(dir.join("config.json"), &package_files("3")[0].1).unwrap();
    assert!(store.read_package(&s.public).is_ok());
    assert_eq!(store.read_package(&Signer::new().public).err(), Some(ModelError::Signature));
    store.reset();
    assert_eq!(store.current(), None);
    assert_eq!(store.read_package(&s.public).err(), Some(ModelError::Missing));
}

#[test]
fn rejects_unsafe_current_pointer() {
    let t = TestDir::new("vibefix-current");
    let store = Store::new(t.path());
    std::fs::create_dir_all(&store.dir).unwrap();
    std::fs::write(store.dir.join("current.json"), br#"{"version": "../../x"}"#).unwrap();
    assert_eq!(store.current(), None);
}

#[test]
fn check_state_round_trips() {
    let t = TestDir::new("vibefix-state");
    let store = Store::new(t.path());
    assert_eq!(store.state(), CheckState::default());
    let st = CheckState { checked_at: Some(1), failed_at: Some(2), remote_version: Some("3".into()) };
    store.save_state(&st);
    assert_eq!(store.state(), st);
}
