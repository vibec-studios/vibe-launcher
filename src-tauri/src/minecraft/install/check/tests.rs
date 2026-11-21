use super::super::assets::AssetObject;
use super::*;

fn index(entries: &[(&str, &str, u64)]) -> AssetIndex {
    let mut idx = AssetIndex::default();
    for (name, hash, size) in entries {
        idx.objects.insert(name.to_string(), AssetObject { hash: hash.to_string(), size: *size });
    }
    idx
}

fn put(objects: &Path, hash: &str, bytes: &[u8]) {
    let dir = objects.join(&hash[..2]);
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(dir.join(hash), bytes).unwrap();
}

#[test]
fn detects_missing_wrong_size_and_missing_prefix() {
    let dir = crate::util::testdir::TestDir::new("assets-scan");
    let objects = dir.path();
    put(objects, "aa01", b"ok");
    put(objects, "aa02", b"falsch");
    put(objects, "bb01", b"xyz");
    let idx = index(&[("a", "aa01", 2), ("b", "aa02", 2), ("c", "aa03", 1), ("d", "bb01", 3), ("e", "cc01", 4), ("f", "aa01", 2)]);
    assert_eq!(missing_assets(objects, &idx), 3);
    put(objects, "aa02", b"ok");
    put(objects, "aa03", b"1");
    put(objects, "cc01", b"1234");
    assert_eq!(missing_assets(objects, &idx), 0);
}

#[test]
fn empty_index_has_nothing_missing() {
    let dir = crate::util::testdir::TestDir::new("assets-scan");
    assert_eq!(missing_assets(dir.path(), &AssetIndex::default()), 0);
}
