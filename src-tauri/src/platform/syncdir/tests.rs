use super::*;

struct Fx {
    base_dir: PathBuf,
    a: PathBuf,
    b: PathBuf,
    shared: PathBuf,
    trash: PathBuf,
}

fn fx() -> Fx {
    let base_dir = std::env::temp_dir().join(format!("vl-syncdir-{}", uuid::Uuid::new_v4()));
    let f = Fx { a: base_dir.join("a/resourcepacks"), b: base_dir.join("b/resourcepacks"), shared: base_dir.join("sync/resourcepacks"), trash: base_dir.join("sync/trash"), base_dir };
    std::fs::create_dir_all(&f.a).unwrap();
    std::fs::create_dir_all(&f.b).unwrap();
    f
}

fn names(d: &Path) -> Vec<String> {
    entries(d).into_keys().collect()
}

fn touch_later(p: &Path, data: &[u8]) {
    // Änderungszeit sicher anders als vorher
    std::thread::sleep(std::time::Duration::from_millis(15));
    std::fs::write(p, data).unwrap();
}

#[test]
fn spreads_between_instances_and_handles_deletes() {
    let f = fx();
    let (mut ba, mut bb) = (Base::new(), Base::new());
    std::fs::write(f.a.join("Faithful.zip"), b"faithful").unwrap();
    std::fs::create_dir_all(f.a.join("Ordnerpack/assets")).unwrap();
    std::fs::write(f.a.join("Ordnerpack/pack.mcmeta"), b"{}").unwrap();
    std::fs::write(f.a.join("Ordnerpack/assets/x.png"), b"png").unwrap();
    std::fs::write(f.b.join("Nur-B.zip"), b"b").unwrap();
    std::fs::write(f.a.join(".tmp-datei"), b"ignoriert").unwrap();

    let r = sync(&f.a, &f.shared, &f.trash, &mut ba, "A").unwrap();
    assert_eq!(r.to_shared, vec!["Faithful.zip", "Ordnerpack"]);
    let r = sync(&f.b, &f.shared, &f.trash, &mut bb, "B").unwrap();
    assert_eq!(r.to_shared, vec!["Nur-B.zip"]);
    assert_eq!(r.to_instance, vec!["Faithful.zip", "Ordnerpack"]);
    assert!(f.b.join("Ordnerpack/assets/x.png").is_file());
    let r = sync(&f.a, &f.shared, &f.trash, &mut ba, "A").unwrap();
    assert_eq!(r.to_instance, vec!["Nur-B.zip"]);
    assert_eq!(names(&f.a), names(&f.b));
    assert!(!f.shared.join(".tmp-datei").exists());

    // Zweiter Abgleich ohne Änderungen: nichts passiert
    assert_eq!(sync(&f.a, &f.shared, &f.trash, &mut ba, "A").unwrap().changes(), 0);

    // In B gelöscht -> gemeinsamer Ordner (Papierkorb) -> aus A entfernt
    std::fs::remove_file(f.b.join("Nur-B.zip")).unwrap();
    let r = sync(&f.b, &f.shared, &f.trash, &mut bb, "B").unwrap();
    assert_eq!(r.removed_shared, vec!["Nur-B.zip"]);
    assert_eq!(names(&f.trash).len(), 1, "landet im Papierkorb");
    let r = sync(&f.a, &f.shared, &f.trash, &mut ba, "A").unwrap();
    assert_eq!(r.removed_instance, vec!["Nur-B.zip"]);

    // Änderung in einem Ordnerpack wird übertragen
    touch_later(&f.a.join("Ordnerpack/assets/x.png"), b"png2");
    let r = sync(&f.a, &f.shared, &f.trash, &mut ba, "A").unwrap();
    assert_eq!(r.to_shared, vec!["Ordnerpack"]);
    sync(&f.b, &f.shared, &f.trash, &mut bb, "B").unwrap();
    assert_eq!(std::fs::read(f.b.join("Ordnerpack/assets/x.png")).unwrap(), b"png2");
    std::fs::remove_dir_all(&f.base_dir).ok();
}

#[test]
fn conflict_keeps_both_versions() {
    let f = fx();
    let (mut ba, mut bb) = (Base::new(), Base::new());
    std::fs::write(f.a.join("Pack.zip"), b"version-a").unwrap();
    std::fs::write(f.b.join("Pack.zip"), b"version-b").unwrap();
    std::fs::write(f.b.join("Gleich.zip"), b"gleich").unwrap();
    std::fs::write(f.a.join("Gleich.zip"), b"gleich").unwrap();
    sync(&f.a, &f.shared, &f.trash, &mut ba, "Instanz A").unwrap();
    let r = sync(&f.b, &f.shared, &f.trash, &mut bb, "Instanz B").unwrap();
    // Gleicher Inhalt ist kein Konflikt
    assert_eq!(r.conflicts, vec![Conflict { name: "Pack.zip".into(), renamed: "Pack (Instanz B).zip".into() }]);
    assert_eq!(std::fs::read(f.shared.join("Pack.zip")).unwrap(), b"version-a");
    assert_eq!(std::fs::read(f.shared.join("Pack (Instanz B).zip")).unwrap(), b"version-b");
    assert_eq!(std::fs::read(f.b.join("Pack.zip")).unwrap(), b"version-a");
    assert_eq!(std::fs::read(f.b.join("Pack (Instanz B).zip")).unwrap(), b"version-b");
    // A bekommt die umbenannte Fassung beim nächsten Abgleich
    sync(&f.a, &f.shared, &f.trash, &mut ba, "Instanz A").unwrap();
    assert_eq!(std::fs::read(f.a.join("Pack (Instanz B).zip")).unwrap(), b"version-b");
    // Danach stabil
    assert_eq!(sync(&f.b, &f.shared, &f.trash, &mut bb, "Instanz B").unwrap().changes(), 0);
    assert_eq!(sync(&f.a, &f.shared, &f.trash, &mut ba, "Instanz A").unwrap().changes(), 0);

    // Gleichzeitig geändert (A schreibt gemeinsam, B hat lokal etwas anderes) -> Konflikt statt Überschreiben
    touch_later(&f.a.join("Gleich.zip"), b"neu-a");
    sync(&f.a, &f.shared, &f.trash, &mut ba, "Instanz A").unwrap();
    touch_later(&f.b.join("Gleich.zip"), b"neu-b");
    let r = sync(&f.b, &f.shared, &f.trash, &mut bb, "Instanz B").unwrap();
    assert_eq!(r.conflicts.len(), 1);
    assert_eq!(std::fs::read(f.b.join("Gleich.zip")).unwrap(), b"neu-a");
    assert_eq!(std::fs::read(f.b.join("Gleich (Instanz B).zip")).unwrap(), b"neu-b");

    // Gelöscht vs. geändert: Änderung gewinnt
    touch_later(&f.a.join("Pack.zip"), b"version-a2");
    sync(&f.a, &f.shared, &f.trash, &mut ba, "Instanz A").unwrap();
    std::fs::remove_file(f.b.join("Pack.zip")).unwrap();
    let r = sync(&f.b, &f.shared, &f.trash, &mut bb, "Instanz B").unwrap();
    assert_eq!(r.to_instance, vec!["Pack.zip"]);
    assert_eq!(std::fs::read(f.b.join("Pack.zip")).unwrap(), b"version-a2");
    std::fs::remove_dir_all(&f.base_dir).ok();
}

#[test]
fn disabling_loses_nothing() {
    // „Abschalten“ = Base verwerfen. Alle Dateien sind in der Instanz geblieben; beim erneuten Einschalten wird
    // vereinigt, nie gelöscht.
    let f = fx();
    let mut ba = Base::new();
    std::fs::create_dir_all(&f.shared).unwrap();
    std::fs::write(f.shared.join("Gemeinsam.zip"), b"g").unwrap();
    std::fs::write(f.a.join("Eigen.zip"), b"e").unwrap();
    sync(&f.a, &f.shared, &f.trash, &mut ba, "A").unwrap();
    assert_eq!(names(&f.a), vec!["Eigen.zip", "Gemeinsam.zip"]);
    // Abschalten, in der Instanz und gemeinsam weiterarbeiten
    drop(ba);
    std::fs::remove_file(f.a.join("Gemeinsam.zip")).unwrap();
    std::fs::write(f.a.join("Später.zip"), b"s").unwrap();
    assert_eq!(names(&f.a), vec!["Eigen.zip", "Später.zip"]);
    // Wieder einschalten: frischer Abgleich vereinigt, löscht nichts
    let mut ba = Base::new();
    let r = sync(&f.a, &f.shared, &f.trash, &mut ba, "A").unwrap();
    assert!(r.removed_shared.is_empty() && r.removed_instance.is_empty());
    assert_eq!(names(&f.a), vec!["Eigen.zip", "Gemeinsam.zip", "Später.zip"]);
    assert_eq!(names(&f.shared), vec!["Eigen.zip", "Gemeinsam.zip", "Später.zip"]);
    std::fs::remove_dir_all(&f.base_dir).ok();
}

#[test]
fn collect_screenshots_once() {
    let f = fx();
    let shots = f.base_dir.join("a/screenshots");
    let shared = f.base_dir.join("sync/screenshots");
    std::fs::create_dir_all(&shots).unwrap();
    std::fs::write(shots.join("2026-11-19_10.00.00.png"), b"1").unwrap();
    std::fs::write(shots.join("2026-11-19_10.00.01.png"), b"2").unwrap();
    std::fs::create_dir_all(&shared).unwrap();
    std::fs::write(shared.join("2026-11-19_10.00.01.png"), b"anders").unwrap();
    let mut seen = BTreeSet::new();
    assert_eq!(collect(&shots, &shared, &mut seen, "A").unwrap(), 2);
    assert_eq!(std::fs::read(shared.join("2026-11-19_10.00.01 (A).png")).unwrap(), b"2");
    // Im gemeinsamen Ordner gelöscht -> kommt nicht wieder
    std::fs::remove_file(shared.join("2026-11-19_10.00.00.png")).unwrap();
    assert_eq!(collect(&shots, &shared, &mut seen, "A").unwrap(), 0);
    assert!(!shared.join("2026-11-19_10.00.00.png").exists());
    // Instanz behält alles
    assert_eq!(names(&shots).len(), 2);
    std::fs::remove_dir_all(&f.base_dir).ok();
}

#[test]
fn linked_instance_folder_is_left_alone() {
    let f = fx();
    let target = f.base_dir.join("fremd");
    std::fs::create_dir_all(&target).unwrap();
    let link = f.base_dir.join("c/resourcepacks");
    std::fs::create_dir_all(link.parent().unwrap()).unwrap();
    #[cfg(windows)]
    let ok = std::process::Command::new("cmd").args(["/C", "mklink", "/J"]).arg(&link).arg(&target).output().is_ok_and(|o| o.status.success());
    #[cfg(unix)]
    let ok = std::os::unix::fs::symlink(&target, &link).is_ok();
    if !ok {
        return;
    }
    std::fs::create_dir_all(&f.shared).unwrap();
    std::fs::write(f.shared.join("X.zip"), b"x").unwrap();
    let r = sync(&link, &f.shared, &f.trash, &mut Base::new(), "C").unwrap();
    assert_eq!(r.errors.len(), 1);
    assert!(names(&target).is_empty());
    std::fs::remove_dir_all(&f.base_dir).ok();
}

#[test]
fn trash_prune_and_names() {
    let f = fx();
    std::fs::create_dir_all(&f.trash).unwrap();
    std::fs::write(f.trash.join("20000101-000000_alt.zip"), b"").unwrap();
    std::fs::write(f.trash.join(format!("{}_neu.zip", chrono::Local::now().format("%Y%m%d-%H%M%S"))), b"").unwrap();
    prune_trash(&f.trash);
    assert_eq!(names(&f.trash).len(), 1);
    assert_eq!(unique_name("Pack.zip", "Meine: Instanz", &[&f.a], false), "Pack (Meine_ Instanz).zip");
    assert_eq!(unique_name("Ordner.v2", "A", &[&f.a], true), "Ordner.v2 (A)");
    std::fs::write(f.a.join("Pack (A).zip"), b"").unwrap();
    assert_eq!(unique_name("Pack.zip", "A", &[&f.a], false), "Pack (A 2).zip");
    std::fs::remove_dir_all(&f.base_dir).ok();
}
