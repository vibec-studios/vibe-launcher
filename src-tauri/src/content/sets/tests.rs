use super::*;

#[test]
fn wave3_old_sets_are_opt_in() {
    let legacy = r#"{"id":"one","name":"Set","created":0,"updated":0,"entries":[]}"#;
    assert!(!serde_json::from_str::<ModSet>(legacy).unwrap().apply_on_create);
}

fn e(src: Source, id: &str, title: &str) -> SetEntry {
    SetEntry { source: src, project_id: id.into(), slug: Some(title.to_lowercase()), title: title.into(), icon_url: None, project_type: ProjectType::Mod, added: 0 }
}

#[test]
fn parse_links_and_names() {
    assert_eq!(parse_line("https://modrinth.com/mod/sodium"), Some(LineRef::Modrinth { id: "sodium".into(), hint: Some(ProjectType::Mod) }));
    assert_eq!(parse_line("- modrinth.com/shader/complementary-reimagined/versions"), Some(LineRef::Modrinth { id: "complementary-reimagined".into(), hint: Some(ProjectType::Shader) }));
    assert_eq!(parse_line("Lithium: https://modrinth.com/mod/lithium)"), Some(LineRef::Modrinth { id: "lithium".into(), hint: Some(ProjectType::Mod) }));
    assert_eq!(parse_line("https://www.modrinth.com/project/AANobbMI"), Some(LineRef::Modrinth { id: "AANobbMI".into(), hint: None }));
    assert_eq!(
        parse_line("https://www.curseforge.com/minecraft/mc-mods/jei/files/123"),
        Some(LineRef::CurseforgeSlug { slug: "jei".into(), hint: Some(ProjectType::Mod) })
    );
    assert_eq!(
        parse_line("https://legacy.curseforge.com/minecraft/texture-packs/faithful-32x"),
        Some(LineRef::CurseforgeSlug { slug: "faithful-32x".into(), hint: Some(ProjectType::Resourcepack) })
    );
    assert_eq!(parse_line("https://www.curseforge.com/projects/238222"), Some(LineRef::CurseforgeId("238222".into())));
    assert_eq!(parse_line("curseforge:238222"), Some(LineRef::CurseforgeId("238222".into())));
    assert_eq!(parse_line("mr:iris"), Some(LineRef::Modrinth { id: "iris".into(), hint: None }));
    assert_eq!(parse_line("3. Xaero's Minimap"), Some(LineRef::Name("Xaero's Minimap".into())));
    assert_eq!(parse_line("  # Kommentar"), None);
    assert_eq!(parse_line("   "), None);
    // Unbekannter Link: nicht als Name suchen
    assert_eq!(parse_line("https://example.com/foo"), Some(LineRef::Name(String::new())));
    assert_eq!(split_lines("Sodium, Lithium; Iris\nhttps://modrinth.com/mod/a,b\n\n"), vec!["Sodium", "Lithium", "Iris", "https://modrinth.com/mod/a,b"]);
    assert_eq!(slugify("Xaero's Minimap"), "xaeros-minimap");
    assert_eq!(slugify("Mod Menu"), "mod-menu");
    assert_eq!(norm("Fabric API"), "fabricapi");
}

#[test]
fn merge_dedupes() {
    let mut list = vec![e(Source::Modrinth, "a", "A")];
    let blank = SetEntry { slug: Some("bee".into()), ..e(Source::Modrinth, "b", "  ") };
    let n = merge_entries(&mut list, vec![e(Source::Modrinth, "a", "A2"), e(Source::Curseforge, "a", "A"), blank, e(Source::Modrinth, "", "x")]);
    assert_eq!(n, 2);
    assert_eq!(list.len(), 3);
    // Leerer Titel -> Slug
    assert_eq!(list[2].title, "bee");
    assert!(list[1..].iter().all(|e| e.added > 0));
}

#[test]
fn share_roundtrip() {
    let set = ModSet {
        id: "x".into(),
        name: "Performance".into(),
        description: Some("Schneller".into()),
        created: 1,
        updated: 2,
        apply_on_create: true,
        entries: vec![
            SetEntry { icon_url: Some("https://cdn.modrinth.com/data/AANobbMI/icon.png".into()), ..e(Source::Modrinth, "AANobbMI", "Sodium") },
            SetEntry { project_type: ProjectType::Shader, ..e(Source::Curseforge, "123", "BSL") },
        ],
    };
    // Datei: mit Icons, Felder wie dokumentiert
    let file = serde_json::to_value(to_shared(&set, true)).unwrap();
    assert!(file.get("apply_on_create").is_none());
    assert_eq!(file["vibe_mod_set"], 1);
    assert_eq!(file["entries"][0]["type"], "mod");
    assert_eq!(file["entries"][0]["source"], "modrinth");
    assert_eq!(file["entries"][1]["type"], "shader");
    assert!(file["entries"][0]["icon"].is_string());
    let text = serde_json::to_string_pretty(&file).unwrap();
    let back = parse_shared(&text).unwrap().unwrap();
    let (name, desc, entries) = from_shared(back);
    assert_eq!(name, "Performance");
    assert_eq!(desc.as_deref(), Some("Schneller"));
    assert_eq!(entries.len(), 2);
    assert_eq!(entries[0].icon_url.as_deref(), Some("https://cdn.modrinth.com/data/AANobbMI/icon.png"));
    assert_eq!(entries[1].project_type, ProjectType::Shader);
    // Code: ohne Icons, auch mitten im Text
    let code = encode_code(&to_shared(&set, false)).unwrap();
    assert!(code.starts_with(CODE_PREFIX));
    let back = parse_shared(&format!("Hier mein Set: {code} – viel Spaß")).unwrap().unwrap();
    assert_eq!(back.name, "Performance");
    assert_eq!(back.entries.len(), 2);
    assert_eq!(back.entries[0].icon, None);
    assert_eq!(back.entries[1].source, Source::Curseforge);
    // Kaputt / neuere Version / gar kein Set
    assert!(parse_shared(&code[..code.len() - 8]).unwrap().is_err());
    assert!(parse_shared(r#"{"vibe_mod_set": 2, "name": "x", "entries": []}"#).unwrap().is_err());
    assert!(parse_shared("https://modrinth.com/mod/sodium").is_none());
    // Linkliste
    assert_eq!(page_url(&set.entries[0]), "https://modrinth.com/mod/sodium");
    assert_eq!(page_url(&set.entries[1]), "https://www.curseforge.com/minecraft/shaders/bsl");
}

#[test]
fn store_crud() {
    let dir = std::env::temp_dir().join(format!("vl-sets-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&dir).unwrap();
    let paths = Paths { root: dir.clone() };
    let s = create(&paths, "  QoL  ", None, vec![e(Source::Modrinth, "a", "A")]).unwrap();
    assert_eq!(s.name, "QoL");
    assert!(create(&paths, " ", None, vec![]).is_err());
    let s = add_entries(&paths, &s.id, vec![e(Source::Modrinth, "b", "B"), e(Source::Modrinth, "a", "A")]).unwrap();
    assert_eq!(s.entries.len(), 2);
    let s = remove_entries(&paths, &s.id, &["modrinth:a".into()]).unwrap();
    assert_eq!(s.entries.iter().map(|e| e.project_id.as_str()).collect::<Vec<_>>(), vec!["b"]);
    let s = update(&paths, &s.id, Some("Meine QoL".into()), Some("".into())).unwrap();
    assert_eq!(s.name, "Meine QoL");
    assert_eq!(s.description, None);
    let d = duplicate(&paths, &s.id).unwrap();
    assert_eq!(all(&paths).len(), 2);
    assert_eq!(d.entries.len(), 1);
    delete(&paths, &s.id).unwrap();
    assert_eq!(all(&paths).len(), 1);
    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn index_entry_to_set_entry() {
    let mut idx = ContentIndex::default();
    idx.files.insert(
        "shaderpacks/bsl.zip".into(),
        super::super::index::IndexEntry {
            source: Source::Curseforge,
            project_id: "123".into(),
            version_id: "9".into(),
            sha1: None,
            sha512: None,
            title: None,
            icon_url: None,
            version_number: None,
            url: None,
            size: None,
            date: None,
            release_type: None,
            side: None,
        },
    );
    let (entry, kind) = entry_for_key(&idx, "shaderpacks/bsl.zip", Some("BSL Shaders")).unwrap();
    assert_eq!(kind, ContentKind::Shader);
    assert_eq!(entry.project_type, ProjectType::Shader);
    assert_eq!(entry.title, "BSL Shaders");
    assert!(entry_for_key(&idx, "mods/unknown.jar", None).is_none());
}
