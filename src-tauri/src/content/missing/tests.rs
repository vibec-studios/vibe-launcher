use super::*;

const XRAY_FILES: &str = include_str!("../testdata/cf_xray_files.json");

fn tmp(name: &str) -> PathBuf {
    let d = std::env::temp_dir().join(format!("vibe-missing-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&d);
    std::fs::create_dir_all(&d).unwrap();
    d
}

fn sha1_hex(b: &[u8]) -> String {
    use sha1::{Digest, Sha1};
    hex::encode(Sha1::digest(b))
}

fn entry(name: &str, data: &[u8], kind: ContentKind) -> MissingEntry {
    let mut e = MissingEntry::new(MissingDownload {
        file_name: name.into(),
        project_name: "Xray Ultimate".into(),
        page_url: "https://www.curseforge.com/minecraft/texture-packs/xray-ultimate-1-11-compatible/files/9139602".into(),
        kind,
        version_number: Some("5.4.4".into()),
        is_update: false,
    });
    e.sha1 = Some(sha1_hex(data));
    e.size = Some(data.len() as u64);
    e.project_id = Some("226375".into());
    e.file_id = Some("9139602".into());
    e
}

#[test]
fn browser_renames() {
    assert!(name_matches("Xray_Ultimate_26.X_v5.4.4.zip", "Xray_Ultimate_26.X_v5.4.4.zip"));
    assert!(name_matches("Xray_Ultimate_26.X_v5.4.4.zip", "xray_ultimate_26.x_v5.4.4.ZIP"));
    assert!(name_matches("Xray_Ultimate_26.X_v5.4.4.zip", "Xray_Ultimate_26.X_v5.4.4 (1).zip"));
    assert!(name_matches("Xray_Ultimate_26.X_v5.4.4.zip", "Xray_Ultimate_26.X_v5.4.4(12).zip"));
    assert!(name_matches("sodium.jar", "sodium (3).jar"));
    assert!(!name_matches("sodium.jar", "sodium-extra.jar"));
    assert!(!name_matches("sodium.jar", "sodium (x).jar"));
    assert!(!name_matches("sodium.jar", "sodium.jar.crdownload"));
    assert!(!name_matches("sodium.jar", "sodium (1).zip"));
    assert!(!name_matches("a.jar", "b (1).jar"));
    assert!(is_partial("sodium.jar.crdownload") && is_partial("x.zip.part") && !is_partial("x.zip"));
}

#[test]
fn xray_fixture_is_manual() {
    // Echte API-Antwort (gekürzt): Xray Ultimate erlaubt keine Fremd-Downloads
    let page: cf::CfPage<cf::CfFile> = serde_json::from_str(XRAY_FILES).unwrap();
    let f = &page.data[0];
    assert!(f.locked());
    assert_eq!(f.sha1().as_deref(), Some("62e4da5ca5da24f12902760373c91fcbe0ff036b"));
    assert_eq!(cf::fingerprint32(f.file_fingerprint), Some(201562264));
    let v = cf::convert_file(f);
    assert_eq!(v.files[0].url, None);
    assert_eq!(v.files[0].fingerprint, Some(201562264));
    let e = entry_for_cf_file(f, "Xray Ultimate", "https://x/files/9139602".into(), ContentKind::Resourcepack);
    assert_eq!(e.info.file_name, "Xray_Ultimate_26.X_v5.4.4.zip");
    assert_eq!(e.size, Some(1710021));
    assert_eq!(e.file_id.as_deref(), Some("9139602"));
}

#[test]
fn moves_only_matching_hash() {
    let root = tmp("hash");
    let game = root.join("game");
    let dl = root.join("Downloads");
    std::fs::create_dir_all(&dl).unwrap();
    let good = b"PK\x03\x04 echte Datei".to_vec();
    let e = entry("Xray_Ultimate_26.X_v5.4.4.zip", &good, ContentKind::Resourcepack);

    // Gleicher Name, falscher Inhalt (gleiche Größe) -> bleibt liegen
    let mut bad = good.clone();
    bad[5] ^= 0xff;
    std::fs::write(dl.join("Xray_Ultimate_26.X_v5.4.4.zip"), &bad).unwrap();
    // Fremde Datei gleicher Größe -> bleibt liegen
    std::fs::write(dl.join("urlaub.zip"), &bad).unwrap();
    // Unfertiger Download mit richtigem Inhalt -> nicht anfassen
    std::fs::write(dl.join("Xray_Ultimate_26.X_v5.4.4 (1).zip.crdownload"), &good).unwrap();
    let mut cache = HashCache::default();
    let out = scan_dirs(&game, Some(&dl), vec![e.clone()], &mut cache);
    assert_eq!((out.arrived.len(), out.present.len(), out.remaining.len()), (0, 0, 1));
    assert!(dl.join("Xray_Ultimate_26.X_v5.4.4.zip").is_file() && dl.join("urlaub.zip").is_file());

    // Browser hat umbenannt („(1)“), Inhalt stimmt -> wird verschoben, unter dem erwarteten Namen
    std::fs::write(dl.join("Xray_Ultimate_26.X_v5.4.4 (1).zip"), &good).unwrap();
    let out = scan_dirs(&game, Some(&dl), vec![e.clone()], &mut cache);
    assert_eq!(out.arrived.len(), 1);
    let dst = game.join("resourcepacks").join("Xray_Ultimate_26.X_v5.4.4.zip");
    assert_eq!(std::fs::read(&dst).unwrap(), good);
    assert!(!dl.join("Xray_Ultimate_26.X_v5.4.4 (1).zip").exists());
    // Die falschen Dateien sind unberührt
    assert_eq!(std::fs::read(dl.join("Xray_Ultimate_26.X_v5.4.4.zip")).unwrap(), bad);
    assert!(dl.join("urlaub.zip").is_file());
    assert!(dl.join("Xray_Ultimate_26.X_v5.4.4 (1).zip.crdownload").is_file());

    // Danach: liegt im Instanzordner -> „present“
    let out = scan_dirs(&game, Some(&dl), vec![e], &mut cache);
    assert_eq!(out.present.len(), 1);
    let _ = std::fs::remove_dir_all(&root);
}

#[test]
fn renamed_by_size_and_fingerprint() {
    let root = tmp("fp");
    let game = root.join("game");
    let dl = root.join("dl");
    std::fs::create_dir_all(&dl).unwrap();
    let data = b"fabric mod \n bytes \t with whitespace".to_vec();
    let mut e = entry("coolmod-1.0.jar", &data, ContentKind::Mod);
    e.sha1 = None;
    e.fingerprint = Some(super::super::murmur::cf_fingerprint(&data));
    // Völlig anderer Name, gleiche Größe + Endung -> per Fingerprint bestätigt
    std::fs::write(dl.join("download.jar"), &data).unwrap();
    let mut cache = HashCache::default();
    let out = scan_dirs(&game, Some(&dl), vec![e.clone()], &mut cache);
    assert_eq!(out.arrived.len(), 1);
    assert!(game.join("mods/coolmod-1.0.jar").is_file());

    // Ohne jeden Hash wird nie verschoben – auch bei gleichem Namen
    let mut blind = entry("other.jar", b"x", ContentKind::Mod);
    blind.sha1 = None;
    blind.fingerprint = None;
    std::fs::write(dl.join("other.jar"), b"x").unwrap();
    let out = scan_dirs(&game, Some(&dl), vec![blind], &mut cache);
    assert_eq!(out.remaining.len(), 1);
    assert!(dl.join("other.jar").is_file());
    let _ = std::fs::remove_dir_all(&root);
}

#[test]
fn same_name_update_waits_for_matching_download() {
    let root = tmp("same");
    let game = root.join("game");
    let dl = root.join("dl");
    std::fs::create_dir_all(game.join("resourcepacks")).unwrap();
    std::fs::create_dir_all(&dl).unwrap();
    // Alte Version mit gleichem Dateinamen liegt schon in der Instanz -> gilt nicht als „vorhanden“
    std::fs::write(game.join("resourcepacks/xray.zip"), b"alte version").unwrap();
    let new = b"neue version".to_vec();
    let e = entry("xray.zip", &new, ContentKind::Resourcepack);
    let mut cache = HashCache::default();
    let out = scan_dirs(&game, Some(&dl), vec![e.clone()], &mut cache);
    assert_eq!((out.present.len(), out.remaining.len()), (0, 1));
    assert_eq!(std::fs::read(game.join("resourcepacks/xray.zip")).unwrap(), b"alte version");
    // Passender Download ersetzt sie
    std::fs::write(dl.join("xray (2).zip"), &new).unwrap();
    let out = scan_dirs(&game, Some(&dl), vec![e], &mut cache);
    assert_eq!(out.arrived.len(), 1);
    assert_eq!(std::fs::read(game.join("resourcepacks/xray.zip")).unwrap(), new);
    let _ = std::fs::remove_dir_all(&root);
}

#[test]
fn manual_update_replaces_old_version() {
    let root = tmp("upd");
    let game = root.join("game");
    let dl = root.join("dl");
    std::fs::create_dir_all(game.join("mods")).unwrap();
    std::fs::create_dir_all(&dl).unwrap();
    // Alte Version deaktiviert
    std::fs::write(game.join("mods/cool-1.0.jar.disabled"), b"old").unwrap();
    let data = b"new version".to_vec();
    let mut e = entry("cool-2.0.jar", &data, ContentKind::Mod);
    e.replaces = vec!["mods/cool-1.0.jar".into()];
    e.info.is_update = true;
    e.index = Some(IndexEntry {
        source: Source::Curseforge,
        project_id: "1".into(),
        version_id: "2".into(),
        sha1: e.sha1.clone(),
        sha512: None,
        title: Some("Cool".into()),
        icon_url: None,
        version_number: Some("2.0".into()),
        url: None,
        size: Some(data.len() as u64),
        date: None,
        release_type: Some("release".into()),
        side: None,
    });
    std::fs::write(dl.join("cool-2.0.jar"), &data).unwrap();
    let mut cache = HashCache::default();
    let out = scan_dirs(&game, Some(&dl), vec![e], &mut cache);
    assert_eq!(out.arrived.len(), 1);
    assert!(game.join("mods/cool-2.0.jar.disabled").is_file(), "bleibt deaktiviert wie die alte Version");
    let mut idx = ContentIndex::default();
    idx.files.insert(
        "mods/cool-1.0.jar".into(),
        IndexEntry { version_id: "1".into(), version_number: Some("1.0".into()), ..out.arrived[0].index.clone().unwrap() },
    );
    apply_to_index(&mut idx, &game, &out.arrived);
    assert!(!game.join("mods/cool-1.0.jar.disabled").exists());
    assert!(!idx.files.contains_key("mods/cool-1.0.jar"));
    assert_eq!(idx.files.get("mods/cool-2.0.jar").map(|e| e.version_id.as_str()), Some("2"));
    let _ = std::fs::remove_dir_all(&root);
}
