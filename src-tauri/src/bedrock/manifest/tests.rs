use super::*;
use std::io::Write;

pub fn zip_of(files: &[(&str, &[u8])]) -> Vec<u8> {
    let mut buf = std::io::Cursor::new(Vec::new());
    {
        let mut z = zip::ZipWriter::new(&mut buf);
        let o = zip::write::SimpleFileOptions::default();
        for (n, d) in files {
            z.start_file(*n, o).unwrap();
            z.write_all(d).unwrap();
        }
        z.finish().unwrap();
    }
    buf.into_inner()
}

pub fn manifest(name: &str, uuid: &str, module: &str) -> Vec<u8> {
    format!(
        r#"{{
  // Kommentar wie in vielen echten Packs
  "format_version": 2,
  "header": {{ "name": "{name}", "description": "§aBeschreibung", "uuid": "{uuid}", "version": [1, 2, 3], "min_engine_version": [1, 20, 0], }},
  "modules": [ {{ "type": "{module}", "uuid": "00000000-0000-0000-0000-00000000000{n}", "version": [1, 2, 3] }} ],
}}"#,
        n = name.len() % 10
    )
    .into_bytes()
}

#[test]
fn parse_lenient_manifest() {
    let m = parse(&manifest("Mein §lPack", "AAAA-1", "resources"), None).unwrap();
    assert_eq!(m.name, "Mein Pack");
    assert_eq!(m.description, "Beschreibung");
    assert_eq!(m.uuid, "aaaa-1");
    assert_eq!(m.version, vec![1, 2, 3]);
    assert_eq!(m.version_string(), "1.2.3");
    assert_eq!(m.kind, PackKind::Resource);
    assert_eq!(m.min_engine.as_deref(), Some("1.20.0"));
    // Format 3: Version als Text, Skript-Modul -> Verhaltenspaket; Name aus Sprachdatei
    let v3 = br#"{"format_version":3,"header":{"name":"pack.name","uuid":"b","version":"2.0.1"},"modules":[{"type":"script","uuid":"c","version":"2.0.1"}]}"#;
    let m = parse(v3, Some("## Kommentar\npack.name=Toller Name\t## x\npack.description=Text")).unwrap();
    assert_eq!(m.name, "Toller Name");
    assert_eq!(m.version, vec![2, 0, 1]);
    assert_eq!(m.kind, PackKind::Behavior);
    assert!(parse(br#"{"header":{"name":"x","uuid":"u"},"modules":[{"type":"???"}]}"#, None).is_err());
    assert!(parse(br#"{"modules":[]}"#, None).is_err());
    // Kommentarzeichen in Texten bleiben erhalten
    assert_eq!(relax_json(r#"{"a":"http://x//y", /* c */ "b":[1,2,],}"#), r#"{"a":"http://x//y",  "b":[1,2]}"#);
}

#[test]
fn mcaddon_with_multiple_modules_and_nested_packs() {
    let rp = manifest("RP", "r-1", "resources");
    let bp = manifest("BP", "b-1", "data");
    let nested_pack = zip_of(&[("manifest.json", &manifest("Innen", "n-1", "resources")), ("pack_icon.png", b"png")]);
    let addon = zip_of(&[
        ("Addon RP/manifest.json", &rp),
        ("Addon RP/textures/a.png", b"x"),
        ("Addon BP/manifest.json", &bp),
        ("Addon BP/entities/e.json", b"{}"),
        ("extra.mcpack", &nested_pack),
    ]);
    let entries = read_zip(&addon).unwrap();
    let found = analyze(&entries).unwrap();
    let packs: Vec<(String, PackKind, String)> = found
        .iter()
        .filter_map(|f| match f {
            Found::Pack { manifest, root, .. } => Some((manifest.name.clone(), manifest.kind, root.clone())),
            _ => None,
        })
        .collect();
    assert_eq!(packs.len(), 3);
    assert!(packs.contains(&("RP".into(), PackKind::Resource, "Addon RP/".into())));
    assert!(packs.contains(&("BP".into(), PackKind::Behavior, "Addon BP/".into())));
    assert!(found.iter().any(|f| matches!(f, Found::Pack { manifest, nested: Some(n), root } if manifest.name == "Innen" && n == "extra.mcpack" && root.is_empty())));
    assert_eq!(files_of(&entries, "Addon BP/").len(), 2);
}

#[test]
fn mcpack_root_and_world_detection() {
    let pack = zip_of(&[("manifest.json", &manifest("Solo", "s-1", "resources")), ("pack_icon.png", b"png")]);
    let found = analyze(&read_zip(&pack).unwrap()).unwrap();
    assert!(matches!(&found[..], [Found::Pack { root, .. }] if root.is_empty()));
    // Welt mit eigenen Packs: nur die Welt wird gemeldet
    let world = zip_of(&[
        ("level.dat", b"nbt"),
        ("levelname.txt", "§6Insel".as_bytes()),
        ("db/CURRENT", b"x"),
        ("resource_packs/rp/manifest.json", &manifest("WeltRP", "w-1", "resources")),
    ]);
    let found = analyze(&read_zip(&world).unwrap()).unwrap();
    assert_eq!(found, vec![Found::World { name: "Insel".into(), root: String::new(), nested: None }]);
    // Vorlage (.mctemplate): Manifest mit world_template + level.dat -> nur Vorlage
    let tpl = zip_of(&[("manifest.json", &manifest("Vorlage", "t-1", "world_template")), ("level.dat", b"nbt")]);
    let found = analyze(&read_zip(&tpl).unwrap()).unwrap();
    assert!(matches!(&found[..], [Found::Pack { manifest, .. }] if manifest.kind == PackKind::WorldTemplate));
}

#[test]
fn zip_slip_is_rejected() {
    for bad in ["../evil.txt", "a/../../evil.txt", "/abs.txt", "C:/win.txt", "a\\..\\..\\evil.txt"] {
        let z = zip_of(&[("manifest.json", &manifest("X", "x", "resources")), (bad, b"boom")]);
        assert!(read_zip(&z).is_err(), "{bad} muss abgelehnt werden");
    }
    assert_eq!(safe_rel("./a//b/c.txt").as_deref(), Some("a/b/c.txt"));
    assert_eq!(safe_rel("a\\b.txt").as_deref(), Some("a/b.txt"));
    assert!(safe_rel("..").is_none());
    assert!(safe_rel("").is_none());
    assert!(read_zip(b"kein zip").is_err());
}
