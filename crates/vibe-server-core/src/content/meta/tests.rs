use super::*;
use std::io::Write;

fn make_zip(files: &[(&str, &[u8])]) -> Vec<u8> {
    let mut buf = std::io::Cursor::new(Vec::new());
    {
        let mut w = zip::ZipWriter::new(&mut buf);
        for (n, d) in files {
            w.start_file(*n, zip::write::SimpleFileOptions::default()).unwrap();
            w.write_all(d).unwrap();
        }
        w.finish().unwrap();
    }
    buf.into_inner()
}

const PNG: &[u8] = b"\x89PNG\r\n\x1a\n0000";

#[test]
fn fabric_jar() {
    let dir = std::env::temp_dir().join(format!("vl-meta-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&dir).unwrap();
    let jar = dir.join("a.jar");
    std::fs::write(
        &jar,
        make_zip(&[
            ("fabric.mod.json", b"{\"id\":\"sodium\",\"name\":\"Sodium\",\"version\":\"0.5.3\",\"description\":\"Fast\nrender\",\"authors\":[\"jellysquid3\",{\"name\":\"IMS\"}],\"icon\":{\"16\":\"s.png\",\"128\":\"icon.png\"}}"),
            ("icon.png", PNG),
        ]),
    )
    .unwrap();
    let m = read_entry(&jar, ContentKind::Mod, &dir.join("icons"));
    assert_eq!(m.mod_id.as_deref(), Some("sodium"));
    assert_eq!(m.name.as_deref(), Some("Sodium"));
    assert_eq!(m.description.as_deref(), Some("Fast render"));
    assert_eq!(m.authors, vec!["jellysquid3", "IMS"]);
    assert!(m.sha1.is_some() && m.murmur2.is_some());
    let icon = m.icon.unwrap();
    assert!(icon_data_url(&dir.join("icons"), &icon).unwrap().starts_with("data:image/png;base64,"));
    std::fs::remove_dir_all(&dir).ok();
}

#[test]
fn forge_toml() {
    let toml = r#"
modLoader="javafml"
loaderVersion="[47,)"
license="MIT"
[[mods]]
modId="jei"
version="${file.jarVersion}"
displayName="Just Enough Items"
authors="mezz, someone"
logoFile="logo.png"
description='''
Item list
'''
"#;
    let p = parse_mods_toml(toml, Some("15.2.0.27"));
    assert_eq!(p.mod_id.as_deref(), Some("jei"));
    assert_eq!(p.version.as_deref(), Some("15.2.0.27"));
    assert_eq!(p.name.as_deref(), Some("Just Enough Items"));
    assert_eq!(p.authors, vec!["mezz", "someone"]);
    assert_eq!(p.icon_path.as_deref(), Some("logo.png"));
    assert_eq!(p.description.as_deref(), Some("Item list"));
    // kaputtes TOML -> Regex-Fallback
    let p = parse_mods_toml("displayName=\"X\"\nversion=\"1\"\n[[broken", None);
    assert_eq!(p.name.as_deref(), Some("X"));
}

#[test]
fn mcmod_and_quilt() {
    let v = lenient_json(br#"{"modListVersion":2,"modList":[{"modid":"old","name":"Old Mod","version":"1.0","authorList":["a"]}]}"#).unwrap();
    let p = parse_mcmod_info(&v);
    assert_eq!(p.name.as_deref(), Some("Old Mod"));
    let v = lenient_json(br#"{"quilt_loader":{"id":"q","version":"2","metadata":{"name":"Q Mod","contributors":{"Bob":"Owner"},"icon":"q.png"}}}"#).unwrap();
    let p = parse_quilt(&v);
    assert_eq!(p.name.as_deref(), Some("Q Mod"));
    assert_eq!(p.authors, vec!["Bob"]);
    assert_eq!(p.icon_path.as_deref(), Some("q.png"));
}

#[test]
fn pack_meta() {
    let json = "{\"pack\":{\"pack_format\":15,\"description\":[{\"text\":\"\u{a7}aGreen \"},{\"text\":\"Pack\",\"extra\":[\"!\"]}]}}";
    let p = parse_pack_mcmeta(json.as_bytes());
    assert_eq!(p.description.as_deref(), Some("Green Pack!"));
    assert_eq!(strip_formatting("§6Gold§r text"), "Gold text");
}
