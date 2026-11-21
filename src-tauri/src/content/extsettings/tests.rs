use super::*;

fn ini(t: &str) -> HashMap<String, String> {
    super::super::import::parse_ini(t)
}

fn inst() -> Instance {
    serde_json::from_value(json!({
        "id": "x", "name": "X", "icon": null, "accent": null, "group": null, "mc_version": "1.20.1",
        "loader": {"kind": "vanilla", "version": null}, "created_at": 0
    }))
    .unwrap()
}

#[test]
fn prism_instance_and_global() {
    let cfg = ini(
        "[General]\nOverrideMemory=true\nMinMemAlloc=2048\nMaxMemAlloc=6144\nOverrideJavaLocation=true\nJavaPath=C:/Java/jdk-17/bin/javaw.exe\nJavaVersion=17.0.9\n\
             OverrideJavaArgs=false\nJvmArgs=-Dignored\nOverrideWindow=true\nMinecraftWinWidth=1920\nMinecraftWinHeight=1080\nLaunchMaximized=false\n\
             OverrideCommands=true\nPreLaunchCommand=\"echo $INST_NAME\"\nOverrideEnv=true\nEnv={\"MESA_GL_VERSION_OVERRIDE\":\"4.5\"}\nnotes=\"Zeile 1\\nZeile 2\"\n",
    );
    let global = ini("[General]\nMinMemAlloc=512\nMaxMemAlloc=4096\nJvmArgs=-XX:+UseG1GC\nMinecraftWinWidth=854\nMinecraftWinHeight=480\nJavaPath=C:/global/java.exe\n");
    let s = prism(&cfg, &global, Some("Survival".into()));
    assert_eq!((s.min_memory_mb, s.max_memory_mb), (Some(2048), Some(6144)));
    assert_eq!(s.java_path.as_deref(), Some("C:/Java/jdk-17/bin/javaw.exe"));
    assert_eq!(s.java_version.as_deref(), Some("17.0.9"));
    // Instanz überschreibt die Argumente nicht -> globale (geerbt)
    assert_eq!(s.jvm_args.as_deref(), Some("-XX:+UseG1GC"));
    assert!(s.inherited.contains(&"jvm_args".to_string()));
    assert_eq!((s.width, s.height), (Some(1920), Some(1080)));
    let expect = if cfg!(windows) { "echo %INST_NAME%" } else { "echo $INST_NAME" };
    assert_eq!(s.pre_launch.as_deref(), Some(expect));
    assert_eq!(s.env.get("MESA_GL_VERSION_OVERRIDE").map(String::as_str), Some("4.5"));
    assert_eq!(s.notes.as_deref(), Some("Zeile 1\nZeile 2"));
    assert_eq!(s.group.as_deref(), Some("Survival"));
    assert!(!s.inherited.contains(&"memory".to_string()));

    // Ohne Overrides: alles aus den globalen Werten, Java nie
    let s2 = prism(&ini("[General]\nname=x\n"), &global, None);
    assert_eq!(s2.max_memory_mb, Some(4096));
    assert!(s2.inherited.contains(&"memory".to_string()) && s2.inherited.contains(&"window".to_string()));
    assert!(s2.java_path.is_none());
    // Geerbte Werte, die den Vibe-Standards entsprechen, werden nicht festgeschrieben
    let vibe = Settings { max_memory_mb: 4096, min_memory_mb: 512, game_width: 854, game_height: 480, ..Default::default() };
    let e = s2.effective(&vibe);
    assert_eq!((e.max_memory_mb, e.min_memory_mb, e.width), (None, None, None));
    assert_eq!(e.jvm_args.as_deref(), Some("-XX:+UseG1GC"));
}

#[test]
fn prism_groups_and_pack() {
    let d = std::env::temp_dir().join(format!("vl-es-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&d).unwrap();
    std::fs::write(d.join("instgroups.json"), r#"{"formatVersion":"1","groups":{"Modpacks":{"hidden":false,"instances":["ATM9","Other"]}}}"#).unwrap();
    assert_eq!(prism_group(&d, "atm9").as_deref(), Some("Modpacks"));
    assert_eq!(prism_group(&d, "Nope"), None);
    let p = prism_pack(&ini("ManagedPack=true\nManagedPackType=modrinth\nManagedPackID=abc\nManagedPackVersionID=v1\nManagedPackName=Fabulously\n")).unwrap();
    assert_eq!(p.kind, crate::instance::PackSourceKind::Modrinth);
    assert_eq!(p.project_id.as_deref(), Some("abc"));
    assert!(prism_pack(&ini("ManagedPack=false\n")).is_none());
    std::fs::remove_dir_all(&d).ok();
}

#[test]
fn modrinth_db_rows() {
    let c = rusqlite::Connection::open_in_memory().unwrap();
    c.execute_batch(
        "CREATE TABLE settings (id INTEGER, theme TEXT, extra_launch_args TEXT, custom_env_vars TEXT, mc_memory_max INTEGER, mc_force_fullscreen INTEGER,
                mc_game_resolution_x INTEGER, mc_game_resolution_y INTEGER, hook_pre_launch TEXT, hook_wrapper TEXT, hook_post_exit TEXT);
             INSERT INTO settings VALUES (0,'dark','[\"-XX:+UseG1GC\"]','[]',4096,0,854,480,NULL,'gamemoderun',NULL);
             CREATE TABLE profiles (path TEXT, name TEXT, groups TEXT, override_java_path TEXT, override_extra_launch_args TEXT, override_custom_env_vars TEXT,
                override_mc_memory_max INTEGER, override_mc_force_fullscreen INTEGER, override_mc_game_resolution_x INTEGER, override_mc_game_resolution_y INTEGER,
                override_hook_pre_launch TEXT, override_hook_wrapper TEXT, override_hook_post_exit TEXT);
             INSERT INTO profiles VALUES ('Eigen','Eigen','[\"Favoriten\"]','C:\\Java\\21\\javaw.exe','[\"-Xss2M\",\"-Dname=a b\"]','[[\"FOO\",\"1\"]]',6144,1,1920,1080,'echo hi',NULL,NULL);
             INSERT INTO profiles VALUES ('Standard','Standard','[]',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL);
             CREATE TABLE java_versions (major_version INTEGER, full_version TEXT, architecture TEXT, path TEXT);
             INSERT INTO java_versions VALUES (21,'21.0.5','x86_64','C:\\Java\\21\\javaw.exe');
             CREATE TABLE minecraft_users (uuid TEXT, access_token TEXT);",
    )
    .unwrap();
    let all = modrinth_all(&c);
    let e = &all["eigen"];
    assert_eq!(e.max_memory_mb, Some(6144));
    assert_eq!(e.java_version.as_deref(), Some("21.0.5"));
    assert_eq!(e.jvm_args.as_deref(), Some("-Xss2M \"-Dname=a b\""));
    assert_eq!(e.env.get("FOO").map(String::as_str), Some("1"));
    assert_eq!((e.width, e.height, e.fullscreen), (Some(1920), Some(1080), Some(true)));
    assert_eq!(e.pre_launch.as_deref(), Some("echo hi"));
    // Wrapper fehlt in der Instanz -> globaler Wrapper (geerbt)
    assert_eq!(e.wrapper.as_deref(), Some("gamemoderun"));
    assert!(e.inherited.contains(&"hooks".to_string()));
    assert_eq!(e.group.as_deref(), Some("Favoriten"));
    let d = &all["standard"];
    assert_eq!(d.max_memory_mb, Some(4096));
    assert_eq!(d.fullscreen, Some(false));
    assert!(d.inherited.contains(&"memory".to_string()) && d.inherited.contains(&"window".to_string()));
    assert!(d.java_path.is_none());
    // nie SELECT * – Spalten, die nicht gewünscht sind, kommen nicht vor
    let rows = select_rows(&c, "minecraft_users", &["uuid"]);
    assert!(rows.iter().all(|r| !r.contains_key("access_token")));
}

#[test]
fn modrinth_old_profile_json() {
    let v = json!({"java": {"override_version": {"path": "/opt/java/bin/java", "version": "17.0.1"}, "extra_arguments": ["-Xss1M"], "custom_env_args": [["A","b"]]},
        "memory": {"maximum": 5000}, "resolution": [1280, 720], "fullscreen": false, "hooks": {"wrapper": "prime-run"}, "metadata": {"groups": ["G"]}});
    let s = modrinth_profile_json(&v);
    assert_eq!(s.max_memory_mb, Some(5000));
    assert_eq!(s.java_path.as_deref(), Some("/opt/java/bin/java"));
    assert_eq!((s.width, s.height, s.fullscreen), (Some(1280), Some(720), Some(false)));
    assert_eq!(s.wrapper.as_deref(), Some("prime-run"));
    assert_eq!(s.env.len(), 1);
    assert_eq!(s.group.as_deref(), Some("G"));
}

#[test]
fn curseforge_instance() {
    let s = curseforge(&json!({"isMemoryOverride": true, "allocatedMemory": 8192, "javaArgsOverride": "-XX:+UseZGC"}));
    assert_eq!(s.max_memory_mb, Some(8192));
    assert_eq!(s.jvm_args.as_deref(), Some("-XX:+UseZGC"));
    let s = curseforge(&json!({"isMemoryOverride": false, "allocatedMemory": 8192, "javaArgsOverride": null}));
    assert!(s.is_empty());
}

#[test]
fn atlauncher_instance_and_global() {
    let global = json!({"initialMemory": 512, "maximumMemory": 4096, "javaParameters": "-XX:+UseG1GC", "windowWidth": 1600, "windowHeight": 900,
        "enableCommands": false, "useJavaProvidedByMinecraft": true, "javaPath": "C:/global"});
    let l = json!({"maximumMemory": 7168, "initialMemory": 1024, "javaPath": "C:/Java/8/bin/javaw.exe", "useJavaProvidedByMinecraft": false,
        "enableCommands": true, "preLaunchCommand": "echo ${INST_DIR}", "wrapperCommand": null});
    let s = atlauncher(&l, Some(&global));
    assert_eq!((s.min_memory_mb, s.max_memory_mb), (Some(1024), Some(7168)));
    assert_eq!(s.java_path.as_deref(), Some("C:/Java/8/bin/javaw.exe"));
    assert_eq!(s.jvm_args.as_deref(), Some("-XX:+UseG1GC"));
    assert_eq!((s.width, s.height), (Some(1600), Some(900)));
    assert!(s.pre_launch.as_deref().unwrap().contains("INST_DIR"));
    assert!(!s.inherited.contains(&"hooks".to_string()));
    // Java von Minecraft (Standard) -> kein eigener Pfad; Befehle global aus -> keine
    let s = atlauncher(&json!({"javaPath": "C:/x", "preLaunchCommand": "evil"}), Some(&global));
    assert!(s.java_path.is_none() && s.pre_launch.is_none());
    assert_eq!(s.max_memory_mb, Some(4096));
    let p = atlauncher_pack(&json!({"pack": "Fabulously Optimized", "modrinthProject": {"id": "1KVo5zza"}, "modrinthVersion": {"id": "V"}})).unwrap();
    assert_eq!(p.project_id.as_deref(), Some("1KVo5zza"));
}

#[test]
fn norisk_settings() {
    use super::super::norisk::global::NrGlobal;
    let none = NrGlobal::default();
    let s = norisk(&json!({"memory": {"min": 1024, "max": 3584}, "use_custom_java_path": false, "java_path": "x", "custom_jvm_args": "-Dfoo",
        "resolution": {"width": 1280, "height": 720}, "fullscreen": false}), Some("NRC".into()), Some("Beschreibung".into()), false, &none);
    assert_eq!((s.min_memory_mb, s.max_memory_mb), (Some(1024), Some(3584)));
    assert!(s.java_path.is_none());
    assert_eq!(s.jvm_args.as_deref(), Some("-Dfoo"));
    assert_eq!((s.width, s.height, s.fullscreen), (Some(1280), Some(720), None));
    assert_eq!(s.notes.as_deref(), Some("Beschreibung"));
    assert!(s.inherited.is_empty());
    let g = NrGlobal { memory: json!({"min": 2048, "max": 8192}), jvm_args: Some("-XX:+UseZGC".into()), wrapper: Some("prime-run".into()), ..Default::default() };
    let std = norisk(&json!({"memory": {"min": 1024, "max": 3584}, "custom_jvm_args": "-Dfoo"}), None, None, true, &g);
    assert_eq!((std.min_memory_mb, std.max_memory_mb), (Some(2048), Some(8192)));
    assert_eq!(std.jvm_args.as_deref(), Some("-XX:+UseZGC"));
    assert_eq!(std.wrapper.as_deref(), Some("prime-run"));
    for k in ["memory", "jvm_args", "hooks"] {
        assert!(std.inherited.contains(&k.to_string()), "{k}");
    }
    let own = norisk(&json!({"memory": {"min": 1024, "max": 3584}}), None, None, false, &g);
    assert_eq!(own.max_memory_mb, Some(3584));
    assert!(own.jvm_args.is_none(), "eigene Profile nutzen keine globalen JVM-Argumente");
    assert_eq!(own.inherited, vec!["hooks".to_string()]);
    assert!(!diff(&inst(), &own).iter().find(|c| c.key == "hooks").unwrap().default_on);
    let missing = norisk(&json!({}), None, None, false, &g);
    assert_eq!(missing.max_memory_mb, Some(8192));
    assert!(missing.inherited.contains(&"memory".to_string()));
}

#[test]
fn apply_and_diff() {
    let mut i = inst();
    i.java.env.insert("FOO".into(), "old".into());
    i.notes = Some("eigene Notiz".into());
    let s = ExtSettings {
        max_memory_mb: Some(6144),
        jvm_args: Some("-Xss2M".into()),
        env: BTreeMap::from([("FOO".into(), "new".into()), ("BAR".into(), "1".into())]),
        width: Some(1920),
        height: Some(1080),
        pre_launch: Some("echo hi".into()),
        notes: Some("Prism-Notiz".into()),
        ..Default::default()
    };
    let d = diff(&i, &s);
    let by = |k: &str| d.iter().find(|c| c.key == k).cloned();
    assert!(by("memory").unwrap().default_on);
    assert!(!by("hooks").unwrap().default_on, "Start-Befehle nie vorausgewählt");
    assert!(!by("notes").unwrap().default_on, "eigene Notiz nicht ungefragt überschreiben");
    assert!(!by("env").unwrap().default_on, "FOO würde überschrieben");
    assert!(by("java").is_none());
    // Übernehmen: nur gewählte Bereiche
    apply(&mut i, &s, &HashSet::from(["memory".to_string(), "env".to_string(), "window".to_string()]));
    assert_eq!(i.java.max_memory_mb, Some(6144));
    assert_eq!(i.java.env.get("BAR").map(String::as_str), Some("1"));
    assert_eq!(i.window.width, Some(1920));
    assert!(i.hooks.pre_launch.is_none());
    assert_eq!(i.notes.as_deref(), Some("eigene Notiz"));
    // Danach keine Unterschiede mehr in diesen Bereichen
    let d = diff(&i, &s);
    assert!(d.iter().all(|c| !["memory", "env", "window"].contains(&c.key.as_str())));
}

#[test]
fn java_rules() {
    assert_eq!(java_major_for("1.12.2"), Some(8));
    assert_eq!(java_major_for("1.17.1"), Some(16));
    assert_eq!(java_major_for("1.20.4"), Some(17));
    assert_eq!(java_major_for("1.20.5"), Some(21));
    assert_eq!(java_major_for("1.21.4"), Some(21));
    assert_eq!(java_major_for("26.1"), Some(21));
    assert!(java_fits(8, "1.12.2") && !java_fits(17, "1.12.2"));
    assert!(java_fits(21, "1.20.1") && !java_fits(17, "1.21"));
}

#[test]
fn sanitize_values() {
    let s = ExtSettings { max_memory_mb: Some(100), min_memory_mb: Some(50), width: Some(1920), height: None, jvm_args: Some("  ".into()), ..Default::default() }.sanitize();
    assert!(s.is_empty());
    let s = ExtSettings { max_memory_mb: Some(4096), min_memory_mb: Some(8000), ..Default::default() }.sanitize();
    assert_eq!((s.min_memory_mb, s.max_memory_mb), (None, Some(4096)));
}
