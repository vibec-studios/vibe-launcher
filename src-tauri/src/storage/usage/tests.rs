use super::*;

#[test]
fn hardlinked_files_count_once() {
    let data = super::super::test_dir("usage");
    let blob = vec![1u8; MIN_SIZE as usize];
    let mut metas = HashMap::new();
    for id in ["a", "b"] {
        let dir = data.join("instances").join(id);
        std::fs::create_dir_all(dir.join("minecraft/mods")).unwrap();
        std::fs::create_dir_all(dir.join("minecraft/.fabric/processedMods")).unwrap();
        std::fs::write(dir.join("instance.json"), "{}").unwrap();
        std::fs::write(dir.join("minecraft/.fabric/processedMods/x.jar"), b"abc").unwrap();
        metas.insert(id.to_string(), InstanceMeta { name: id.into(), running: id == "b" });
    }
    std::fs::write(data.join("instances/a/minecraft/mods/m.jar"), &blob).unwrap();
    std::fs::hard_link(data.join("instances/a/minecraft/mods/m.jar"), data.join("instances/b/minecraft/mods/m.jar")).unwrap();
    let u = scan(&data, &metas, &[]);
    let inst = u.categories.iter().find(|c| c.id == "instances").unwrap();
    assert_eq!(u.shared_saved, blob.len() as u64);
    assert!(inst.bytes < blob.len() as u64 * 2);
    assert!(u.instances.iter().all(|i| i.shared == blob.len() as u64 && i.bytes > blob.len() as u64));
    let caches = u.categories.iter().find(|c| c.id == "mod_caches").unwrap();
    assert_eq!((caches.bytes, caches.cleanable), (6, 3));
    assert_eq!(FolderKind::of("Distant_Horizons_server_data"), FolderKind::Rebuild);
    assert!(!FolderKind::of("saves").clearable());
}

#[test]
fn vibey_leftovers_are_offered_not_unknown() {
    let data = super::super::test_dir("vibey");
    std::fs::create_dir_all(data.join("vibey/cosmetics")).unwrap();
    std::fs::write(data.join("vibey/cosmetics/a.bin"), vec![1u8; 100]).unwrap();
    std::fs::create_dir_all(data.join("instances/a/minecraft")).unwrap();
    std::fs::write(data.join("instances/a/instance.json"), "{}").unwrap();
    std::fs::write(data.join("instances/a/vibey-client.json"), vec![b' '; 20]).unwrap();
    let metas = HashMap::from([("a".to_string(), InstanceMeta { name: "a".into(), running: false })]);
    let u = scan(&data, &metas, &[]);
    let cat = |id: &str| u.categories.iter().find(|c| c.id == id).unwrap().clone();
    assert_eq!((cat("vibey").bytes, cat("vibey").cleanable), (120, 120));
    assert_eq!(cat("other").bytes, 0);
    assert_eq!(super::super::vibey::clear(&data), 120);
    assert!(!data.join("vibey").exists() && !data.join("instances/a/vibey-client.json").exists());
    assert!(data.join("instances/a/instance.json").exists());
}
