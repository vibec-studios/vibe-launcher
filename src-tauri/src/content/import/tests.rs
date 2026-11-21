use super::*;
use std::io::Write;

fn write_zip(path: &Path, files: &[(&str, &[u8])]) {
    let f = std::fs::File::create(path).unwrap();
    let mut w = zip::ZipWriter::new(f);
    for (n, d) in files {
        if n.ends_with('/') {
            w.add_directory(n.trim_end_matches('/'), zip::write::SimpleFileOptions::default()).unwrap();
        } else {
            w.start_file(*n, zip::write::SimpleFileOptions::default()).unwrap();
            w.write_all(d).unwrap();
        }
    }
    w.finish().unwrap();
}

fn tmp() -> PathBuf {
    let d = std::env::temp_dir().join(format!("vl-import-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&d).unwrap();
    d
}

#[test]
fn cf_loader_ids() {
    assert_eq!(loader_from_cf_id("forge-47.2.0", "1.20.1"), Loader { kind: LoaderKind::Forge, version: Some("47.2.0".into()) });
    assert_eq!(loader_from_cf_id("neoforge-1.20.1-47.1.79", "1.20.1"), Loader { kind: LoaderKind::Neoforge, version: Some("47.1.79".into()) });
    assert_eq!(loader_from_cf_id("neoforge-21.1.77", "1.21.1"), Loader { kind: LoaderKind::Neoforge, version: Some("21.1.77".into()) });
    assert_eq!(loader_from_cf_id("fabric-0.15.7", "1.20.1").kind, LoaderKind::Fabric);
    assert_eq!(loader_from_cf_id("quilt-0.25.0", "1.20.1").version.as_deref(), Some("0.25.0"));
    assert_eq!(cf_loader_id(&Loader { kind: LoaderKind::Forge, version: Some("47.2.0".into()) }).as_deref(), Some("forge-47.2.0"));
}

#[test]
fn modrinth_url() {
    assert_eq!(
        modrinth_ids_from_url("https://cdn.modrinth.com/data/AANobbMI/versions/OihdIimA/sodium-fabric-0.5.13%2Bmc1.20.1.jar"),
        Some(("AANobbMI".into(), "OihdIimA".into()))
    );
    assert_eq!(modrinth_ids_from_url("https://github.com/x/y.jar"), None);
}

#[test]
fn analyze_mrpack() {
    let d = tmp();
    let p = d.join("pack.mrpack");
    let index = br#"{"formatVersion":1,"game":"minecraft","versionId":"1.2.3","name":"Test Pack","summary":"x",
          "files":[
            {"path":"mods/a.jar","hashes":{"sha1":"aa","sha512":"bb"},"env":{"client":"required","server":"required"},"downloads":["https://cdn.modrinth.com/data/P1/versions/V1/a.jar"],"fileSize":10},
            {"path":"mods/server-only.jar","hashes":{"sha1":"cc"},"env":{"client":"unsupported","server":"required"},"downloads":["https://x/s.jar"],"fileSize":10}
          ],
          "dependencies":{"minecraft":"1.20.1","fabric-loader":"0.15.7"}}"#;
    write_zip(&p, &[("modrinth.index.json", index), ("overrides/config/a.txt", b"x"), ("client-overrides/options.txt", b"y")]);
    let plan = analyze(&p).unwrap();
    assert_eq!(plan.format, PackFormat::Mrpack);
    assert_eq!(plan.name, "Test Pack");
    assert_eq!(plan.mc_version, "1.20.1");
    assert_eq!(plan.loader, Loader { kind: LoaderKind::Fabric, version: Some("0.15.7".into()) });
    assert_eq!(plan.files.len(), 1, "Server-only-Datei wird übersprungen");
    assert_eq!(plan.files[0].origin, Some((Source::Modrinth, "P1".into(), "V1".into())));
    assert_eq!(plan.file_count(), 1);
    std::fs::remove_dir_all(&d).ok();
}

#[test]
fn mrpack_zip_slip_rejected() {
    let d = tmp();
    let p = d.join("evil.mrpack");
    let index = br#"{"formatVersion":1,"name":"Evil","files":[{"path":"../../evil.exe","hashes":{},"downloads":["https://x/e"]}],"dependencies":{"minecraft":"1.20.1"}}"#;
    write_zip(&p, &[("modrinth.index.json", index)]);
    assert!(matches!(analyze(&p), Err(AppError::Invalid(_))));
    std::fs::remove_dir_all(&d).ok();
}

#[test]
fn extract_and_zip_slip() {
    let d = tmp();
    let p = d.join("p.mrpack");
    write_zip(&p, &[("overrides/config/a.txt", b"1"), ("overrides/options.txt", b"o"), ("client-overrides/options.txt", b"c"), ("other/x", b"x")]);
    let gd = d.join("game");
    extract_overrides(&p, &["overrides/".into(), "client-overrides/".into()], &gd, &|_| Ok(())).unwrap();
    assert_eq!(std::fs::read(gd.join("config/a.txt")).unwrap(), b"1");
    assert_eq!(std::fs::read(gd.join("options.txt")).unwrap(), b"c", "client-overrides gewinnt");
    assert!(!gd.join("x").exists());
    let evil = d.join("evil.mrpack");
    write_zip(&evil, &[("overrides/../escape.txt", b"x")]);
    assert!(extract_overrides(&evil, &["overrides/".into()], &gd, &|_| Ok(())).is_err());
    assert!(!d.join("escape.txt").exists());
    std::fs::remove_dir_all(&d).ok();
}

#[test]
fn analyze_curseforge() {
    let d = tmp();
    let p = d.join("cf.zip");
    let manifest = br#"{"minecraft":{"version":"1.20.1","modLoaders":[{"id":"forge-47.2.0","primary":true}]},"manifestType":"minecraftModpack","manifestVersion":1,
          "name":"All the Mods","version":"0.2.1","author":"ATM Team","files":[{"projectID":238222,"fileID":4712866,"required":true},{"projectID":1,"fileID":2,"required":false}],"overrides":"overrides"}"#;
    write_zip(&p, &[("manifest.json", manifest), ("overrides/config/x.toml", b"a=1"), ("modlist.html", b"<ul></ul>")]);
    let plan = analyze(&p).unwrap();
    assert_eq!(plan.format, PackFormat::Curseforge);
    assert_eq!(plan.name, "All the Mods");
    assert_eq!(plan.author.as_deref(), Some("ATM Team"));
    assert_eq!(plan.loader, Loader { kind: LoaderKind::Forge, version: Some("47.2.0".into()) });
    assert_eq!(plan.cf_files.len(), 2);
    assert_eq!(plan.file_count(), 1);
    assert_eq!(plan.overrides, vec!["overrides/"]);
    std::fs::remove_dir_all(&d).ok();
}

#[test]
fn analyze_vlpack() {
    let d = tmp();
    let p = d.join("x.vlpack");
    let json = br#"{"format_version":1,"name":"Mein Pack","version":"1.0","author":"Ich","description":"d","mc_version":"1.21.1",
          "loader":{"kind":"neoforge","version":"21.1.77"},"icon":"icon.png",
          "files":[{"path":"mods/a.jar","source":"modrinth","project_id":"P","version_id":"V","url":"https://cdn.modrinth.com/data/P/versions/V/a.jar","sha1":"aa","size":3},
                   {"path":"mods/b.jar","source":"curseforge","project_id":"1","file_id":"2","url":"https://edge.forgecdn.net/files/2/b.jar","sha1":"bb","size":3},
                   {"path":"config/c.json","source":"url","url":"https://example.com/c.json","sha1":null,"size":null}]}"#;
    write_zip(&p, &[("vlpack.json", json), ("icon.png", b"\x89PNG\r\n\x1a\n...."), ("overrides/options.txt", b"x")]);
    let plan = analyze(&p).unwrap();
    assert_eq!(plan.format, PackFormat::Vlpack);
    assert_eq!(plan.loader.kind, LoaderKind::Neoforge);
    assert!(plan.icon.is_some());
    assert_eq!(plan.files[1].origin, Some((Source::Curseforge, "1".into(), "2".into())));
    assert_eq!(plan.files[2].origin, None);
    std::fs::remove_dir_all(&d).ok();
}

#[test]
fn analyze_prism_nested() {
    let d = tmp();
    let p = d.join("prism.zip");
    let cfg = b"[General]\nConfigVersion=1.2\nname=Meine Prism-Instanz\niconKey=flame\nOverrideMemory=true\nMaxMemAlloc=6144\nMinMemAlloc=1024\nnotes=Hallo\n";
    let pack = br#"{"components":[{"uid":"net.minecraft","version":"1.20.1"},{"uid":"net.fabricmc.intermediary","version":"1.20.1"},{"uid":"net.fabricmc.fabric-loader","version":"0.15.7"}],"formatVersion":1}"#;
    write_zip(
        &p,
        &[
            ("Meine/instance.cfg", cfg),
            ("Meine/mmc-pack.json", pack),
            ("Meine/flame.png", b"\x89PNG\r\n\x1a\n...."),
            ("Meine/.minecraft/mods/a.jar", b"PK"),
            ("Meine/.minecraft/options.txt", b"x"),
        ],
    );
    let plan = analyze(&p).unwrap();
    assert_eq!(plan.format, PackFormat::Prism);
    assert_eq!(plan.name, "Meine Prism-Instanz");
    assert_eq!(plan.mc_version, "1.20.1");
    assert_eq!(plan.loader, Loader { kind: LoaderKind::Fabric, version: Some("0.15.7".into()) });
    assert_eq!(plan.overrides, vec!["Meine/.minecraft/"]);
    assert_eq!(plan.embedded_mods, 1);
    assert!(plan.icon.is_some());
    let s = plan.prism.unwrap();
    assert_eq!(s.max_memory_mb, Some(6144));
    assert_eq!(s.notes.as_deref(), Some("Hallo"));
    std::fs::remove_dir_all(&d).ok();
}

#[test]
fn unknown_format() {
    let d = tmp();
    let p = d.join("x.zip");
    write_zip(&p, &[("readme.txt", b"x")]);
    assert!(matches!(analyze(&p), Err(AppError::Invalid(_))));
    std::fs::remove_dir_all(&d).ok();
}
