use super::*;

mod shared;

fn fixtures() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("src").join("content").join("testdata").join("norisk")
}

fn tmp() -> PathBuf {
    let d = std::env::temp_dir().join(format!("vl-nr-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&d).unwrap();
    d
}

const PACK: &str = "11111111-1111-4111-8111-111111111111";
const PNG: &[u8] = &[0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, b'I', b'H', b'D', b'R', 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0];

fn jar(p: &Path, json: &str) {
    std::fs::create_dir_all(p.parent().unwrap()).unwrap();
    let f = std::fs::File::create(p).unwrap();
    let mut w = zip::ZipWriter::new(f);
    w.start_file("fabric.mod.json", zip::write::SimpleFileOptions::default()).unwrap();
    use std::io::Write;
    w.write_all(json.as_bytes()).unwrap();
    w.finish().unwrap();
}

fn write_at(p: &Path, text: &str, ms: u64) {
    std::fs::create_dir_all(p.parent().unwrap()).unwrap();
    std::fs::write(p, text).unwrap();
    let f = std::fs::File::options().write(true).open(p).unwrap();
    f.set_modified(std::time::UNIX_EPOCH + std::time::Duration::from_millis(ms)).unwrap();
}

fn make_root() -> PathBuf {
    let root = tmp();
    std::fs::create_dir_all(root.join("meta")).unwrap();
    std::fs::copy(fixtures().join("norisk_modpacks.json"), root.join("norisk_modpacks.json")).unwrap();
    let c = rusqlite::Connection::open(root.join("meta/app.db")).unwrap();
    c.execute_batch(&std::fs::read_to_string(fixtures().join("app.sql")).unwrap()).unwrap();
    drop(c);
    let g = root.join("data/profiles/noriskclient/new");
    std::fs::create_dir_all(g.join("mods/nrc-26.3-fabric")).unwrap();
    std::fs::create_dir_all(g.join("saves/Welt/region")).unwrap();
    std::fs::create_dir_all(g.join("NoRiskClient")).unwrap();
    std::fs::write(g.join("options.txt"), "fov:0.5\n").unwrap();
    std::fs::write(g.join("saves/Welt/level.dat"), "x").unwrap();
    jar(&g.join("mods/ok-mod.jar"), r#"{"id":"okmod","name":"OK Mod","version":"1","depends":{"minecraft":">=26.3"}}"#);
    jar(&g.join("mods/old-mod.jar"), r#"{"id":"oldmod","name":"Old","version":"1","depends":{"minecraft":"~1.21.5"}}"#);
    jar(&g.join("mods/nrc-thing.jar"), r#"{"id":"nrc-thing","name":"NRC Thing","version":"1"}"#);
    jar(&g.join("mods/nrc-26.3-fabric/sub-mod.jar"), r#"{"id":"submod","name":"Sub","version":"1"}"#);
    jar(&g.join("mods/nrc-26.3-fabric/modmenu.jar"), r#"{"id":"modmenu","name":"Mod Menu","version":"1"}"#);
    jar(&g.join("mods/nrc-26.3-fabric-ab12/shared-mod.jar"), r#"{"id":"sharedmod","name":"Shared","version":"1"}"#);
    jar(&g.join("mods/nrc-26.3-fabric-ab12/dup.jar"), r#"{"id":"okmod","name":"OK Mod again","version":"2"}"#);
    jar(&g.join("mods/nrc-1.21.5-fabric/other.jar"), r#"{"id":"othermod","name":"Other","version":"1"}"#);
    std::fs::create_dir_all(root.join("data/profiles/groups/meine gruppe")).unwrap();
    std::fs::write(root.join("data/profiles/groups/meine gruppe/icon.png"), PNG).unwrap();
    std::fs::write(
        root.join("launcher_config.json"),
        r#"{"global_memory_settings":{"min":2048,"max":6144},"global_custom_jvm_args":"-XX:+UseG1GC","hooks":{"pre_launch":"echo nr","wrapper":null,"post_exit":null}}"#,
    )
    .unwrap();
    let pack = root.join("meta/sync_packs").join(PACK);
    write_at(&pack.join("master/resourcepacks/Shared.zip"), "zip", 1_700_000_000_000);
    write_at(&pack.join("master/options.txt"), "fov:0.9\nresourcePacks:[\"file/Shared.zip\"]\nrenderDistance:16\n", 1_800_000_000_000);
    write_at(&g.join("options.txt"), "fov:0.5\nguiScale:2\n", 1_700_000_000_000);
    write_at(&pack.join("master/servers.dat"), "master", 1_700_000_000_000);
    write_at(&root.join("data/profiles/noriskclient/hypixel/servers.dat"), "hypixel", 1_800_000_000_000);
    write_at(&g.join("servers.dat"), "own", 1_600_000_000_000);
    jar(&pack.join("mods/pack-mod.jar"), r#"{"id":"packmod","name":"Pack Mod","version":"1"}"#);
    jar(&pack.join("mods/excluded.jar"), r#"{"id":"excl","name":"Excluded","version":"1"}"#);
    write_at(&g.join("config/own.json"), "{}", 1_700_000_000_000);
    let ext = root.join("ext-xaero");
    std::fs::create_dir_all(ext.join("minimap")).unwrap();
    std::fs::write(ext.join("minimap/waypoints.txt"), "w").unwrap();
    let c = rusqlite::Connection::open(root.join("meta/app.db")).unwrap();
    c.execute("INSERT INTO sync_pack_targets (id, pack_id, path, enabled, kind, external_path) VALUES ('tx', ?1, 'xaero', 1, '{\"type\":\"dir_link\"}', ?2)", rusqlite::params![PACK, ext.to_string_lossy()]).unwrap();
    root
}

#[test]
fn times() {
    assert_eq!(to_ms(1_794_687_657_678_095_000), Some(1_794_687_657_678));
    assert_eq!(to_ms(1_794_687_657_678), Some(1_794_687_657_678));
    assert_eq!(to_ms(1_794_687_657), Some(1_794_687_657_000));
    assert_eq!(to_ms(0), None);
}

#[test]
fn game_dirs() {
    let pd = Path::new("P");
    let mut p = NrProfile { path: "noriskclient/hypixel".into(), game_version: "1.21.5".into(), group: Some("SERVER".into()), use_shared: true, ..Default::default() };
    // SERVER ist isoliert -> eigener Pfad trotz shared
    assert_eq!(game_dir(pd, &p), pd.join("noriskclient").join("hypixel"));
    p.group = Some("NORISK CLIENT".into());
    assert_eq!(game_dir(pd, &p), pd.join("noriskclient").join("new"));
    p.game_version = "1.8.9".into();
    assert_eq!(game_dir(pd, &p), pd.join("noriskclient").join("legacy"));
    p.group = Some("Meine Gruppe".into());
    assert_eq!(game_dir(pd, &p), pd.join("groups").join("meine gruppe"));
    p.use_shared = false;
    assert_eq!(game_dir(pd, &p), pd.join("noriskclient").join("hypixel"));
    p.path = "../../evil".into();
    assert_eq!(game_dir(pd, &p), pd.join("evil"));
}

#[test]
fn copies_mod_data_but_not_norisk_internals() {
    for keep in ["config", "saves", "xaero", "journeymap", "options.txt", "servers.dat", "data", "schematics"] {
        assert!(!skip_top(keep), "{keep} muss mitkommen");
    }
    for skip in ["mods", "custom_mods", "NoRiskClient", "noriskclient", "optionsNRC.json", "logs", "crash-reports", "hs_err_pid31768.log", "servers.dat_old", "usercache.json"] {
        assert!(skip_top(skip), "{skip} darf nicht mitkommen");
    }
}

#[test]
fn packs_inherit_exclude_disable() {
    let packs: Value = serde_json::from_slice(&std::fs::read(fixtures().join("norisk_modpacks.json")).unwrap()).unwrap();
    let p = NrProfile {
        game_version: "26.3".into(),
        loader: "fabric".into(),
        pack_id: Some("child".into()),
        disabled_pack_mods: vec![("child".into(), "appleskin".into(), "26.3".into(), "fabric".into())],
        ..Default::default()
    };
    let mods = pack_mods(&packs, &p);
    let ids: Vec<String> = mods
        .iter()
        .map(|m| match m {
            PackMod::Modrinth { id, version_id, .. } => format!("{id}={version_id}"),
            PackMod::Skipped { id, .. } => format!("{id}!"),
        })
        .collect();
    // nrc-client (maven) + optifine (url) übersprungen, sodium aus dem Eltern-Pack überschrieben,
    // lithium per excludeMods entfernt, appleskin vom Profil deaktiviert, iris ohne 26.3-Eintrag
    assert!(ids.contains(&"nrc-client!".to_string()), "{ids:?}");
    assert!(ids.contains(&"optifine!".to_string()));
    assert!(ids.contains(&"sodium=CHILDVER".to_string()));
    assert!(ids.contains(&"fabric-api=FAPI263".to_string()));
    assert!(!ids.iter().any(|i| i.starts_with("lithium") || i.starts_with("appleskin") || i.starts_with("iris")));
}

#[test]
fn loader_policy() {
    let packs: Value = serde_json::from_slice(&std::fs::read(fixtures().join("norisk_modpacks.json")).unwrap()).unwrap();
    assert_eq!(pack_loader_version(&packs, "child", "26.3", "fabric").as_deref(), Some("0.20.1"));
    assert_eq!(pack_loader_version(&packs, "child", "1.21.5", "fabric").as_deref(), Some("0.18.0"));
    assert_eq!(pack_loader_version(&packs, "child", "1.21", "fabric").as_deref(), Some("0.17.0"));
    assert_eq!(pack_loader_version(&packs, "child", "26.3", "forge"), None);
    let mut p = NrProfile { loader: "fabric".into(), loader_version: Some("0.19.5".into()), game_version: "26.3".into(), pack_id: Some("child".into()), ..Default::default() };
    assert_eq!(loader_of(&p, &packs).version.as_deref(), Some("0.20.1"));
    p.settings = serde_json::json!({"use_overwrite_loader_version": true, "overwrite_loader_versions": {"fabric": "0.21.0"}, "overwrite_loader_version": "0.1"});
    assert_eq!(loader_of(&p, &packs).version.as_deref(), Some("0.21.0"));
    p.pack_id = None;
    p.settings = Value::Null;
    assert_eq!(loader_of(&p, &packs).version.as_deref(), Some("0.19.5"));
}

fn ids(plan: &Plan) -> Vec<String> {
    plan.mods.iter().map(|m| format!("{}:{}={}{}", m.source.as_string(), m.project_id, m.version_id.clone().unwrap_or_default(), if m.enabled { "" } else { "!" })).collect()
}

#[test]
fn scan_fixture_root() {
    let root = make_root();
    let icons = root.join("icons");
    let found = scan(&root, &root.join("tmp"), &icons);
    assert_eq!(found.len(), 3);
    let main = found.iter().find(|f| f.info.name == "NRC 26.3").unwrap();
    assert_eq!(main.info.mc_version, "26.3");
    assert_eq!(main.info.loader, Loader { kind: LoaderKind::Fabric, version: Some("0.20.1".into()) });
    assert_eq!(main.info.last_played, Some(1_793_476_074_136));
    assert_eq!(main.info.play_time_secs, Some(291_260));
    assert!(main.info.warning.as_deref().unwrap().contains("NoRisk"));
    assert!(main.info.source_path.ends_with("#p-main"));
    assert_eq!(main.game_dir, root.join("data/profiles/noriskclient/new"));
    let plan = main.norisk.as_ref().unwrap();
    let ids = ids(plan);
    assert!(ids.contains(&"modrinth:MODMENU=MMV!".to_string()), "{ids:?}");
    assert!(ids.contains(&"modrinth:AANobbMI=CHILDVER".to_string()));
    assert!(ids.contains(&"curseforge:238222=6829086".to_string()), "CurseForge-Profil-Mod");
    assert!(ids.contains(&"modrinth:IRIS=IRIS263".to_string()), "Auflösung aus sync_pack_mod_resolutions");
    assert!(ids.contains(&"curseforge:306612=5000".to_string()), "eigene Version passt zu 26.3");
    assert!(ids.contains(&"modrinth:PINNED=PINV".to_string()), "version_overrides: pin");
    assert!(!ids.iter().any(|i| i.contains("XAERO") || i.contains("EXCL") || i.contains("OFF") || i.contains("NOPE") || i.contains("PACKMM")), "{ids:?}");
    let jars: Vec<&str> = plan.jars.iter().map(|j| j.name.as_str()).collect();
    assert_eq!(jars, vec!["ok-mod.jar", "sub-mod.jar", "pack-mod.jar"], "Standard-Profil: nur mods/nrc-26.3-fabric, nicht der Ordner eines anderen Profils");
    assert!(plan.unfit.contains(&"old-mod.jar".to_string()), "{:?}", plan.unfit);
    assert!(plan.skipped.iter().any(|s| s == "NRC Thing"));
    assert!(plan.skipped.iter().any(|s| s == "NRC Maven"));
    assert!(!plan.skipped.iter().any(|s| s == "Lokal"));
    assert_eq!(plan.sync_packs, vec!["Shared".to_string()]);
    assert_eq!(main.settings.max_memory_mb, Some(6144), "Standard-Profil: globale RAM-Einstellung");
    assert_eq!(main.settings.min_memory_mb, Some(2048));
    assert_eq!(main.settings.jvm_args.as_deref(), Some("-XX:+UseG1GC"));
    assert_eq!(main.settings.pre_launch.as_deref(), Some("echo nr"));
    assert!(main.settings.inherited.contains(&"memory".to_string()));
    assert!(main.settings.java_path.is_none(), "use_custom_java_path = false");
    assert_eq!(plan.banner, Some(Banner::Url("https://cdn.example.invalid/icon.png".into())));
    assert_eq!(main.info.mod_count as usize, plan.mods.len() + plan.jars.len());
    let rels: Vec<String> = main.overlays.iter().map(|o| o.rel.to_string_lossy().replace('\\', "/")).collect();
    assert!(rels.contains(&"resourcepacks".to_string()) && rels.contains(&"xaero".to_string()), "{rels:?}");
    assert!(rels.contains(&"options.txt".to_string()) && rels.contains(&"servers.dat".to_string()), "{rels:?}");
    assert!(!rels.iter().any(|r| r.starts_with("resourcepacks/") || r == "NoRiskClient" || r == "logs" || r == "shaderpacks"), "{rels:?}");
    let ov = found.iter().find(|f| f.info.name == "Eigene Gruppe").unwrap();
    assert_eq!(ov.info.loader.version.as_deref(), Some("0.20.1"));
    assert_eq!(ov.game_dir, root.join("data/profiles/groups/meine gruppe"));
    assert!(ov.info.warning.is_none());
    assert_eq!(ov.settings.max_memory_mb, Some(2048), "eigenes Profil: eigene RAM-Einstellung");
    assert!(ov.settings.jvm_args.is_none());
    assert!(matches!(ov.norisk.as_ref().unwrap().banner, Some(Banner::File(_))));
    assert!(ov.icon_path.is_some() && ov.info.icon.as_deref().unwrap().starts_with("data:image/png"));
    let mr = ov.pack.as_ref().unwrap();
    assert_eq!((mr.kind, mr.project_id.as_deref(), mr.version_id.as_deref()), (crate::instance::PackSourceKind::Modrinth, Some("1KVo5zza"), Some("FOV1")));
    let hyp = found.iter().find(|f| f.info.name == "Hypixel").unwrap();
    assert_eq!(hyp.pack.as_ref().unwrap().project_id.as_deref(), Some("925200"));
    let again = describe(&main.info.source_path, &root.join("tmp"), &icons);
    assert_eq!(again.unwrap().info.name, "NRC 26.3");
    std::fs::remove_dir_all(&root).ok();
}

#[test]
fn import_copies_sync_data() {
    let root = make_root();
    let g = root.join("data/profiles/noriskclient/new");
    assert!(crate::content::srctree::tests::link_dir(&g.join("config"), &g.join("config/loop")));
    let found = scan(&root, &root.join("tmp"), &root.join("icons"));
    let main = found.iter().find(|f| f.info.name == "NRC 26.3").unwrap();
    let files = run::files_to_copy(&main.game_dir, &main.overlays);
    let by = |rel: &str| files.iter().find(|(_, r)| r.to_string_lossy().replace('\\', "/") == rel).map(|(a, _)| std::fs::read_to_string(a).unwrap());
    assert_eq!(by("resourcepacks/Shared.zip").as_deref(), Some("zip"), "DirLink ohne Junction im Profil");
    assert_eq!(by("xaero/minimap/waypoints.txt").as_deref(), Some("w"), "DirLink mit external_path");
    assert_eq!(by("servers.dat").as_deref(), Some("hypixel"), "FileCopy: neuester Stand (anderer Abonnent)");
    let opts = by("options.txt").unwrap();
    assert!(opts.contains("fov:0.9") && opts.contains("guiScale:2") && opts.contains("renderDistance:16"), "{opts}");
    assert!(opts.contains("file/Shared.zip"), "resourcepacks ist verlinkt -> resourcePacks kommt mit");
    assert_eq!(by("config/own.json").as_deref(), Some("{}"));
    assert!(!files.iter().any(|(_, r)| r.to_string_lossy().matches("loop").count() > 1), "Zyklusschutz");
    assert!(!files.iter().any(|(_, r)| r.starts_with("mods") || r.starts_with("NoRiskClient")));
    let dst = root.join("vibe");
    std::fs::create_dir_all(&dst).unwrap();
    let prior = crate::content::gamedata::Prior { launcher: Some(crate::content::LauncherKind::Norisk), imported_at: 0, copied: Some(vec![]) };
    let offer = crate::content::gamedata::scan(&main.game_dir, &main.overlays, &dst, crate::content::LauncherKind::Norisk, &prior);
    let paths: Vec<&str> = offer.iter().map(|e| e.path.as_str()).collect();
    assert!(paths.contains(&"xaero") && paths.contains(&"resourcepacks") && paths.contains(&"servers.dat"), "{paths:?}");
    std::fs::remove_dir_all(&root).ok();
}

#[test]
fn missing_mods_for_reimport() {
    let plan = Plan {
        mods: vec![
            PlanMod { source: Source::Modrinth, project_id: "HAVE".into(), version_id: None, enabled: true, name: "Have".into(), cache: None },
            PlanMod { source: Source::Curseforge, project_id: "238222".into(), version_id: Some("1".into()), enabled: true, name: "JEI".into(), cache: None },
            PlanMod { source: Source::Modrinth, project_id: "GONE".into(), version_id: None, enabled: true, name: "Aus dem Cache".into(), cache: Some(PathBuf::from("mod_cache/gone-1.0.jar")) },
        ],
        jars: vec![
            PlanJar { path: PathBuf::from("a.jar"), name: "a.jar".into(), mod_id: Some("a".into()) },
            PlanJar { path: PathBuf::from("b.jar"), name: "b.jar".into(), mod_id: Some("dup".into()) },
            PlanJar { path: PathBuf::from("c.jar"), name: "C.jar".into(), mod_id: None },
        ],
        ..Default::default()
    };
    let mut idx = crate::content::index::ContentIndex::default();
    idx.files.insert(
        "mods/have.jar".into(),
        serde_json::from_value(serde_json::json!({"source": "modrinth", "project_id": "HAVE", "version_id": "v"})).unwrap(),
    );
    let names: HashSet<String> = ["c.jar.disabled".trim_end_matches(".disabled").to_string(), "gone-1.0.jar".to_string()].into();
    let ids: HashSet<String> = ["dup".to_string()].into();
    let m = mods::missing_of(&plan, &idx, &names, &ids);
    assert_eq!(m.names(), vec!["JEI".to_string(), "a.jar".to_string()]);
}

#[test]
fn legacy_json() {
    let b = std::fs::read(fixtures().join("profiles.json")).unwrap();
    let v = read_json(&b).unwrap();
    assert_eq!(v.len(), 1);
    let p = &v[0];
    assert_eq!(p.name, "Hypixel Skyblock");
    assert_eq!(p.group.as_deref(), Some("SERVER"));
    assert_eq!(p.pack_id.as_deref(), Some("hypixel-skyblock"));
    assert_eq!(p.last_played_ms, Some(1_790_000_000_000));
    assert_eq!(p.mods[0], NrMod { source_type: "modrinth".into(), project_id: Some("P7dR8mSH".into()), version_id: Some("V1".into()), file_name: Some("fabric-api.jar".into()), name: Some("Fabric API".into()), enabled: true, file_override: None });
    assert_eq!(p.disabled_pack_mods, vec![("hypixel-skyblock".into(), "sodium".into(), "1.21.5".into(), "fabric".into())]);
    assert_eq!(p.banner["source"]["url"], "https://cdn.norisk.gg/misc/hypixel-skyblock-icon.png");
}

#[test]
fn source_ids() {
    assert_eq!(split_source(r"C:\x\noriskclient\new#abc-123"), (r"C:\x\noriskclient\new", Some("abc-123")));
    assert_eq!(split_source(r"C:\x\new"), (r"C:\x\new", None));
}
