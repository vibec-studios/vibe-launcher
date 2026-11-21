use super::*;

struct Fx {
    base: PathBuf,
    root: PathBuf,
    game: PathBuf,
    inst: PathBuf,
}

fn fx() -> Fx {
    let base = std::env::temp_dir().join(format!("vl-snap-{}", uuid::Uuid::new_v4()));
    let inst = base.join("instances").join("i1");
    let game = inst.join("minecraft");
    std::fs::create_dir_all(game.join("mods")).unwrap();
    std::fs::create_dir_all(game.join("config/sub")).unwrap();
    std::fs::create_dir_all(game.join("saves/Welt")).unwrap();
    std::fs::write(game.join("mods/a.jar"), b"jar-a").unwrap();
    std::fs::write(game.join("mods/b.jar"), b"jar-b").unwrap();
    std::fs::write(game.join("mods/c.jar.disabled"), b"jar-a").unwrap(); // gleicher Inhalt wie a.jar
    std::fs::write(game.join("config/x.toml"), b"x = 1").unwrap();
    std::fs::write(game.join("config/sub/y.json"), b"{}").unwrap();
    std::fs::write(game.join("options.txt"), b"fov:70").unwrap();
    std::fs::write(game.join("saves/Welt/level.dat"), b"lvl").unwrap();
    std::fs::write(inst.join("content.json"), b"{\"a\":1}").unwrap();
    Fx { root: base.join("backups"), base, game, inst }
}

fn tree(game: &Path, inst: &Path) -> Vec<(String, String)> {
    let f = scan(game, inst, &Sel::all()).unwrap();
    let mut v: Vec<(String, String)> = f.files.iter().map(|(r, p, _, _)| (r.clone(), crate::net::sha1_file(p).unwrap())).collect();
    v.extend(f.meta.iter().map(|(r, p, _)| (format!("@{r}"), crate::net::sha1_file(p).unwrap())));
    v.extend(f.dirs.iter().map(|d| (format!("{d}/"), String::new())));
    v.sort();
    v
}

fn objects(root: &Path) -> usize {
    walkdir::WalkDir::new(root.join("objects")).into_iter().flatten().filter(|e| e.file_type().is_file()).count()
}

#[test]
fn dedupe_and_gc() {
    let f = fx();
    let p = ();
    let s1 = create_sync(&f.root, "i1", &f.game, &f.inst, "eins", false, &Sel::all(), &p).unwrap();
    assert_eq!(s1.files.len(), 6);
    assert_eq!(s1.meta.len(), 1);
    assert!(!s1.files.iter().any(|e| e.rel_path.starts_with("saves")));
    // a.jar und c.jar.disabled teilen sich ein Objekt
    assert_eq!(objects(&f.root), 6);
    // Zweiter Snapshot ohne Änderung: keine neuen Objekte
    let s2 = create_sync(&f.root, "i1", &f.game, &f.inst, "", true, &Sel::all(), &p).unwrap();
    assert!(s2.name.starts_with("Snapshot vom"));
    assert_eq!(objects(&f.root), 6);
    // Neue Config -> ein neues Objekt
    std::fs::write(f.game.join("config/x.toml"), b"x = 2").unwrap();
    let s3 = create_sync(&f.root, "i1", &f.game, &f.inst, "drei", false, &Sel::all(), &p).unwrap();
    assert_eq!(objects(&f.root), 7);
    // Löschen von s3 + GC entfernt nur das neue Objekt
    std::fs::remove_file(snapshot_dir(&f.root, "i1").join(format!("{}.json", s3.id))).unwrap();
    assert_eq!(gc(&f.root).unwrap(), 1);
    assert_eq!(objects(&f.root), 6);
    // Alle löschen -> Speicher leer
    for s in [&s1, &s2] {
        std::fs::remove_file(snapshot_dir(&f.root, "i1").join(format!("{}.json", s.id))).unwrap();
    }
    gc(&f.root).unwrap();
    assert_eq!(objects(&f.root), 0);
    std::fs::remove_dir_all(&f.base).ok();
}

#[test]
fn restore_matches_exactly() {
    let f = fx();
    let p = ();
    let before = tree(&f.game, &f.inst);
    let s = create_sync(&f.root, "i1", &f.game, &f.inst, "eins", false, &Sel::all(), &p).unwrap();
    // Ändern: Mod löschen, Mod hinzufügen, Config ändern, Ordner hinzufügen/entfernen, Metadaten ändern
    std::fs::remove_file(f.game.join("mods/b.jar")).unwrap();
    std::fs::write(f.game.join("mods/neu.jar"), b"neu").unwrap();
    std::fs::write(f.game.join("config/x.toml"), b"x = 99").unwrap();
    std::fs::remove_dir_all(f.game.join("config/sub")).unwrap();
    std::fs::create_dir_all(f.game.join("kubejs/scripts")).unwrap();
    std::fs::write(f.game.join("kubejs/scripts/a.js"), b"//").unwrap();
    std::fs::write(f.inst.join("content.json"), b"{}").unwrap();
    std::fs::write(f.inst.join("pack.json"), b"{}").unwrap();
    std::fs::write(f.game.join("saves/Welt/neu.dat"), b"bleibt").unwrap();
    assert_ne!(tree(&f.game, &f.inst), before);
    restore_sync(&f.root, "i1", &f.game, &f.inst, &s, &p).unwrap();
    assert_eq!(tree(&f.game, &f.inst), before);
    // Welten werden nicht angefasst
    assert!(f.game.join("saves/Welt/neu.dat").exists());
    assert!(!f.inst.join("pack.json").exists());
    // Config ist eine eigene Kopie: Ändern verändert das Objekt nicht
    std::fs::write(f.game.join("config/x.toml"), b"x = 5").unwrap();
    let e = s.files.iter().find(|e| e.rel_path == "config/x.toml").unwrap();
    assert_eq!(std::fs::read(object_path(&f.root, &e.sha1)).unwrap(), b"x = 1");
    std::fs::remove_dir_all(&f.base).ok();
}

#[cfg(unix)]
#[test]
fn jars_are_hard_links() {
    use std::os::unix::fs::MetadataExt;
    let f = fx();
    let s = create_sync(&f.root, "i1", &f.game, &f.inst, "eins", false, &Sel::all(), &()).unwrap();
    let e = s.files.iter().find(|e| e.rel_path == "mods/b.jar").unwrap();
    let a = std::fs::metadata(f.game.join("mods/b.jar")).unwrap();
    let b = std::fs::metadata(object_path(&f.root, &e.sha1)).unwrap();
    assert_eq!(a.ino(), b.ino());
    std::fs::remove_dir_all(&f.base).ok();
}

#[test]
fn prune_keeps_manual_and_protected() {
    let f = fx();
    let p = ();
    let manual = create_sync(&f.root, "i1", &f.game, &f.inst, "manuell", false, &Sel::all(), &p).unwrap();
    let mut autos = vec![];
    for n in 0..4 {
        std::fs::write(f.game.join("config/x.toml"), format!("x = {n}")).unwrap();
        autos.push(create_sync(&f.root, "i1", &f.game, &f.inst, "auto", true, &Sel::all(), &p).unwrap());
        std::thread::sleep(std::time::Duration::from_millis(3));
    }
    // Ältester automatischer ist geschützt
    prune_auto(&f.root, "i1", 2, &[autos[0].id.as_str()]).unwrap();
    let ids: Vec<String> = manifests(&f.root, "i1").into_iter().map(|m| m.id).collect();
    assert!(ids.contains(&manual.id));
    assert!(ids.contains(&autos[0].id));
    assert!(!ids.contains(&autos[1].id));
    assert!(ids.contains(&autos[2].id) && ids.contains(&autos[3].id));
    verify(&f.root, &load(&f.root, "i1", &autos[0].id).unwrap()).unwrap();
    std::fs::remove_dir_all(&f.base).ok();
}

#[test]
fn partial_snapshot_only_touches_its_scopes() {
    let f = fx();
    let p = ();
    std::fs::create_dir_all(f.game.join("resourcepacks")).unwrap();
    std::fs::write(f.game.join("resourcepacks/alt.zip"), b"rp").unwrap();
    std::fs::write(
        f.inst.join("content.json"),
        br#"{"format":1,"files":{"mods/a.jar":{"v":1},"resourcepacks/alt.zip":{"v":1}},"local":{},"pinned":["mods/a.jar"],"unknown":{"h1":{}}}"#,
    )
    .unwrap();
    let sel = Sel::of(&["mods".into()]);
    let s = create_sync(&f.root, "i1", &f.game, &f.inst, "nur mods", true, &sel, &p).unwrap();
    assert_eq!(s.scopes, Some(vec!["mods".to_string()]));
    assert!(s.files.iter().all(|e| e.rel_path.starts_with("mods/")), "{:?}", s.files);
    assert_eq!(s.meta.iter().map(|m| m.rel_path.as_str()).collect::<Vec<_>>(), vec!["content.json"]);

    // Danach ändert sich alles Mögliche
    std::fs::remove_file(f.game.join("mods/b.jar")).unwrap();
    std::fs::write(f.game.join("mods/neu.jar"), b"neu").unwrap();
    std::fs::write(f.game.join("resourcepacks/neu.zip"), b"rp2").unwrap();
    std::fs::remove_file(f.game.join("resourcepacks/alt.zip")).unwrap();
    std::fs::write(f.game.join("config/x.toml"), b"x = 42").unwrap();
    std::fs::write(f.game.join("options.txt"), b"fov:90").unwrap();
    std::fs::write(
        f.inst.join("content.json"),
        br#"{"format":1,"files":{"mods/a.jar":{"v":2},"mods/neu.jar":{"v":1},"resourcepacks/neu.zip":{"v":1}},"local":{"resourcepacks/neu.zip":{"size":3}},"pinned":["resourcepacks/neu.zip"],"unknown":{"h2":{}}}"#,
    )
    .unwrap();

    restore_sync(&f.root, "i1", &f.game, &f.inst, &s, &p).unwrap();
    // Mods exakt wie im Snapshot
    assert!(f.game.join("mods/b.jar").exists());
    assert!(!f.game.join("mods/neu.jar").exists());
    // Alles andere unangetastet – Resourcepacks werden NICHT gelöscht/zurückgeholt
    assert!(f.game.join("resourcepacks/neu.zip").exists());
    assert!(!f.game.join("resourcepacks/alt.zip").exists());
    assert_eq!(std::fs::read(f.game.join("config/x.toml")).unwrap(), b"x = 42");
    assert_eq!(std::fs::read(f.game.join("options.txt")).unwrap(), b"fov:90");
    // content.json: Mods-Einträge aus dem Snapshot, Resourcepacks-Einträge vom aktuellen Stand
    let idx: serde_json::Value = serde_json::from_slice(&std::fs::read(f.inst.join("content.json")).unwrap()).unwrap();
    assert_eq!(idx["files"]["mods/a.jar"]["v"], 1);
    assert!(idx["files"].get("mods/neu.jar").is_none());
    assert_eq!(idx["files"]["resourcepacks/neu.zip"]["v"], 1);
    assert!(idx["files"].get("resourcepacks/alt.zip").is_none());
    assert_eq!(idx["local"]["resourcepacks/neu.zip"]["size"], 3);
    let pinned: Vec<&str> = idx["pinned"].as_array().unwrap().iter().filter_map(|v| v.as_str()).collect();
    assert!(pinned.contains(&"mods/a.jar") && pinned.contains(&"resourcepacks/neu.zip"));
    assert!(idx["unknown"].get("h1").is_some() && idx["unknown"].get("h2").is_some());
    std::fs::remove_dir_all(&f.base).ok();
}

#[test]
fn scope_selection() {
    let all: Vec<String> = SCOPES.iter().map(|s| s.to_string()).collect();
    assert!(Sel::of(&all).is_all());
    assert!(Sel::from_manifest(&None).is_all());
    let s = Sel::of(&["options".into(), "configs".into(), "quatsch".into()]);
    assert_eq!(s.scopes(), Some(vec!["configs".to_string(), "options".to_string()]));
    assert_eq!(s.dirs(), vec!["config", "defaultconfigs", "kubejs"]);
    assert!(s.meta().is_empty());
    assert_eq!(Sel::of(&["mods".into()]).meta(), vec!["content.json", "pack.json", "modsets.json"]);
    use crate::settings::FixBackup;
    let fb = |mode: &str, areas: &[&str]| FixBackup { mode: mode.into(), areas: areas.iter().map(|s| s.to_string()).collect() };
    assert_eq!(fix_backup_scopes(&fb("none", &["mods"])), None);
    assert_eq!(fix_backup_scopes(&fb("mods", &[])), Some(vec!["mods".to_string()]));
    assert_eq!(fix_backup_scopes(&fb("custom", &[])), None);
    assert_eq!(fix_backup_scopes(&fb("custom", &["resourcepacks", "mods"])), Some(vec!["mods".to_string(), "resourcepacks".to_string()]));
    assert_eq!(fix_backup_scopes(&FixBackup::default()), Some(vec!["mods".to_string(), "configs".to_string(), "options".to_string()]));
}

#[test]
fn old_manifest_is_full() {
    let m: Manifest = serde_json::from_str(r#"{"id":"x","name":"n","created":1,"files":[],"dirs":[],"meta":[]}"#).unwrap();
    assert!(m.sel().is_all());
    assert_eq!(m.info().scopes, None);
}

#[test]
fn wave3_migration_snapshot_preserves_mods_and_version() {
    use crate::instance::{Loader, LoaderKind};
    let f = fx();
    let version = GameVersion {
        mc_version: "1.21.4".into(),
        loader: Loader { kind: LoaderKind::Fabric, version: Some("0.16.10".into()) },
    };
    let sel = Sel::of(&["mods".into()]);
    let state = MigrationState { version: version.clone(), pending_mods: vec![] };
    let snapshot = create_with_version(&f.root, "i1", &f.game, &f.inst, "Versionswechsel", true, &sel, &(), Some(state)).unwrap();
    std::fs::rename(f.game.join("mods/a.jar"), f.game.join("mods/a.jar.disabled")).unwrap();
    std::fs::write(f.game.join("mods/new.jar"), b"new").unwrap();
    let saved = load(&f.root, "i1", &snapshot.id).unwrap();
    assert_eq!(saved.migration.as_ref().unwrap().version, version);
    restore_sync(&f.root, "i1", &f.game, &f.inst, &saved, &()).unwrap();
    assert!(f.game.join("mods/a.jar").is_file());
    assert!(!f.game.join("mods/a.jar.disabled").exists());
    assert!(!f.game.join("mods/new.jar").exists());
    assert!(f.game.join("saves/Welt/level.dat").is_file());
    std::fs::remove_dir_all(&f.base).unwrap();
}

#[test]
fn names_and_links() {
    assert!(linkable("mods/a.JAR"));
    assert!(linkable("mods/a.jar.disabled"));
    assert!(linkable("resourcepacks/p.zip"));
    assert!(!linkable("config/a.json"));
    assert!(valid_name("Neue Welt (2)"));
    for bad in ["", ".", "..", "a/b", "a\\b", "C:x"] {
        assert!(!valid_name(bad), "{bad}");
    }
}
