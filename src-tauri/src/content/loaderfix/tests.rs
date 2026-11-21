use super::*;
use crate::instance::Loader;

fn inst(kind: LoaderKind, version: Option<&str>, state: InstallState, version_id: Option<&str>) -> Instance {
    serde_json::from_value(serde_json::json!({
        "id": "x", "name": "x", "icon": null, "accent": null, "group": null, "mc_version": "1.21.1",
        "loader": Loader { kind, version: version.map(Into::into) }, "created_at": 0,
        "install_state": state, "version_id": version_id
    }))
    .unwrap()
}

fn req(name: &str, range: &str) -> LoaderReq {
    LoaderReq { file: format!("{}.jar", name.to_lowercase()), mod_name: name.into(), range: range.into() }
}

fn lv(v: &str, stable: bool) -> LoaderVersion {
    LoaderVersion { version: v.into(), stable }
}

fn fabric_versions() -> Vec<LoaderVersion> {
    vec![lv("0.17.0-beta.1", false), lv("0.16.14", true), lv("0.16.10", true), lv("0.16.9", true), lv("0.15.11", true)]
}

#[test]
fn loader_too_old_for_mod_is_raised_to_newest_matching() {
    let i = inst(LoaderKind::Fabric, Some("0.16.9"), InstallState::Installed, None);
    let reqs = [req("Create", ">=0.16.10"), req("Sodium", ">=0.15.0"), req("Lithium", "<0.17")];
    let list = fabric_versions();
    let n = loader_needs(&i, &LoaderFiles::Ok, &reqs, Some(&list));
    assert_eq!(n.len(), 1, "{n:#?}");
    match &n[0] {
        LoaderNeed::Set { from, to, reason, required_by, detail } => {
            assert_eq!(from.as_deref(), Some("0.16.9"));
            assert_eq!(to, "0.16.14", "neueste stabile Version, die alle Bereiche erfüllt");
            assert_eq!(*reason, "loader_too_old");
            assert_eq!(required_by, &vec!["Create".to_string()]);
            assert!(detail.as_deref().unwrap().contains(">=0.16.10"));
        }
        other => panic!("{other:?}"),
    }
    // Anforderung einer anderen Mod (Obergrenze) wird bei der Wahl beachtet
    let reqs = [req("Create", ">=0.16.10"), req("Old", "<0.16.12")];
    let n = loader_needs(&i, &LoaderFiles::Ok, &reqs, Some(&list));
    assert!(matches!(&n[0], LoaderNeed::Set { to, .. } if to == "0.16.10"), "{n:#?}");
    assert!(needs_versions(&i, &LoaderFiles::Ok, &reqs));
}

#[test]
fn loader_requirement_without_matching_version_or_offline_is_reported() {
    let i = inst(LoaderKind::Fabric, Some("0.16.9"), InstallState::Installed, None);
    let list = fabric_versions();
    // Kein Release erfüllt >=0.17 (nur eine Beta, und die ist kleiner als 0.17.0)
    let n = loader_needs(&i, &LoaderFiles::Ok, &[req("Future", ">=0.17.0")], Some(&list));
    assert!(matches!(&n[..], [LoaderNeed::Unfixable { reason: "loader_version", .. }]), "{n:#?}");
    // Sich widersprechende Mods
    let n = loader_needs(&i, &LoaderFiles::Ok, &[req("A", ">=0.16.14"), req("B", "<0.16.10")], Some(&list));
    assert!(matches!(&n[..], [LoaderNeed::Unfixable { reason: "loader_version", .. }]), "{n:#?}");
    let n = loader_needs(&i, &LoaderFiles::Ok, &[req("A", ">=0.16.10")], None);
    assert!(matches!(&n[..], [LoaderNeed::Unfixable { reason: "loader_offline", .. }]), "{n:#?}");
    // Alles erfüllt -> nichts zu tun, Liste wird nicht gebraucht
    assert!(loader_needs(&i, &LoaderFiles::Ok, &[req("A", ">=0.15")], None).is_empty());
    assert!(!needs_versions(&i, &LoaderFiles::Ok, &[req("A", ">=0.15")]));
}

#[test]
fn neoforge_and_forge_ranges_pick_matching_version() {
    let i = inst(LoaderKind::Neoforge, Some("21.1.77"), InstallState::Installed, None);
    let list = vec![lv("21.1.90", true), lv("21.1.84", true), lv("21.1.77", true), lv("21.2.0-beta", false)];
    let n = loader_needs(&i, &LoaderFiles::Ok, &[req("Mekanism", "[21.1.80,)")], Some(&list));
    assert!(matches!(&n[..], [LoaderNeed::Set { to, reason: "loader_too_old", .. }] if to == "21.1.90"), "{n:#?}");
    // Forge: nur die empfohlene Version ist „stabil“ -> sie gewinnt, wenn sie passt
    let i = inst(LoaderKind::Forge, Some("47.2.0"), InstallState::Installed, None);
    let list = vec![lv("47.3.0", true), lv("47.4.1", false), lv("47.2.0", false)];
    let n = loader_needs(&i, &LoaderFiles::Ok, &[req("Create", "[47.3,)")], Some(&list));
    assert!(matches!(&n[..], [LoaderNeed::Set { to, .. }] if to == "47.3.0"), "{n:#?}");
    // Mod verlangt eine ältere Version (Obergrenze) -> Wechsel nach unten
    let n = loader_needs(&i, &LoaderFiles::Ok, &[req("Legacy", "[47,47.1)")], Some(&[lv("47.0.50", false), lv("47.3.0", true)]));
    assert!(matches!(&n[..], [LoaderNeed::Set { to, reason: "loader_too_new", .. }] if to == "47.0.50"), "{n:#?}");
}

#[test]
fn broken_or_failed_installation_is_repaired() {
    let i = inst(LoaderKind::Fabric, Some("0.16.9"), InstallState::Installed, Some("fabric-loader-0.16.9-1.21.1"));
    let n = loader_needs(&i, &LoaderFiles::Missing { files: 3 }, &[], None);
    assert_eq!(n, vec![LoaderNeed::Repair { version: Some("0.16.9".into()), reason: "loader_files_missing", detail: Some("3".into()) }]);
    let n = loader_needs(&i, &LoaderFiles::Broken { files: 1 }, &[], None);
    assert!(matches!(&n[..], [LoaderNeed::Repair { reason: "loader_files_broken", .. }]));
    // Fehlgeschlagen und die Version gibt es nicht -> passende Version statt Neuinstallation
    let i = inst(LoaderKind::Fabric, Some("0.99.0"), InstallState::Failed, None);
    let list = fabric_versions();
    assert!(needs_versions(&i, &LoaderFiles::Failed, &[]));
    let n = loader_needs(&i, &LoaderFiles::Failed, &[], Some(&list));
    assert!(matches!(&n[..], [LoaderNeed::Set { to, reason: "loader_unknown", .. }] if to == "0.16.14"), "{n:#?}");
    // Fehlgeschlagen, Version existiert (oder offline) -> neu installieren
    let i = inst(LoaderKind::Fabric, Some("0.16.9"), InstallState::Failed, None);
    assert!(matches!(&loader_needs(&i, &LoaderFiles::Failed, &[], Some(&list))[..], [LoaderNeed::Repair { reason: "loader_install_failed", .. }]));
    assert!(matches!(&loader_needs(&i, &LoaderFiles::Failed, &[], None)[..], [LoaderNeed::Repair { reason: "loader_install_failed", .. }]));
    // Ein Versionswechsel installiert ohnehin neu -> keine zusätzliche Reparatur
    let n = loader_needs(&i, &LoaderFiles::Missing { files: 2 }, &[req("Create", ">=0.16.10")], Some(&list));
    assert_eq!(n.len(), 1);
    assert!(matches!(n[0], LoaderNeed::Set { .. }));
    // Vanilla: nie
    let v = inst(LoaderKind::Vanilla, None, InstallState::Failed, None);
    assert!(loader_needs(&v, &LoaderFiles::Failed, &[], None).is_empty());
}

fn temp_root() -> std::path::PathBuf {
    let d = std::env::temp_dir().join(format!("vl-loaderfix-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&d).unwrap();
    d
}

fn write_json(p: &std::path::Path, v: serde_json::Value) {
    std::fs::create_dir_all(p.parent().unwrap()).unwrap();
    std::fs::write(p, serde_json::to_vec(&v).unwrap()).unwrap();
}

#[test]
fn inspect_detects_missing_and_broken_loader_files() {
    let root = temp_root();
    let paths = Paths { root: root.clone() };
    let id = "fabric-loader-0.16.9-1.21.1";
    let i = inst(LoaderKind::Fabric, Some("0.16.9"), InstallState::Installed, Some(id));

    // Versions-JSON fehlt
    assert_eq!(inspect(&paths, &i), LoaderFiles::Missing { files: 1 });
    // Noch nicht installiert / fehlgeschlagen: ohne Dateizugriff
    assert_eq!(inspect(&paths, &inst(LoaderKind::Fabric, Some("0.16.9"), InstallState::NotInstalled, None)), LoaderFiles::NotInstalled);
    assert_eq!(inspect(&paths, &inst(LoaderKind::Fabric, Some("0.16.9"), InstallState::Failed, Some(id))), LoaderFiles::Failed);

    // Kette: Loader-Profil -> Vanilla
    write_json(&paths.version_json("1.21.1"), serde_json::json!({ "id": "1.21.1", "libraries": [] }));
    write_json(
        &paths.version_json(id),
        serde_json::json!({
            "id": id, "inheritsFrom": "1.21.1",
            "libraries": [
                { "name": "net.fabricmc:fabric-loader:0.16.9", "url": "https://maven.fabricmc.net/" },
                { "name": "net.fabricmc:sponge-mixin:0.15.4", "url": "https://maven.fabricmc.net/", "size": 4 }
            ]
        }),
    );
    // Beide Libraries fehlen
    assert_eq!(inspect(&paths, &i), LoaderFiles::Missing { files: 2 });
    let lib = |rel: &str| paths.libraries().join(rel);
    let loader_jar = lib("net/fabricmc/fabric-loader/0.16.9/fabric-loader-0.16.9.jar");
    let mixin_jar = lib("net/fabricmc/sponge-mixin/0.15.4/sponge-mixin-0.15.4.jar");
    std::fs::create_dir_all(loader_jar.parent().unwrap()).unwrap();
    std::fs::create_dir_all(mixin_jar.parent().unwrap()).unwrap();
    // Leere Datei (abgebrochener Download) = beschädigt
    std::fs::write(&loader_jar, b"").unwrap();
    std::fs::write(&mixin_jar, b"abcd").unwrap();
    assert_eq!(inspect(&paths, &i), LoaderFiles::Broken { files: 1 });
    std::fs::write(&loader_jar, b"PK..").unwrap();
    // Falsche Größe laut Profil = beschädigt
    std::fs::write(&mixin_jar, b"abcdef").unwrap();
    assert_eq!(inspect(&paths, &i), LoaderFiles::Broken { files: 1 });
    std::fs::write(&mixin_jar, b"abcd").unwrap();
    assert_eq!(inspect(&paths, &i), LoaderFiles::Ok);

    // Unlesbare Versions-JSON
    std::fs::write(paths.version_json(id), b"{ kaputt").unwrap();
    assert_eq!(inspect(&paths, &i), LoaderFiles::Broken { files: 1 });
    // Profil für eine andere Minecraft-Version
    write_json(&paths.version_json(id), serde_json::json!({ "id": id, "inheritsFrom": "1.20.1", "libraries": [] }));
    write_json(&paths.version_json("1.20.1"), serde_json::json!({ "id": "1.20.1", "libraries": [] }));
    assert_eq!(inspect(&paths, &i), LoaderFiles::Broken { files: 1 });

    let _ = std::fs::remove_dir_all(root);
}
