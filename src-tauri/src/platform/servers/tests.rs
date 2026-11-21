use super::*;

#[test]
fn relay_addresses_move_to_new_domain() {
    let dir = std::env::temp_dir().join(format!("vl-servers-move-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let p = dir.join("servers.dat");
    let entry = |ip: &str| {
        Nbt::Compound(vec![
            ("ip".into(), Nbt::String(ip.into())),
            ("name".into(), Nbt::String("Welt".into())),
            ("preventsChatReports".into(), Nbt::Byte(1)),
        ])
    };
    let root = Nbt::Compound(vec![(
        "servers".into(),
        Nbt::List(10, vec![entry("mossy-otter-27.vibey.henny.dev"), entry("play.example.net"), entry("a.vibey.henny.dev:25570")]),
    )]);
    std::fs::write(&p, nbt_write(&root)).unwrap();
    assert_eq!(modernize_servers_file(&p).unwrap(), 2);
    let list = read_servers(&p).unwrap();
    let ips: Vec<&str> = list.iter().map(|s| s.ip.as_str()).collect();
    assert_eq!(ips, vec!["mossy-otter-27.axolite.cc", "play.example.net", "a.axolite.cc:25570"]);
    assert_eq!(list[0].name, "Welt");
    // Unbekannte Felder bleiben erhalten
    let back = nbt_read(&std::fs::read(&p).unwrap()).unwrap();
    let Some(Nbt::List(_, l)) = back.get("servers") else { panic!() };
    assert_eq!(l[0].get("preventsChatReports"), Some(&Nbt::Byte(1)));
    // Zweiter Lauf: nichts mehr zu tun, fehlende Datei ist kein Fehler
    assert_eq!(modernize_servers_file(&p).unwrap(), 0);
    assert_eq!(modernize_servers_file(&dir.join("fehlt.dat")).unwrap(), 0);
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn servers_roundtrip_keeps_unknown_fields() {
    let dir = std::env::temp_dir().join(format!("vl-servers-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let p = dir.join("servers.dat");
    // Datei wie vom Spiel: mit unbekanntem Feld "preventsChatReports"
    let root = Nbt::Compound(vec![(
        "servers".into(),
        Nbt::List(
            10,
            vec![Nbt::Compound(vec![
                ("ip".into(), Nbt::String("play.example.net".into())),
                ("name".into(), Nbt::String("Beispiel".into())),
                ("preventsChatReports".into(), Nbt::Byte(1)),
            ])],
        ),
    )]);
    std::fs::write(&p, nbt_write(&root)).unwrap();
    let mut list = read_servers(&p).unwrap();
    assert_eq!(list.len(), 1);
    assert_eq!(list[0].name, "Beispiel");
    list[0].name = "Umbenannt".into();
    list.push(ServerEntry {
        name: "Neu".into(),
        ip: "localhost:25566".into(),
        icon: None,
        accept_textures: Some(true),
        hidden: false,
    });
    write_servers(&p, &list).unwrap();
    let back = nbt_read(&std::fs::read(&p).unwrap()).unwrap();
    let Some(Nbt::List(_, l)) = back.get("servers") else {
        panic!()
    };
    assert_eq!(l.len(), 2);
    assert_eq!(l[0].get("name"), Some(&Nbt::String("Umbenannt".into())));
    assert_eq!(l[0].get("preventsChatReports"), Some(&Nbt::Byte(1)));
    assert_eq!(l[1].get("acceptTextures"), Some(&Nbt::Byte(1)));
    assert_eq!(read_servers(&p).unwrap()[1].ip, "localhost:25566");
    assert!(read_servers(&dir.join("fehlt.dat")).unwrap().is_empty());
    std::fs::remove_dir_all(&dir).ok();
}

#[test]
fn quick_play_versions() {
    assert!(supports_quick_play("1.20.1"));
    assert!(supports_quick_play("1.21.4"));
    assert!(supports_quick_play("26.1"));
    assert!(supports_quick_play("23w14a"));
    assert!(!supports_quick_play("23w13a"));
    assert!(!supports_quick_play("1.19.4"));
    assert!(!supports_quick_play("1.8.9"));
}

#[test]
fn addresses() {
    assert_eq!(
        parse_address("mc.hypixel.net").unwrap(),
        ("mc.hypixel.net".into(), 25565)
    );
    assert_eq!(
        parse_address("127.0.0.1:25599").unwrap(),
        ("127.0.0.1".into(), 25599)
    );
    assert_eq!(parse_address("[::1]:25570").unwrap(), ("::1".into(), 25570));
    assert!(parse_address("evil host; rm").is_err());
    assert!(parse_address("host:99999").is_err());
}

#[test]
fn motd_components() {
    let v: serde_json::Value = serde_json::from_str(r#"{"text":"","extra":[{"text":"Vibe ","color":"gold","bold":true},{"text":"Server","color":"aqua"}]}"#).unwrap();
    assert_eq!(component_to_legacy(&v), "§6§lVibe §r§bServer");
    assert_eq!(
        component_to_legacy(&serde_json::json!("§aHallo")),
        "§aHallo"
    );
}

#[test]
fn varint_encoding() {
    let mut v = vec![];
    varint(&mut v, 300);
    assert_eq!(v, vec![0xac, 0x02]);
    let mut v = vec![];
    varint(&mut v, -1);
    assert_eq!(v, vec![0xff, 0xff, 0xff, 0xff, 0x0f]);
}
