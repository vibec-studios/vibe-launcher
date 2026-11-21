use super::*;

const ME: &str = "a1b2c3d4-0000-4000-8000-0000000000f7";
const SIBLING: &str = "b9000000-0000-4000-8000-0000000000c3";
const SYNC: &str = "33333333-3333-4333-8333-333333333333";

fn fit(id: &str, name: &str) -> String {
    format!(r#"{{"id":"{id}","name":"{name}","version":"1","depends":{{"minecraft":">=1.21.11"}}}}"#)
}

fn shared_root() -> (PathBuf, PathBuf) {
    let root = tmp();
    let custom = root.join("Spiele");
    std::fs::create_dir_all(root.join("meta")).unwrap();
    std::fs::create_dir_all(&custom).unwrap();
    std::fs::copy(fixtures().join("norisk_modpacks.json"), root.join("norisk_modpacks.json")).unwrap();
    std::fs::write(root.join("launcher_config.json"), serde_json::json!({ "custom_game_directory": custom.to_string_lossy() }).to_string()).unwrap();
    std::fs::write(
        root.join("norisk_versions.json"),
        r#"{"profiles":[{"id":"std-only","name":"NRC 1.21.11","path":"noriskclient/new","game_version":"1.21.11","loader":"fabric","group":"NORISK CLIENT","is_standard_version":true,"selected_norisk_pack_id":"child","mods":[]},
            {"id":"p-main","name":"Doppelt","path":"noriskclient/new","game_version":"26.3","loader":"fabric","mods":[]}]}"#,
    )
    .unwrap();
    let c = rusqlite::Connection::open(root.join("meta/app.db")).unwrap();
    c.execute_batch(&std::fs::read_to_string(fixtures().join("app.sql")).unwrap()).unwrap();
    for (id, name) in [(ME, "Mein PvP"), (SIBLING, "Zweitprofil")] {
        c.execute(
            "INSERT INTO profiles (id, name, path, game_version, loader, loader_version, created, group_name, use_shared_minecraft_folder, is_standard_version, settings)
             VALUES (?1, ?2, 'custom/pvp', '1.21.11', 'fabric', '0.18.1', 0, 'PvP: Freunde', 1, 0, '{}')",
            rusqlite::params![id, name],
        )
        .unwrap();
    }
    c.execute_batch(&format!(
        "INSERT INTO profile_mods (profile_id, id, ordinal, source, source_type, project_id, version_id, file_name, enabled, display_name) VALUES
         ('{ME}', 'c1', 0, '{{}}', 'modrinth', 'uUi6zk4B', 'GMCoagTM', 'combatradar-1.7.10-1.21.11-fabric.jar', 1, 'CombatRadar'),
         ('{ME}', 'c2', 1, '{{}}', 'url', NULL, NULL, 'eigener-mod.jar', 0, 'Eigener Mod'),
         ('{ME}', 'c3', 2, '{{}}', 'url', NULL, NULL, 'nicht-geladen.jar', 1, 'Nie gestartet');
         INSERT INTO sync_packs (id, name, enabled, created, updated) VALUES ('{SYNC}', 'Freunde-Pack', 1, 0, 0);
         INSERT INTO sync_pack_mods (pack_id, mod_id, data) VALUES
          ('{SYNC}', 's1', '{{\"id\":\"s1\",\"source\":{{\"type\":\"modrinth\",\"project_id\":\"AANobbMI\",\"version_id\":\"OLD\"}},\"enabled\":true,\"display_name\":\"Sodium\"}}');
         INSERT INTO sync_pack_mod_resolutions (pack_id, project_key, mc_version, loader, version_id, filename, download_url, resolved_at) VALUES
          ('{SYNC}', 'modrinth:AANobbMI', '1.21.11', 'fabric', 'SOD11', 'sodium-fabric-0.8.jar', 'x', 0);
         INSERT INTO profile_sync_packs VALUES ('{ME}', '{SYNC}', 0);"
    ))
    .unwrap();
    drop(c);
    let cache = custom.join("mod_cache");
    std::fs::create_dir_all(&cache).unwrap();
    for f in ["combatradar-1.7.10-1.21.11-fabric.jar", "eigener-mod.jar", "sodium-fabric-0.8.jar"] {
        std::fs::write(cache.join(f), "jar").unwrap();
    }
    let g = custom.join("profiles/groups/pvp freunde");
    jar(&g.join("mods/lose.jar"), &fit("lose", "Lose"));
    jar(&g.join("mods/aus.jar.disabled"), &fit("aus", "Aus"));
    jar(&g.join("mods/rocketload-0.1.0+26.2.jar"), r#"{"id":"rocketload","name":"Rocket","version":"1","depends":{"minecraft":"~26.2"}}"#);
    jar(&g.join("mods/nrc-1.21.11-fabric-a1f7/eigen.jar"), &fit("eigen", "Eigen"));
    jar(&g.join("mods/nrc-1.21.11-fabric-b9c3/fremd.jar"), &fit("fremd", "Fremd"));
    jar(&g.join("mods/nrc-1.21.11-fabric/standard.jar"), &fit("standard", "Standard"));
    jar(&custom.join("sync_packs").join(SYNC).join("mods/radar-addon.jar"), &fit("radaraddon", "Radar Addon"));
    std::fs::create_dir_all(g.join("saves/Welt")).unwrap();
    std::fs::write(g.join("saves/Welt/level.dat"), "lvl").unwrap();
    (root, g)
}

#[test]
fn shared_group_folder_with_own_mods() {
    let (root, g) = shared_root();
    let found = scan(&root, &root.join("tmp"), &root.join("icons"));
    let me = found.iter().find(|f| f.info.name == "Mein PvP").unwrap();
    assert_eq!(me.game_dir, g, "Gruppenname wie im NoRisk-Launcher bereinigt");
    let plan = me.norisk.as_ref().unwrap();
    let radar = plan.mods.iter().find(|m| m.project_id == "uUi6zk4B").expect("CombatRadar aus der Profil-Mod-Liste");
    assert_eq!(radar.version_id.as_deref(), Some("GMCoagTM"));
    assert!(radar.cache.as_ref().is_some_and(|p| p.is_file()), "Ersatz aus mod_cache im eigenen Spielordner");
    let sodium = plan.mods.iter().find(|m| m.project_id == "AANobbMI").expect("Sync-Pack-Mod");
    assert_eq!(sodium.version_id.as_deref(), Some("SOD11"));
    assert!(sodium.cache.is_some());
    let jars: Vec<&str> = plan.jars.iter().map(|j| j.name.as_str()).collect();
    for want in ["lose.jar", "aus.jar.disabled", "eigen.jar", "eigener-mod.jar.disabled", "radar-addon.jar"] {
        assert!(jars.contains(&want), "{want} fehlt: {jars:?}");
    }
    for no in ["fremd.jar", "standard.jar", "rocketload-0.1.0+26.2.jar"] {
        assert!(!jars.contains(&no), "{no} gehört nicht zu diesem Profil: {jars:?}");
    }
    assert!(plan.unfit.iter().any(|u| u.starts_with("rocketload")), "{:?}", plan.unfit);
    assert!(plan.skipped.contains(&"Nie gestartet".to_string()), "URL-Mod ohne Datei wird gemeldet");
    assert_eq!(plan.sync_packs, vec!["Freunde-Pack".to_string()]);
    let sib = found.iter().find(|f| f.info.name == "Zweitprofil").unwrap();
    let sj: Vec<&str> = sib.norisk.as_ref().unwrap().jars.iter().map(|j| j.name.as_str()).collect();
    assert!(sj.contains(&"fremd.jar") && !sj.contains(&"eigen.jar"), "{sj:?}");
    let std_only = found.iter().find(|f| f.info.name == "NRC 1.21.11").expect("Standard-Profil nur in norisk_versions.json");
    assert_eq!(std_only.game_dir, root.join("Spiele/profiles/noriskclient/new"));
    assert!(found.iter().all(|f| f.info.name != "Doppelt"), "Profil aus app.db hat Vorrang");
    let files = run::files_to_copy(&me.game_dir, &me.overlays);
    assert!(files.iter().any(|(_, r)| r.to_string_lossy().replace('\\', "/") == "saves/Welt/level.dat"));
    std::fs::remove_dir_all(&root).ok();
}
