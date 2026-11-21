use super::*;

fn tmp() -> PathBuf {
    let d = std::env::temp_dir().join(format!("vl-ext-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&d).unwrap();
    d
}

#[test]
fn prism_instance_folder() {
    let root = tmp();
    let inst = root.join("instances").join("Meine");
    std::fs::create_dir_all(inst.join(".minecraft/mods")).unwrap();
    std::fs::create_dir_all(root.join("icons")).unwrap();
    std::fs::write(root.join("prismlauncher.cfg"), "[General]\nInstanceDir=instances\n").unwrap();
    std::fs::write(root.join("icons/flame.png"), b"\x89PNG\r\n\x1a\n0000").unwrap();
    std::fs::write(inst.join("instance.cfg"), "[General]\nname=Meine Instanz\niconKey=flame\nlastLaunchTime=1700000000000\ntotalTimePlayed=3600\n").unwrap();
    std::fs::write(inst.join("mmc-pack.json"), r#"{"components":[{"uid":"net.minecraft","version":"1.20.1"},{"uid":"net.neoforged","version":"47.1.106"}]}"#).unwrap();
    std::fs::write(inst.join(".minecraft/mods/a.jar"), b"x").unwrap();
    std::fs::write(inst.join(".minecraft/mods/b.jar.disabled"), b"x").unwrap();
    let (l, f) = scan_dir_blocking(&root, &root.join("tmp")).unwrap();
    assert_eq!(l.id, LauncherKind::Prism);
    assert_eq!(l.instances.len(), 1);
    let i = &l.instances[0];
    assert_eq!(i.name, "Meine Instanz");
    assert_eq!(i.mc_version, "1.20.1");
    assert_eq!(i.loader.kind, LoaderKind::Neoforge);
    assert_eq!(i.mod_count, 2);
    assert_eq!(i.last_played, Some(1_700_000_000_000));
    assert_eq!(i.play_time_secs, Some(3600));
    assert!(i.icon.is_some());
    assert_eq!(f[0].game_dir, inst.join(".minecraft"));
    // einzelne Instanz direkt
    let (l2, _) = scan_dir_blocking(&inst, &root.join("tmp")).unwrap();
    assert_eq!(l2.instances[0].name, "Meine Instanz");
    std::fs::remove_dir_all(&root).ok();
}

#[test]
fn curseforge_and_atlauncher() {
    let root = tmp();
    let cf = root.join("cf").join("ATM9");
    std::fs::create_dir_all(cf.join("mods")).unwrap();
    std::fs::write(
        cf.join("minecraftinstance.json"),
        r#"{"name":"All the Mods 9","gameVersion":"1.20.1","baseModLoader":{"name":"forge-47.2.0","minecraftVersion":"1.20.1"},"lastPlayed":"2024-05-01T10:00:00Z","installedModpack":{"addonID":715572,"installedFile":{"id":5000}}}"#,
    )
    .unwrap();
    let (l, f) = scan_dir_blocking(&root.join("cf"), &root.join("tmp")).unwrap();
    assert_eq!(l.id, LauncherKind::Curseforge);
    assert_eq!(l.instances[0].loader, Loader { kind: LoaderKind::Forge, version: Some("47.2.0".into()) });
    assert_eq!(f[0].pack.as_ref().unwrap().project_id.as_deref(), Some("715572"));
    assert!(l.instances[0].last_played.is_some());

    let atl = root.join("atl").join("Vanilla");
    std::fs::create_dir_all(atl.join("mods")).unwrap();
    std::fs::write(atl.join("instance.json"), r#"{"id":"1.20.4","launcher":{"name":"Mein ATL","loaderVersion":{"type":"Fabric","version":"0.15.7"},"lastPlayed":1700000000000,"totalPlayTime":120}}"#).unwrap();
    let (l, _) = scan_dir_blocking(&atl, &root.join("tmp")).unwrap();
    assert_eq!(l.id, LauncherKind::Atlauncher);
    assert_eq!(l.instances[0].mc_version, "1.20.4");
    assert_eq!(l.instances[0].loader.kind, LoaderKind::Fabric);
    std::fs::remove_dir_all(&root).ok();
}

#[test]
fn folder_guess() {
    let root = tmp();
    let g = root.join("MeinSpiel");
    std::fs::create_dir_all(g.join("mods")).unwrap();
    let jar = std::fs::File::create(g.join("mods/x.jar")).unwrap();
    let mut w = zip::ZipWriter::new(jar);
    w.start_file("fabric.mod.json", zip::write::SimpleFileOptions::default()).unwrap();
    use std::io::Write;
    w.write_all(br#"{"id":"x","depends":{"minecraft":"~1.20.1","fabricloader":">=0.14"}}"#).unwrap();
    w.finish().unwrap();
    let (l, _) = scan_dir_blocking(&g, &root.join("tmp")).unwrap();
    assert_eq!(l.id, LauncherKind::Folder);
    let i = &l.instances[0];
    assert_eq!(i.mc_version, "1.20.1");
    assert_eq!(i.loader.kind, LoaderKind::Fabric);
    assert!(i.warning.is_some());
    assert!(scan_dir_blocking(&root.join("nichts"), &root).is_err());
    std::fs::remove_dir_all(&root).ok();
}

#[test]
fn modrinth_new_schema() {
    let root = tmp();
    std::fs::create_dir_all(root.join("profiles/Mein Profil/mods")).unwrap();
    std::fs::create_dir_all(root.join("profiles/Ohne DB/mods")).unwrap();
    std::fs::create_dir_all(root.join("meta")).unwrap();
    {
        let c = rusqlite::Connection::open(root.join("app.db")).unwrap();
        c.execute_batch(
            "PRAGMA journal_mode=WAL;
                 CREATE TABLE settings (id INTEGER, custom_dir TEXT);
                 CREATE TABLE instances (id TEXT, path TEXT, applied_content_set_id TEXT, name TEXT, icon_path TEXT, last_played INTEGER, submitted_time_played INTEGER, recent_time_played INTEGER);
                 CREATE TABLE instance_content_sets (id TEXT, instance_id TEXT, game_version TEXT, loader TEXT, loader_version TEXT);
                 CREATE TABLE instance_links (instance_id TEXT, link_kind TEXT, modrinth_project_id TEXT, modrinth_version_id TEXT);
                 INSERT INTO instances VALUES ('i1','Mein Profil','s1','Schöner Name',NULL,1700000000,100,20);
                 INSERT INTO instance_content_sets VALUES ('s1','i1','1.21.1','neoforge','21.1.227');
                 INSERT INTO instance_links VALUES ('i1','modrinth_modpack','PROJ','VER');",
        )
        .unwrap();
    }
    let (l, f) = scan_dir_blocking(&root, &root.join("tmp")).unwrap();
    assert_eq!(l.id, LauncherKind::Modrinth);
    let p = f.iter().find(|f| f.info.name == "Schöner Name").unwrap();
    assert_eq!(p.info.mc_version, "1.21.1");
    assert_eq!(p.info.loader, Loader { kind: LoaderKind::Neoforge, version: Some("21.1.227".into()) });
    assert_eq!(p.info.last_played, Some(1_700_000_000_000));
    assert_eq!(p.info.play_time_secs, Some(120));
    assert_eq!(p.pack.as_ref().unwrap().project_id.as_deref(), Some("PROJ"));
    let o = f.iter().find(|f| f.info.name == "Ohne DB").unwrap();
    assert!(o.info.warning.is_some());
    std::fs::remove_dir_all(&root).ok();
}

#[test]
fn db_copy_without_tokens() {
    let root = tmp();
    {
        let c = rusqlite::Connection::open(root.join("app.db")).unwrap();
        c.execute_batch("CREATE TABLE minecraft_users (uuid TEXT, access_token TEXT); INSERT INTO minecraft_users VALUES ('u','GEHEIM'); CREATE TABLE instances (path TEXT); INSERT INTO instances VALUES ('p');").unwrap();
    }
    let c = open_db_copy_named(&root, &root.join("tmp"), "modrinth-db").unwrap();
    assert_eq!(c.query_row("SELECT count(*) FROM minecraft_users", [], |r| r.get::<_, i64>(0)).unwrap(), 0);
    assert_eq!(c.query_row("SELECT count(*) FROM instances", [], |r| r.get::<_, i64>(0)).unwrap(), 1);
    drop(c);
    let copy = std::fs::read_dir(root.join("tmp")).unwrap().flatten().next().unwrap().path();
    for f in std::fs::read_dir(&copy).unwrap().flatten() {
        let b = std::fs::read(f.path()).unwrap();
        assert!(!b.windows(6).any(|w| w == b"GEHEIM"), "{:?}", f.path());
    }
    let orig = rusqlite::Connection::open(root.join("app.db")).unwrap();
    assert_eq!(orig.query_row("SELECT count(*) FROM minecraft_users", [], |r| r.get::<_, i64>(0)).unwrap(), 1, "Original unverändert");
    std::fs::remove_dir_all(&root).ok();
}

#[test]
fn old_unscrubbed_copy_is_replaced() {
    let root = tmp();
    {
        let c = rusqlite::Connection::open(root.join("app.db")).unwrap();
        c.execute_batch("CREATE TABLE minecraft_users (uuid TEXT, access_token TEXT); INSERT INTO minecraft_users VALUES ('u','GEHEIM');").unwrap();
    }
    let key = hex::encode(<sha1::Sha1 as sha1::Digest>::digest(norm(&s(&root)).as_bytes()));
    let old = root.join("tmp").join(format!("modrinth-db-{}", &key[..12]));
    std::fs::create_dir_all(&old).unwrap();
    std::fs::copy(root.join("app.db"), old.join("app.db")).unwrap();
    let m = std::fs::metadata(root.join("app.db")).unwrap();
    std::fs::write(old.join("stamp"), format!("{}:{:?}|", m.len(), m.modified().ok())).unwrap();
    let c = open_db_copy_named(&root, &root.join("tmp"), "modrinth-db").unwrap();
    assert_eq!(c.query_row("SELECT count(*) FROM minecraft_users", [], |r| r.get::<_, i64>(0)).unwrap(), 0);
    drop(c);
    std::fs::remove_dir_all(&root).ok();
}

#[test]
fn modrinth_old_schema() {
    let root = tmp();
    std::fs::create_dir_all(root.join("profiles/alt")).unwrap();
    {
        let c = rusqlite::Connection::open(root.join("app.db")).unwrap();
        c.execute_batch(
            "CREATE TABLE profiles (path TEXT, name TEXT, icon_path TEXT, game_version TEXT, mod_loader TEXT, mod_loader_version TEXT, last_played INTEGER, submitted_time_played INTEGER, recent_time_played INTEGER, linked_project_id TEXT, linked_version_id TEXT);
                 INSERT INTO profiles VALUES ('alt','Altes Profil',NULL,'1.20.1','fabric','0.15.7',NULL,0,0,NULL,NULL);",
        )
        .unwrap();
    }
    let (_, f) = scan_dir_blocking(&root, &root.join("tmp")).unwrap();
    assert_eq!(f[0].info.name, "Altes Profil");
    assert_eq!(f[0].info.loader.kind, LoaderKind::Fabric);
    assert_eq!(f[0].info.mc_version, "1.20.1");
    std::fs::remove_dir_all(&root).ok();
}

// ---------------------------------------------------------------- Einstellungen (Fixtures je Launcher)

fn vibe_instance(mc: &str) -> Instance {
    serde_json::from_value(serde_json::json!({
        "id": "imp", "name": "Importiert", "icon": null, "accent": null, "group": null, "mc_version": mc,
        "loader": {"kind": "forge", "version": "47.2.0"}, "created_at": 0
    }))
    .unwrap()
}

fn keys(k: &[&str]) -> std::collections::HashSet<String> {
    k.iter().map(|s| s.to_string()).collect()
}

/// Prism-Wurzel: globale Standards (inkl. API-Schlüssel, der nie übernommen wird), Gruppe, Modpack-Herkunft.
fn prism_root() -> (PathBuf, PathBuf) {
    let root = tmp();
    let inst = root.join("instances").join("ATM9");
    std::fs::create_dir_all(inst.join(".minecraft/config")).unwrap();
    std::fs::write(
        root.join("prismlauncher.cfg"),
        "[General]\nInstanceDir=instances\nMaxMemAlloc=4096\nMinMemAlloc=512\nJvmArgs=-XX:+UseG1GC\nMinecraftWinWidth=854\nMinecraftWinHeight=480\nCFKeyOverride=geheim\nWrapperCommand=gamemoderun\n",
    )
    .unwrap();
    std::fs::write(root.join("instances/instgroups.json"), r#"{"formatVersion":"1","groups":{"Modpacks":{"hidden":false,"instances":["ATM9"]}}}"#).unwrap();
    std::fs::write(
        inst.join("instance.cfg"),
        "[General]\nname=All the Mods 9\nOverrideMemory=true\nMinMemAlloc=2048\nMaxMemAlloc=8192\nOverrideWindow=true\nMinecraftWinWidth=1920\nMinecraftWinHeight=1080\n\
             OverrideCommands=true\nPreLaunchCommand=echo $INST_NAME\nOverrideEnv=true\nEnv={\"FOO\":\"bar\"}\nnotes=\"Erste Zeile\\nZweite\"\n\
             ManagedPack=true\nManagedPackType=flame\nManagedPackID=715572\nManagedPackVersionID=5000\nManagedPackName=All the Mods 9\ntotalTimePlayed=7200\n",
    )
    .unwrap();
    std::fs::write(inst.join("mmc-pack.json"), r#"{"components":[{"uid":"net.minecraft","version":"1.20.1"},{"uid":"net.minecraftforge","version":"47.2.0"}]}"#).unwrap();
    std::fs::write(inst.join(".minecraft/options.txt"), "fov:0.8\nkey_key.jump:key.keyboard.space\n").unwrap();
    std::fs::write(inst.join(".minecraft/config/jei.toml"), "a=1").unwrap();
    (root, inst)
}

#[test]
fn prism_settings_read() {
    let (root, inst) = prism_root();
    let (l, f) = scan_dir_blocking(&root, &root.join("tmp")).unwrap();
    let s = &f[0].settings;
    assert_eq!((s.min_memory_mb, s.max_memory_mb), (Some(2048), Some(8192)));
    assert_eq!((s.width, s.height), (Some(1920), Some(1080)));
    assert_eq!(s.jvm_args.as_deref(), Some("-XX:+UseG1GC"), "globale JVM-Argumente (geerbt)");
    assert!(s.inherited.contains(&"jvm_args".to_string()));
    assert!(s.pre_launch.as_deref().unwrap().contains("INST_NAME"));
    // Instanz überschreibt die Befehle -> globaler Wrapper zählt nicht
    assert!(s.wrapper.is_none());
    assert_eq!(s.env.get("FOO").map(String::as_str), Some("bar"));
    assert_eq!(s.notes.as_deref(), Some("Erste Zeile\nZweite"));
    assert_eq!(s.group.as_deref(), Some("Modpacks"));
    let pack = f[0].pack.as_ref().unwrap();
    assert_eq!((pack.kind, pack.project_id.as_deref()), (PackSourceKind::Curseforge, Some("715572")));
    assert!(l.instances[0].settings.is_some(), "Einstellungen gehen an den Import-Dialog");
    // Nur bekannte Schlüssel der globalen Konfiguration
    let g = prism_global(&inst, Some(&root));
    assert!(!g.contains_key("CFKeyOverride") && !g.contains_key("InstanceDir"));
    std::fs::remove_dir_all(&root).ok();
}

#[test]
fn modrinth_settings_read() {
    let root = tmp();
    std::fs::create_dir_all(root.join("profiles/Eigen/mods")).unwrap();
    std::fs::create_dir_all(root.join("meta")).unwrap();
    {
        let c = rusqlite::Connection::open(root.join("app.db")).unwrap();
        c.execute_batch(
            "CREATE TABLE settings (id INTEGER, custom_dir TEXT, extra_launch_args TEXT, custom_env_vars TEXT, mc_memory_max INTEGER, mc_force_fullscreen INTEGER,
                    mc_game_resolution_x INTEGER, mc_game_resolution_y INTEGER, hook_pre_launch TEXT, hook_wrapper TEXT, hook_post_exit TEXT);
                 INSERT INTO settings VALUES (0,NULL,'[]','[]',2048,0,854,480,NULL,NULL,NULL);
                 CREATE TABLE profiles (path TEXT, name TEXT, icon_path TEXT, game_version TEXT, mod_loader TEXT, mod_loader_version TEXT, last_played INTEGER,
                    submitted_time_played INTEGER, recent_time_played INTEGER, linked_project_id TEXT, linked_version_id TEXT, groups TEXT,
                    override_java_path TEXT, override_extra_launch_args TEXT, override_custom_env_vars TEXT, override_mc_memory_max INTEGER,
                    override_mc_force_fullscreen INTEGER, override_mc_game_resolution_x INTEGER, override_mc_game_resolution_y INTEGER,
                    override_hook_pre_launch TEXT, override_hook_wrapper TEXT, override_hook_post_exit TEXT);
                 INSERT INTO profiles VALUES ('Eigen','Eigenes Profil',NULL,'1.21.1','fabric','0.16.9',1700000000,600,0,NULL,NULL,'[\"Survival\"]',
                    NULL,'[\"-Xss4M\"]','[[\"MESA_GLTHREAD\",\"true\"]]',6144,1,NULL,NULL,NULL,'prime-run',NULL);",
        )
        .unwrap();
    }
    let (l, f) = scan_dir_blocking(&root, &root.join("tmp")).unwrap();
    assert_eq!(l.id, LauncherKind::Modrinth);
    let s = &f[0].settings;
    assert_eq!(s.max_memory_mb, Some(6144));
    assert_eq!(s.jvm_args.as_deref(), Some("-Xss4M"));
    assert_eq!(s.env.get("MESA_GLTHREAD").map(String::as_str), Some("true"));
    assert_eq!(s.fullscreen, Some(true));
    assert_eq!((s.width, s.height), (Some(854), Some(480)), "Auflösung aus den App-Standards");
    assert_eq!(s.wrapper.as_deref(), Some("prime-run"));
    assert_eq!(s.group.as_deref(), Some("Survival"));
    // Kopie der DB wird gelesen, das Original bleibt unverändert
    assert!(root.join("tmp").read_dir().unwrap().next().is_some());
    std::fs::remove_dir_all(&root).ok();
}

#[test]
fn curseforge_settings_read() {
    let root = tmp();
    let cf = root.join("Instances").join("Pack");
    std::fs::create_dir_all(cf.join("mods")).unwrap();
    std::fs::write(
        cf.join("minecraftinstance.json"),
        r#"{"name":"Pack","gameVersion":"1.20.1","baseModLoader":{"name":"forge-47.2.0"},"isMemoryOverride":true,"allocatedMemory":10240,"javaArgsOverride":"-XX:+UseZGC"}"#,
    )
    .unwrap();
    let (_, f) = scan_dir_blocking(&cf, &root.join("tmp")).unwrap();
    assert_eq!(f[0].settings.max_memory_mb, Some(10240));
    assert_eq!(f[0].settings.jvm_args.as_deref(), Some("-XX:+UseZGC"));
    std::fs::remove_dir_all(&root).ok();
}

#[test]
fn atlauncher_settings_read() {
    let root = tmp();
    let inst = root.join("instances").join("FO");
    std::fs::create_dir_all(inst.join("mods")).unwrap();
    std::fs::create_dir_all(root.join("configs")).unwrap();
    std::fs::write(
        root.join("configs/ATLauncher.json"),
        r#"{"initialMemory":512,"maximumMemory":4096,"windowWidth":1600,"windowHeight":900,"javaParameters":"-XX:+UseG1GC","proxyHost":"x","enableCommands":true,"wrapperCommand":"gamemoderun"}"#,
    )
    .unwrap();
    std::fs::write(
        inst.join("instance.json"),
        r#"{"id":"1.20.4","launcher":{"name":"Fabulously","maximumMemory":6144,"loaderVersion":{"type":"Fabric","version":"0.15.7"},"totalPlayTime":3600,
                "modrinthProject":{"id":"1KVo5zza"},"modrinthVersion":{"id":"VER"}}}"#,
    )
    .unwrap();
    let (_, f) = scan_dir_blocking(&inst, &root.join("tmp")).unwrap();
    let s = &f[0].settings;
    assert_eq!(s.max_memory_mb, Some(6144));
    assert_eq!((s.width, s.height), (Some(1600), Some(900)));
    assert!(s.inherited.contains(&"window".to_string()));
    assert_eq!(s.wrapper.as_deref(), Some("gamemoderun"));
    assert!(s.inherited.contains(&"hooks".to_string()));
    assert_eq!(f[0].pack.as_ref().unwrap().project_id.as_deref(), Some("1KVo5zza"));
    std::fs::remove_dir_all(&root).ok();
}

/// Nachträglich übernehmen: nur Instanz-Daten, Spielordner (Quelle wie Ziel) bleibt unangetastet.
#[test]
fn retro_apply_only_settings() {
    let (root, inst_dir) = prism_root();
    let tmpd = root.join("tmp");
    // Wie bei einer schon importierten Instanz: per Kennung erneut einlesen
    let found = describe_many(&[(LauncherKind::Prism, s(&inst_dir))], &tmpd).pop().flatten().unwrap();
    assert!(describe_many(&[(LauncherKind::Prism, s(&root.join("instances/weg")))], &tmpd)[0].is_none(), "Quelle fehlt -> kein Angebot");
    let vibe_game = root.join("vibe-game");
    std::fs::create_dir_all(&vibe_game).unwrap();
    std::fs::write(vibe_game.join("options.txt"), "fov:0.5\n").unwrap();

    let mut i = vibe_instance("1.20.1");
    i.java.max_memory_mb = Some(12288); // eigener Wert in Vibe
    let vibe = crate::settings::Settings::default();
    let prepared = found.settings.clone().effective(&vibe);
    let changes = super::extsettings::diff(&i, &prepared);
    let by = |k: &str| changes.iter().find(|c| c.key == k).cloned().unwrap();
    assert!(!by("memory").default_on, "eigener RAM-Wert in Vibe -> nicht vorausgewählt");
    assert!(by("window").default_on);
    assert!(!by("hooks").default_on);
    // Übernehmen wie vom Hinweis vorgeschlagen (Standard-Auswahl) + Spielzeit/Herkunft
    let mut chosen: Vec<&str> = changes.iter().filter(|c| c.default_on).map(|c| c.key.as_str()).collect();
    chosen.extend(["playtime", "pack"]);
    super::extsettings::apply_found(&mut i, &prepared, &found, &keys(&chosen));
    assert_eq!(i.java.max_memory_mb, Some(12288), "nicht gewählt -> unverändert");
    assert_eq!((i.window.width, i.window.height), (Some(1920), Some(1080)));
    assert_eq!(i.java.env.get("FOO").map(String::as_str), Some("bar"));
    assert!(i.hooks.pre_launch.is_none(), "Start-Befehle nur nach ausdrücklicher Wahl");
    assert_eq!(i.group.as_deref(), Some("Modpacks"));
    assert_eq!(i.play_time_secs, 7200);
    assert_eq!(i.source.as_ref().unwrap().project_id.as_deref(), Some("715572"));
    // Keine Dateien angefasst
    assert_eq!(std::fs::read_to_string(vibe_game.join("options.txt")).unwrap(), "fov:0.5\n");
    assert!(std::fs::read_to_string(inst_dir.join(".minecraft/options.txt")).unwrap().starts_with("fov:0.8"));
    // Danach: keine Unterschiede mehr in den übernommenen Bereichen
    let again = super::extsettings::diff(&i, &prepared);
    assert!(again.iter().all(|c| !chosen.contains(&c.key.as_str())), "{again:?}");
    std::fs::remove_dir_all(&root).ok();
}

/// Gemeinsame Regeln je Launcher: Mod-Daten kommen mit, Logs/Launcher-Interna/Konten nicht.
#[test]
fn plan_copy_rules_per_launcher() {
    let root = tmp();
    let game = root.join("game");
    for f in [
        "mods/a.jar",
        "config/a.toml",
        "xaero/minimap/x.txt",
        "XaeroWaypoints/w.txt",
        "journeymap/data/a.dat",
        "schematics/haus.litematic",
        "saves/Welt/level.dat",
        "options.txt",
        "servers.dat",
        "logs/latest.log",
        "crash-reports/c.txt",
        "accounts.json",
        "essential/microsoft_accounts.json",
        "essential/settings.json",
        "minecraftinstance.json",
        "instance.json",
        "disabledmods/off.jar",
        "profile.json",
        "versions/1.21/1.21.jar",
        "launcher_accounts.json",
    ] {
        let p = game.join(f);
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        std::fs::write(&p, "x").unwrap();
    }
    let rels = |k: LauncherKind| -> Vec<String> { plan_copy(&game, k).0.iter().filter(|f| f.2 != u64::MAX).map(|f| f.1.to_string_lossy().replace('\\', "/")).collect() };
    for k in [LauncherKind::Prism, LauncherKind::Modrinth, LauncherKind::Curseforge, LauncherKind::Atlauncher, LauncherKind::Folder] {
        let r = rels(k);
        for keep in ["mods/a.jar", "config/a.toml", "xaero/minimap/x.txt", "XaeroWaypoints/w.txt", "journeymap/data/a.dat", "schematics/haus.litematic", "saves/Welt/level.dat", "options.txt", "servers.dat", "essential/settings.json"] {
            assert!(r.contains(&keep.to_string()), "{k:?}: {keep} fehlt in {r:?}");
        }
        for skip in ["logs/latest.log", "crash-reports/c.txt", "accounts.json", "essential/microsoft_accounts.json", "versions/1.21/1.21.jar", "launcher_accounts.json"] {
            assert!(!r.contains(&skip.to_string()), "{k:?}: {skip} darf nicht mit");
        }
    }
    assert!(!rels(LauncherKind::Curseforge).contains(&"minecraftinstance.json".to_string()));
    let atl = rels(LauncherKind::Atlauncher);
    assert!(!atl.contains(&"instance.json".to_string()) && !atl.contains(&"disabledmods/off.jar".to_string()));
    assert!(atl.contains(&"mods/off.jar.disabled".to_string()), "deaktivierte ATLauncher-Mods: {atl:?}");
    assert!(!rels(LauncherKind::Modrinth).contains(&"profile.json".to_string()));
    assert!(rels(LauncherKind::Prism).contains(&"minecraftinstance.json".to_string()), "nur bei CurseForge Launcher-intern");
    assert_eq!(super::super::gamedata::top_names(rels(LauncherKind::Prism).iter().map(Path::new)).iter().filter(|n| *n == "xaero").count(), 1);
    std::fs::remove_dir_all(&root).ok();
}

#[test]
fn copy_follows_file_links() {
    let root = tmp();
    let (src, shared) = (root.join("game"), root.join("shared"));
    std::fs::create_dir_all(&src).unwrap();
    std::fs::create_dir_all(shared.join("cfg")).unwrap();
    std::fs::write(shared.join("options.txt"), "fov:1").unwrap();
    std::fs::write(shared.join("cfg/a.toml"), "x").unwrap();
    #[cfg(windows)]
    let linked = std::os::windows::fs::symlink_file(shared.join("options.txt"), src.join("options.txt")).is_ok()
        && std::os::windows::fs::symlink_dir(shared.join("cfg"), src.join("config")).is_ok();
    #[cfg(unix)]
    let linked = std::os::unix::fs::symlink(shared.join("options.txt"), src.join("options.txt")).is_ok() && std::os::unix::fs::symlink(shared.join("cfg"), src.join("config")).is_ok();
    if !linked {
        // Ohne Recht auf Symlinks (Windows ohne Entwicklermodus) nicht prüfbar
        std::fs::remove_dir_all(&root).ok();
        return;
    }
    let (files, total) = plan_copy(&src, LauncherKind::Folder);
    let rels: Vec<String> = files.iter().filter(|f| f.2 != u64::MAX).map(|f| f.1.to_string_lossy().replace('\\', "/")).collect();
    assert!(rels.contains(&"options.txt".to_string()), "{rels:?}");
    assert!(rels.contains(&"config/a.toml".to_string()), "{rels:?}");
    assert_eq!(total, 6);
    std::fs::remove_dir_all(&root).ok();
}
