#[test]
fn search_hit_compat() {
    let t = AddonTarget { folder: "mods", plugins: false, loaders: vec!["fabric".into()], mc: "1.21.1".into(), hangar: None };
    let v = |x: &[&str]| x.iter().map(|s| s.to_string()).collect::<Vec<_>>();
    assert!(hit_compat(&t, &v(&["fabric", "utility"]), &v(&["1.21.1"]), Some("optional")).ok);
    assert!(!hit_compat(&t, &v(&["forge"]), &v(&["1.21.1"]), None).ok);
    assert!(!hit_compat(&t, &v(&["fabric"]), &v(&["1.20.1"]), None).ok);
    let c = hit_compat(&t, &v(&["fabric"]), &v(&["1.21.1"]), Some("unsupported"));
    assert!(!c.ok && c.reason.unwrap().contains("Client"));
}
use super::*;

#[test]
fn plugin_yml() {
    let y = parse_plugin_yml(
        "name: LuckPerms\nversion: 5.4.145\nmain: me.lucko.luckperms.bukkit.loader.BukkitLoaderPlugin\n\
         description: \"A permissions plugin\"\nauthor: Luck\nauthors: [Luck, Turbo]\nfolia-supported: true\n\
         commands:\n  lp:\n    description: x\ndepend:\n  - Vault\n  - 'ProtocolLib'\n",
    );
    assert_eq!(y.name.as_deref(), Some("LuckPerms"));
    assert_eq!(y.version.as_deref(), Some("5.4.145"));
    assert_eq!(y.description.as_deref(), Some("A permissions plugin"));
    assert_eq!(y.authors, vec!["Luck", "Turbo"]);
    assert_eq!(y.depend, vec!["Vault", "ProtocolLib"]);
    assert!(y.folia_supported);
    // Blockliste + Kommentar
    let y = parse_plugin_yml("# c\nname: 'Foo' # Name\nauthors:\n  - A\n  - B\napi-version: '1.21'\n");
    assert_eq!(y.name.as_deref(), Some("Foo"));
    assert_eq!(y.authors, vec!["A", "B"]);
    assert!(!y.folia_supported);
}

fn srv(platform: Option<super::super::platform::PlatformKind>, loader: LoaderKind) -> Server {
    let json = serde_json::json!({"id":"t","name":"T","mc_version":"26.3","loader":{"kind":loader.as_str(),"version":null},
        "platform": platform.map(|k| serde_json::json!({"kind":k.as_str(),"build":null})),"port":25565,"created_at":0});
    serde_json::from_value(json).unwrap()
}

#[test]
fn targets_and_facets() {
    use super::super::platform::PlatformKind as K;
    let t = target(&srv(Some(K::Paper), LoaderKind::Vanilla)).unwrap();
    assert_eq!((t.folder, t.plugins, t.hangar), ("plugins", true, Some("PAPER")));
    assert_eq!(
        modrinth_facets(&t),
        r#"[["project_type:plugin"],["categories:paper","categories:spigot","categories:bukkit"],["versions:26.3"]]"#
    );
    let t = target(&srv(Some(K::Folia), LoaderKind::Vanilla)).unwrap();
    assert_eq!(t.loaders, vec!["folia"]);
    assert_eq!(t.hangar, None);
    assert_eq!(target(&srv(Some(K::Purpur), LoaderKind::Vanilla)).unwrap().loaders[0], "purpur");
    let t = target(&srv(None, LoaderKind::Quilt)).unwrap();
    assert_eq!((t.folder, t.plugins), ("mods", false));
    assert_eq!(
        modrinth_facets(&t),
        r#"[["project_type:mod"],["categories:quilt","categories:fabric"],["versions:26.3"],["server_side:required","server_side:optional"]]"#
    );
    assert!(target(&srv(None, LoaderKind::Vanilla)).is_none());
}

#[test]
fn modrinth_pick() {
    let t = AddonTarget { folder: "plugins", plugins: true, loaders: vec!["paper".into(), "spigot".into()], mc: "1.21.11".into(), hangar: None };
    let v = |id: &str, ty: &str, date: &str, loaders: &[&str], gv: &[&str]| mr::MrVersion {
        id: id.into(),
        version_type: ty.into(),
        date_published: date.into(),
        loaders: loaders.iter().map(|s| s.to_string()).collect(),
        game_versions: gv.iter().map(|s| s.to_string()).collect(),
        ..Default::default()
    };
    let list = vec![
        v("beta-new", "beta", "2026-11-10", &["paper"], &["1.21.11"]),
        v("fabric", "release", "2026-11-12", &["fabric"], &["1.21.11"]),
        v("rel-old", "release", "2026-10-01", &["spigot"], &["1.21.11"]),
        v("rel-new", "release", "2026-11-01", &["paper"], &["1.21.11"]),
        v("rel-wrongmc", "release", "2026-11-11", &["paper"], &["26.3"]),
    ];
    assert_eq!(pick_modrinth(&list, &t).unwrap().id, "rel-new");
    assert_eq!(pick_modrinth(&list[..1], &t).unwrap().id, "beta-new");
    assert!(pick_modrinth(&list[1..2], &t).is_none());
}

#[test]
fn hangar_project_parse() {
    let b = br#"{"name":"ViaVersion","namespace":{"owner":"ViaVersion","slug":"ViaVersion"},"stats":{"downloads":532062,"stars":478},
        "category":"misc","description":"Allow newer versions","lastUpdated":"2026-11-07T09:38:30Z","createdAt":"2022-12-31T20:04:25Z",
        "settings":{"links":[{"id":0,"type":"top","links":[{"id":1,"name":"Issues","url":"https://github.com/ViaVersion/ViaVersion/issues"},
        {"id":2,"name":"Source","url":"https://github.com/ViaVersion/ViaVersion/"},{"id":3,"name":"Support","url":"https://discord.gg/ViaVersion"},
        {"id":4,"name":"Wiki","url":"https://docs.viaversion.com/"},{"id":5,"name":"Donate","url":"https://github.com/sponsors/x"},
        {"id":6,"name":"Evil","url":"javascript:alert(1)"}]}],
        "tags":["SUPPORTS_FOLIA"],"license":{"name":"GPL","url":"https://x","type":"GPL"},"keywords":["via","protocol"]},
        "supportedPlatforms":{"PAPER":["1.20.6","1.21.11","1.21.2"],"VELOCITY":["3.4"]},
        "avatarUrl":"https://hangarcdn.papermc.io/avatars/project/31.webp?v=1"}"#;
    let p = super::parse_hangar_project(b, Some("# Hallo".into())).unwrap();
    assert_eq!(p.id, "ViaVersion/ViaVersion");
    assert_eq!(p.follows, 478);
    assert_eq!(p.body, "# Hallo");
    assert_eq!(p.links.issues.as_deref(), Some("https://github.com/ViaVersion/ViaVersion/issues"));
    assert_eq!(p.links.discord.as_deref(), Some("https://discord.gg/ViaVersion"));
    assert_eq!(p.links.wiki.as_deref(), Some("https://docs.viaversion.com/"));
    assert_eq!(p.links.website, None, "Spenden-/javascript-Links nicht als Webseite");
    assert_eq!(p.game_versions, vec!["1.21.11", "1.21.2", "1.20.6"]);
    assert!(p.loaders.contains(&"folia".to_string()) && p.loaders.contains(&"paper".to_string()));
    assert_eq!(p.license.as_deref(), Some("GPL"));
    assert_eq!(p.page_url, "https://hangar.papermc.io/ViaVersion/ViaVersion");
    // Ohne Hauptseite: Kurzbeschreibung
    let p = super::parse_hangar_project(b, None).unwrap();
    assert_eq!(p.body, "Allow newer versions");
}

#[test]
fn hangar_parse() {
    let search = r#"{"pagination":{"count":174,"limit":2,"offset":0},"result":[
        {"name":"ViaBackwards","namespace":{"owner":"ViaVersion","slug":"ViaBackwards"},"description":"Allow older clients",
         "avatarUrl":"https://hangarcdn.papermc.io/avatars/project/12.webp?v=1","lastUpdated":"2026-11-07T09:38:30Z","stats":{"downloads":772838}},
        {"name":"X","namespace":{"owner":"o","slug":"X"},"avatarUrl":"https://hangarcdn.papermc.io/avatars/default/default.webp?v=0","stats":{}}]}"#;
    let r = parse_hangar_search(search.as_bytes(), 0).unwrap();
    assert_eq!(r.total, 174);
    assert_eq!(r.hits[0].id, "ViaVersion/ViaBackwards");
    assert_eq!(r.hits[0].page_url, "https://hangar.papermc.io/ViaVersion/ViaBackwards");
    assert_eq!(r.hits[0].downloads, 772838);
    assert_eq!(r.hits[1].icon_url, None);

    let versions = r#"{"pagination":{"count":3},"result":[
        {"name":"5.12.3-SNAPSHOT+1119","createdAt":"2026-11-07T09:38:30Z","channel":{"name":"Snapshot"},
         "downloads":{"PAPER":{"fileInfo":{"name":"ViaVersion-5.12.3-SNAPSHOT.jar","sizeBytes":10,"sha256Hash":"AB"},"downloadUrl":"https://x/snap.jar","externalUrl":null}}},
        {"name":"5.12.2","createdAt":"2026-10-01T00:00:00Z","channel":{"name":"Release"},
         "downloads":{"PAPER":{"fileInfo":{"name":"ViaVersion-5.12.2.jar","sizeBytes":9,"sha256Hash":"CD"},"downloadUrl":"https://x/rel.jar","externalUrl":null}}},
        {"name":"5.12.1","createdAt":"2026-09-01T00:00:00Z","channel":{"name":"Release"},
         "downloads":{"VELOCITY":{"downloadUrl":"https://x/v.jar"}}}]}"#;
    let (name, url, file, size, sha) = pick_hangar(versions.as_bytes(), "PAPER").unwrap().unwrap();
    assert_eq!((name.as_str(), url.as_str(), file.as_str(), size, sha.as_deref()), ("5.12.2", "https://x/rel.jar", "ViaVersion-5.12.2.jar", Some(9), Some("CD")));
    let ext = r#"{"pagination":{"count":1},"result":[{"name":"1.0","createdAt":"x","channel":{"name":"Release"},
        "downloads":{"PAPER":{"fileInfo":null,"downloadUrl":null,"externalUrl":"https://github.com/x/releases"}}}]}"#;
    assert!(matches!(pick_hangar(ext.as_bytes(), "PAPER"), Err(AppError::Invalid(m)) if m.contains("extern")));
    assert!(pick_hangar(r#"{"pagination":{"count":0},"result":[]}"#.as_bytes(), "PAPER").unwrap().is_none());
}

#[test]
fn file_names() {
    assert_eq!(safe_file_name("LuckPerms-Bukkit-5.4.jar"), "LuckPerms-Bukkit-5.4.jar");
    assert_eq!(safe_file_name("../evil"), "_evil.jar");
    assert_eq!(base_name("a.jar.disabled"), "a.jar");
}
