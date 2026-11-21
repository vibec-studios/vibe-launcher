use super::*;

fn paths() -> (Paths, PathBuf) {
    let base = std::env::temp_dir().join(format!("vl-wb-{}", uuid::Uuid::new_v4()));
    (Paths { root: base.clone() }, base)
}

fn mk_world(paths: &Paths, iid: &str, folder: &str) -> PathBuf {
    let d = saves(paths, iid).join(folder);
    std::fs::create_dir_all(d.join("region")).unwrap();
    std::fs::create_dir_all(d.join("data")).unwrap();
    std::fs::write(d.join("level.dat"), b"nicht-nbt").unwrap();
    std::fs::write(d.join("region/r.0.0.mca"), vec![7u8; 300_000]).unwrap();
    std::fs::write(d.join("session.lock"), b"x").unwrap();
    d
}

fn tree(dir: &Path) -> Vec<(String, Vec<u8>)> {
    let (files, dirs) = list_tree(dir).unwrap();
    let mut v: Vec<_> = files.into_iter().map(|(r, p, _)| (r, std::fs::read(p).unwrap())).collect();
    v.extend(dirs.into_iter().map(|d| (format!("{d}/"), vec![])));
    v
}

#[test]
fn backup_restore_roundtrip() {
    let (p, base) = paths();
    let d = mk_world(&p, "i1", "Welt");
    let before = tree(&d);
    let b = backup_sync(&p, "i1", "Welt", false, &()).unwrap();
    assert_eq!(b.id.split_once('/').unwrap().0, "Welt");
    assert!(changed_worlds(&p, "i1").is_empty());
    std::fs::write(d.join("region/r.0.0.mca"), b"kaputt").unwrap();
    std::fs::write(d.join("neu.txt"), b"neu").unwrap();
    assert_eq!(changed_worlds(&p, "i1"), vec!["Welt".to_string()]);
    restore_sync(&p, "i1", &b.id, 5, &()).unwrap();
    assert_eq!(tree(&d), before);
    // Vorher wurde automatisch gesichert
    let all = list_sync(&p, "i1");
    assert_eq!(all.len(), 2);
    assert!(all.iter().any(|x| x.auto));
    // Keine Reste
    let leftovers: Vec<_> = std::fs::read_dir(saves(&p, "i1")).unwrap().flatten().filter(|e| e.file_name().to_string_lossy().starts_with(".vl-")).collect();
    assert!(leftovers.is_empty());
    delete_sync(&p, "i1", &b.id).unwrap();
    assert_eq!(list_sync(&p, "i1").len(), 1);
    std::fs::remove_dir_all(&base).ok();
}

#[test]
fn copy_and_import_unique_names() {
    let (p, base) = paths();
    mk_world(&p, "i1", "Welt");
    assert_eq!(copy_sync(&p, "i1", "Welt", "i2", &()).unwrap(), "Welt");
    assert_eq!(copy_sync(&p, "i1", "Welt", "i2", &()).unwrap(), "Welt (2)");
    assert_eq!(copy_sync(&p, "i1", "Welt", "i1", &()).unwrap(), "Welt (2)");
    assert!(!saves(&p, "i2").join("Welt (2)/session.lock").exists());
    // Import: Backup-ZIP hat "Welt/" als Wurzel
    let b = backup_sync(&p, "i1", "Welt", false, &()).unwrap();
    let zip = worlds_root(&p, "i1").join(&b.id).with_extension("zip");
    assert_eq!(import_sync(&p, "i2", &zip, &()).unwrap(), "Welt (3)");
    assert!(saves(&p, "i2").join("Welt (3)/region/r.0.0.mca").is_file());
    // ZIP mit level.dat direkt in der Wurzel -> Name aus dem Dateinamen
    let flat = base.join("Meine Karte.zip");
    {
        let mut w = zip::ZipWriter::new(std::fs::File::create(&flat).unwrap());
        w.start_file("level.dat", zip::write::SimpleFileOptions::default()).unwrap();
        w.write_all(b"lvl").unwrap();
        w.finish().unwrap();
    }
    assert_eq!(import_sync(&p, "i2", &flat, &()).unwrap(), "Meine Karte");
    assert!(unique_folder(&saves(&p, "i2"), "a/b").starts_with("a_b"));
    assert_eq!(unique_folder(&saves(&p, "i2"), ".."), "unnamed");
    std::fs::remove_dir_all(&base).ok();
}

#[test]
fn zip_slip_is_rejected() {
    let (p, base) = paths();
    std::fs::create_dir_all(&base).unwrap();
    let evil = base.join("evil.zip");
    {
        let mut w = zip::ZipWriter::new(std::fs::File::create(&evil).unwrap());
        let o = zip::write::SimpleFileOptions::default();
        w.start_file("Welt/level.dat", o).unwrap();
        w.write_all(b"lvl").unwrap();
        w.start_file("Welt/../../../boese.txt", o).unwrap();
        w.write_all(b"x").unwrap();
        w.finish().unwrap();
    }
    let err = import_sync(&p, "i1", &evil, &()).unwrap_err();
    assert!(matches!(err, AppError::Invalid(_)), "{err}");
    assert!(!base.join("boese.txt").exists());
    assert!(!p.game_dir("i1").join("boese.txt").exists());
    // Keine halben Ordner
    let n = std::fs::read_dir(saves(&p, "i1")).unwrap().count();
    assert_eq!(n, 0);
    // Keine Welt in der ZIP
    let none = base.join("none.zip");
    {
        let mut w = zip::ZipWriter::new(std::fs::File::create(&none).unwrap());
        w.start_file("a/b/level.dat", zip::write::SimpleFileOptions::default()).unwrap();
        w.finish().unwrap();
    }
    assert!(import_sync(&p, "i1", &none, &()).is_err());
    std::fs::remove_dir_all(&base).ok();
}

#[test]
fn prune_auto_backups() {
    let (p, base) = paths();
    mk_world(&p, "i1", "W");
    let manual = backup_sync(&p, "i1", "W", false, &()).unwrap();
    for _ in 0..4 {
        backup_sync(&p, "i1", "W", true, &()).unwrap();
    }
    assert_eq!(prune(&p, "i1", "W", 2, &[]), 2);
    let left = list_sync(&p, "i1");
    assert_eq!(left.len(), 3);
    assert!(left.iter().any(|b| b.id == manual.id));
    assert!(parse_id("../x").is_err());
    assert!(parse_id("W/..").is_err());
    std::fs::remove_dir_all(&base).ok();
}
