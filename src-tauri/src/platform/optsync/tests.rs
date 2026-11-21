use super::*;

fn tmp_root(tag: &str) -> PathBuf {
    let r = std::env::temp_dir().join(format!("vl-optsync-{tag}-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&r).unwrap();
    r
}

fn enable(root: &Path, id: &str, cats: &[&str]) {
    set_instance(root, id, true, cats.iter().map(|s| s.to_string()).collect()).unwrap();
}

#[test]
fn categories() {
    assert_eq!(category_of("key_key.forward"), Some("keybinds"));
    assert_eq!(category_of("soundCategory_music"), Some("sound"));
    assert_eq!(category_of("renderDistance"), Some("video"));
    assert_eq!(category_of("lang"), Some("language"));
    assert_eq!(category_of("version"), None);
    assert_eq!(category_of("resourcePacks"), None);
    assert_eq!(category_of("lastServer"), None);
    assert!(known_area("servers") && known_area("video") && !known_area("saves"));
}

#[test]
fn merge_keeps_other_keys_and_order() {
    let existing = "version:3955\nlang:en_us\nrenderDistance:12\nresourcePacks:[\"vanilla\"]\nkey_key.forward:key.keyboard.w\n";
    let mut master = BTreeMap::new();
    master.insert("lang".into(), "de_de".into());
    master.insert("renderDistance".into(), "8".into());
    master.insert("key_key.forward".into(), "key.keyboard.up".into());
    master.insert("soundCategory_music".into(), "0.2".into());
    let out = merge_into(
        existing,
        &master,
        &["language".into(), "keybinds".into(), "sound".into()],
        true,
    );
    assert_eq!(
        out,
        "version:3955\nlang:de_de\nrenderDistance:12\nresourcePacks:[\"vanilla\"]\nkey_key.forward:key.keyboard.up\nsoundCategory_music:0.2\n"
    );
}

#[test]
fn old_key_format_is_not_mixed() {
    let mut master = BTreeMap::new();
    master.insert("key_key.forward".into(), "key.keyboard.up".into());
    let out = merge_into(
        "version:1343\nkey_key.forward:17\n",
        &master,
        &["keybinds".into()],
        false,
    );
    assert_eq!(out, "version:1343\nkey_key.forward:17\n");
    assert!(is_pre_113("1.12.2"));
    assert!(!is_pre_113("1.21.4"));
}

#[test]
fn capture_only_selected() {
    let mut m = BTreeMap::new();
    let n = capture(
        "version:1\nfov:0.5\nlang:de_de\nlastServer:x\n",
        &mut m,
        &["video".into()],
    );
    assert_eq!(n, 1);
    assert_eq!(m.get("fov").map(String::as_str), Some("0.5"));
    assert!(!m.contains_key("lang"));
}

#[test]
fn keybinds_migrate_and_keep_independent_formats_and_newer_values() {
    let root = tmp_root("keybinds");
    std::fs::write(config_path(&root), r#"{
        "master":{"key_key.forward":"17"},
        "instances":{"a":{"enabled":true,"categories":["controls"]}}
    }"#).unwrap();
    let old = root.join("old");
    let a = root.join("a");
    let b = root.join("b");
    let cfg = SyncConfig::load(&config_path(&root));
    assert!(cfg.for_instance("a").has("keybinds"));
    assert_eq!(cfg.legacy_keybinds["key_key.forward"], "17");
    enable(&root, "old", &["keybinds"]);
    enable(&root, "b", &["keybinds"]);
    apply(&root, &old, "old", "1.12.2").unwrap();
    assert_eq!(std::fs::read_to_string(old.join("options.txt")).unwrap(), "key_key.forward:17\n");

    std::fs::create_dir_all(&a).unwrap();
    std::fs::write(a.join("options.txt"), "key_key.forward:key.keyboard.w\n").unwrap();
    apply(&root, &a, "a", "1.21.4").unwrap();
    pull(&root, &a, "a", "1.21.4", None).unwrap();
    apply(&root, &a, "a", "1.21.4").unwrap();
    apply(&root, &b, "b", "1.21.4").unwrap();
    std::fs::write(b.join("options.txt"), "key_key.forward:key.keyboard.up\n").unwrap();
    pull(&root, &b, "b", "1.21.4", None).unwrap();
    pull(&root, &a, "a", "1.21.4", None).unwrap();

    let cfg = SyncConfig::load(&config_path(&root));
    assert_eq!(cfg.master["key_key.forward"], "key.keyboard.up");
    assert_eq!(cfg.legacy_keybinds["key_key.forward"], "17");
    enable(&root, "a", &["controls"]);
    assert!(!SyncConfig::load(&config_path(&root)).for_instance("a").has("keybinds"));
    std::fs::remove_dir_all(&root).unwrap();
}

#[test]
fn hotbars_sync_by_version_and_keep_the_conflicting_copy() {
    let root = tmp_root("hotbars");
    let a = root.join("a");
    let b = root.join("b");
    std::fs::create_dir_all(&a).unwrap();
    enable(&root, "a", &["hotbars"]);
    enable(&root, "b", &["hotbars"]);
    std::fs::write(a.join("hotbar.nbt"), b"first").unwrap();
    assert_eq!(sync_now(&root, &a, "a", "A", "1.21.4").changes, 1);
    assert_eq!(before_launch(&root, &b, "b", "B", "1.20.1").changes, 0);
    assert!(!b.join("hotbar.nbt").exists());
    assert_eq!(before_launch(&root, &b, "b", "B", "1.21.4").changes, 1);
    std::fs::write(a.join("hotbar.nbt"), b"shared edit").unwrap();
    std::fs::write(b.join("hotbar.nbt"), b"local edit").unwrap();
    after_exit(&root, &a, "a", "A", "1.21.4", None);
    let summary = after_exit(&root, &b, "b", "B", "1.21.4", None);
    assert!(summary.errors.is_empty(), "{:?}", summary.errors);
    assert_eq!(std::fs::read(b.join("hotbar.nbt")).unwrap(), b"shared edit");
    assert_eq!(std::fs::read(b.join(&summary.conflicts[0].renamed)).unwrap(), b"local edit");
    std::fs::remove_dir_all(&root).unwrap();
}

#[test]
fn histories_merge_new_commands_without_reviving_old_entries() {
    let root = tmp_root("history");
    let a = root.join("a");
    let b = root.join("b");
    std::fs::create_dir_all(&a).unwrap();
    enable(&root, "a", &["command_history"]);
    enable(&root, "b", &["command_history"]);
    let history = (0..50).map(|n| format!("/step{n}\n")).collect::<String>();
    std::fs::write(a.join("command_history.txt"), &history).unwrap();
    before_launch(&root, &a, "a", "A", "1.21.4");
    before_launch(&root, &b, "b", "B", "1.20.2");
    let first = history.find('\n').unwrap() + 1;
    std::fs::write(a.join("command_history.txt"), format!("{}\n/remote\n", &history[first..])).unwrap();
    std::fs::write(b.join("command_history.txt"), format!("{}\n/local\nchat line\n", &history[first..])).unwrap();
    after_exit(&root, &a, "a", "A", "1.21.4", None);
    after_exit(&root, &b, "b", "B", "1.20.2", None);
    let result = std::fs::read_to_string(b.join("command_history.txt")).unwrap();
    assert_eq!(result.lines().count(), 50);
    assert!(result.starts_with("/step2\n"));
    assert!(result.ends_with("/remote\n/local\n"));
    std::fs::remove_dir_all(&root).unwrap();
}

#[test]
fn parallel_sessions_do_not_write_back_stale_options() {
    let root = tmp_root("parallel");
    let a = root.join("a");
    let b = root.join("b");
    std::fs::create_dir_all(&a).unwrap();
    std::fs::create_dir_all(&b).unwrap();
    std::fs::write(a.join("options.txt"), "key_key.zoom:key.keyboard.c\nsoundCategory_music:1.0\n").unwrap();
    std::fs::write(b.join("options.txt"), "key_key.zoom:key.keyboard.c\nsoundCategory_music:1.0\nkey_key.map:key.keyboard.m\n").unwrap();
    enable(&root, "a", &["keybinds", "sound"]);
    enable(&root, "b", &["keybinds", "sound"]);
    before_launch(&root, &a, "a", "A", "1.21.4");
    before_launch(&root, &b, "b", "B", "1.21.4");
    std::fs::write(a.join("options.txt"), "key_key.zoom:key.keyboard.z\nsoundCategory_music:0.2\n").unwrap();
    after_exit(&root, &a, "a", "A", "1.21.4", None);
    after_exit(&root, &b, "b", "B", "1.21.4", None);
    let cfg = SyncConfig::load(&config_path(&root));
    assert_eq!(cfg.master["key_key.zoom"], "key.keyboard.z");
    assert_eq!(cfg.master["soundCategory_music"], "0.2");
    assert_eq!(cfg.master["key_key.map"], "key.keyboard.m");
    before_launch(&root, &b, "b", "B", "1.21.4");
    let text = std::fs::read_to_string(b.join("options.txt")).unwrap();
    assert!(text.contains("key_key.zoom:key.keyboard.z\n") && text.contains("soundCategory_music:0.2\n"), "{text}");
    before_launch(&root, &a, "a", "A", "1.21.4");
    std::fs::write(a.join("options.txt"), "key_key.zoom:key.keyboard.z\nsoundCategory_music:0.2\nkey_key.map:key.keyboard.m\n").unwrap();
    assert_eq!(pull(&root, &a, "a", "1.21.4", None).unwrap(), 0);
    std::fs::remove_dir_all(&root).unwrap();
}

#[test]
fn apply_and_pull_roundtrip() {
    let root = tmp_root("rt");
    let game = root.join("game");
    std::fs::create_dir_all(&game).unwrap();
    let mut cfg = SyncConfig::default();
    cfg.master.insert("fov".into(), "0.8".into());
    cfg.instances.insert(
        "a".into(),
        InstanceSync {
            enabled: true,
            categories: vec!["video".into()],
        },
    );
    cfg.save(&config_path(&root)).unwrap();
    assert_eq!(apply(&root, &game, "a", "1.21.4").unwrap(), 1);
    assert_eq!(
        std::fs::read_to_string(game.join("options.txt")).unwrap(),
        "fov:0.8\n"
    );
    std::fs::write(game.join("options.txt"), "fov:0.3\nlang:fr_fr\n").unwrap();
    assert_eq!(pull(&root, &game, "a", "1.21.4", None).unwrap(), 1);
    let back = SyncConfig::load(&config_path(&root));
    assert_eq!(back.master.get("fov").map(String::as_str), Some("0.3"));
    assert!(!back.master.contains_key("lang"));
    assert_eq!(apply(&root, &game, "b", "1.21.4").unwrap(), 0);
    std::fs::remove_dir_all(&root).ok();
}

/// Bestehende `options-sync.json` (vor dem Ausbau) bleiben gültig: gleiche Bedeutung, neue Felder leer.
#[test]
fn old_config_still_works() {
    let root = tmp_root("old");
    let game = root.join("game");
    std::fs::create_dir_all(&game).unwrap();
    std::fs::write(
        config_path(&root),
        r#"{"master":{"lang":"de_de","renderDistance":"10"},"source":"a","updated_at":1700000000000,"instances":{"a":{"enabled":true,"categories":["language","video"]},"b":{"enabled":false,"categories":["controls"]}}}"#,
    )
    .unwrap();
    let cfg = SyncConfig::load(&config_path(&root));
    assert_eq!(cfg.master.len(), 2);
    assert!(cfg.resource_packs.is_none() && cfg.shader.is_none() && cfg.optifine.is_empty());
    assert!(cfg.for_instance("a").has("language") && !cfg.for_instance("a").has("resourcepacks"));
    std::fs::write(game.join("options.txt"), "version:3955\nlang:en_us\nresourcePacks:[\"vanilla\",\"file/x.zip\"]\n").unwrap();
    assert_eq!(apply(&root, &game, "a", "1.21.4").unwrap(), 2);
    let t = std::fs::read_to_string(game.join("options.txt")).unwrap();
    // Pack-Auswahl bleibt unberührt, solange „Resourcepacks“ nicht gewählt ist
    assert_eq!(t, "version:3955\nlang:de_de\nresourcePacks:[\"vanilla\",\"file/x.zip\"]\nrenderDistance:10\n");
    // Ohne Ordner-Bereiche gibt es keinen Abgleichstand und keine gemeinsamen Ordner
    let s = before_launch(&root, &game, "a", "A", "1.21.4");
    assert_eq!(s.changes, 0);
    assert!(!sync_root(&root).join("resourcepacks").exists());
    // Speichern behält alte Felder
    set_instance(&root, "a", true, vec!["language".into(), "video".into(), "servers".into()]).unwrap();
    let cfg = SyncConfig::load(&config_path(&root));
    assert_eq!(cfg.source.as_deref(), Some("a"));
    assert_eq!(cfg.master.get("lang").map(String::as_str), Some("de_de"));
    std::fs::remove_dir_all(&root).ok();
}

#[test]
fn merge_list_three_way() {
    let v = |s: &str| s.split(',').filter(|x| !x.is_empty()).map(String::from).collect::<Vec<_>>();
    // Nichts in der Instanz geändert -> gemeinsamer Stand
    assert_eq!(merge_list(&v("a,b,c"), &v("a,b"), &v("a,b")), v("a,b,c"));
    // Instanz hat sortiert + d hinzugefügt; anderswo kam x dazu, b wurde anderswo gelöscht
    assert_eq!(merge_list(&v("a,x,c"), &v("a,b,c"), &v("c,a,b,d")), v("c,a,x,d"));
    // Instanz hat b gelöscht
    assert_eq!(merge_list(&v("a,b,c"), &v("a,b,c"), &v("a,c")), v("a,c"));
    // Erster Abgleich (kein Stand) vereinigt
    assert_eq!(merge_list(&v("a,b"), &v(""), &v("c,a")), v("c,a,b"));
    assert_eq!(merge_list(&v("a,b"), &v(""), &v("")), v("a,b"));
}

#[test]
fn pack_selection_survives_incompatible_and_missing() {
    // Log-Erkennung
    let log = "[12:00:01] [Render thread/WARN]: Removed resource pack fabric from options because it doesn't seem to exist anymore\n[12:00:01] [Render thread/WARN]: Removed resource pack file/Alt 1.8.zip from options because it is no longer compatible\nanderes";
    let d = parse_dropped(log);
    assert!(d.contains("fabric") && d.contains("file/Alt 1.8.zip") && d.len() == 2);

    let v = |s: &str| s.split(',').filter(|x| !x.is_empty()).map(String::from).collect::<Vec<_>>();
    let master = v("vanilla,fabric,file/A.zip,file/B.zip");
    // Spiel hat fabric (fehlt) entfernt, Nutzer hat B abgewählt
    let after = v("vanilla,file/A.zip");
    let out = pull_packs(Some(&master), Some(&master), &after, |x| x == "fabric");
    assert_eq!(out, v("vanilla,fabric,file/A.zip"));
    // Nichts geändert außer dem Spiel-Entfernen -> unverändert
    let out = pull_packs(Some(&master), Some(&master), &v("vanilla,file/A.zip,file/B.zip"), |x| x == "fabric");
    assert_eq!(out, master);

    // Schreiben: gewählte Datei-Packs gelten als „trotzdem laden“
    let mut opts = parse_options("resourcePacks:[\"vanilla\"]\nincompatibleResourcePacks:[\"file/Eigen.zip\"]\n");
    write_packs(&mut opts, &v("vanilla,file/A.zip"));
    assert_eq!(
        render_options(&opts),
        "resourcePacks:[\"vanilla\",\"file/A.zip\"]\nincompatibleResourcePacks:[\"file/Eigen.zip\",\"file/A.zip\"]\n"
    );
}

#[test]
fn shader_selection_between_optifine_and_iris() {
    let root = tmp_root("shader");
    let (a, b) = (root.join("a"), root.join("b"));
    std::fs::create_dir_all(a.join("config")).unwrap();
    std::fs::create_dir_all(&b).unwrap();
    // A: Iris, B: OptiFine
    std::fs::write(a.join("config/iris.properties"), "#Iris\nshaderPack=Complementary_r5.zip\nenableShaders=true\nmaxShadowRenderDistance=32\n").unwrap();
    std::fs::write(b.join("optionsshaders.txt"), "shaderPack=OFF\nantialiasingLevel=0\n").unwrap();
    enable(&root, "a", &["shaderpacks"]);
    enable(&root, "b", &["shaderpacks"]);
    pull(&root, &a, "a", "1.21.4", None).unwrap();
    assert_eq!(SyncConfig::load(&config_path(&root)).shader, Some(ShaderSel { pack: "Complementary_r5.zip".into(), enabled: true }));
    apply(&root, &b, "b", "1.21.4").unwrap();
    assert_eq!(std::fs::read_to_string(b.join("optionsshaders.txt")).unwrap(), "shaderPack=Complementary_r5.zip\nantialiasingLevel=0\n");
    // In B (OptiFine) ausgeschaltet -> A: enableShaders=false, Pack bleibt gemerkt
    std::thread::sleep(std::time::Duration::from_millis(15));
    std::fs::write(b.join("optionsshaders.txt"), "shaderPack=OFF\nantialiasingLevel=0\n").unwrap();
    pull(&root, &b, "b", "1.21.4", None).unwrap();
    apply(&root, &a, "a", "1.21.4").unwrap();
    let t = std::fs::read_to_string(a.join("config/iris.properties")).unwrap();
    assert!(t.contains("shaderPack=Complementary_r5.zip\nenableShaders=false\nmaxShadowRenderDistance=32"), "{t}");
    // Ohne Shader-Mod (keine Datei) wird nichts angelegt
    let c = root.join("c");
    std::fs::create_dir_all(&c).unwrap();
    enable(&root, "c", &["shaderpacks"]);
    apply(&root, &c, "c", "1.21.4").unwrap();
    assert!(!c.join("optionsshaders.txt").exists() && !c.join("config").exists());
    std::fs::remove_dir_all(&root).ok();
}

#[test]
fn optifine_options_follow_video() {
    let root = tmp_root("of");
    let (a, b) = (root.join("a"), root.join("b"));
    std::fs::create_dir_all(&a).unwrap();
    std::fs::create_dir_all(&b).unwrap();
    std::fs::write(a.join("optionsof.txt"), "ofFogType:3\nofFullscreenMode:1920x1080\nofDynamicLights:2\n").unwrap();
    std::fs::write(b.join("optionsof.txt"), "ofFogType:1\nofFullscreenMode:2560x1440\n").unwrap();
    enable(&root, "a", &["video"]);
    enable(&root, "b", &["video"]);
    pull(&root, &a, "a", "1.20.1", None).unwrap();
    apply(&root, &b, "b", "1.20.1").unwrap();
    assert_eq!(std::fs::read_to_string(b.join("optionsof.txt")).unwrap(), "ofFogType:3\nofFullscreenMode:2560x1440\nofDynamicLights:2\n");
    std::fs::remove_dir_all(&root).ok();
}

/// Zwei Instanzen mit Resourcepacks + Server-Liste: Start/Ende, Abschalten ohne Datenverlust.
#[test]
fn instances_share_packs_and_servers() {
    use crate::platform::servers::{read_servers, write_servers, ServerEntry};
    let root = tmp_root("e2e");
    let (a, b) = (root.join("instances/a/minecraft"), root.join("instances/b/minecraft"));
    for g in [&a, &b] {
        std::fs::create_dir_all(g.join("resourcepacks")).unwrap();
    }
    std::fs::write(a.join("resourcepacks/Faithful.zip"), b"faithful").unwrap();
    std::fs::write(a.join("options.txt"), "version:3955\nresourcePacks:[\"vanilla\",\"file/Faithful.zip\"]\n").unwrap();
    let srv = |name: &str, ip: &str| ServerEntry { name: name.into(), ip: ip.into(), icon: None, accept_textures: None, hidden: false };
    write_servers(&a.join("servers.dat"), &[srv("Hypixel", "mc.hypixel.net")]).unwrap();
    write_servers(&b.join("servers.dat"), &[srv("Zuhause", "home.example")]).unwrap();
    enable(&root, "a", &["resourcepacks", "servers"]);
    enable(&root, "b", &["resourcepacks", "servers"]);

    // A spielt: danach liegen Pack, Auswahl und Server gemeinsam bereit
    before_launch(&root, &a, "a", "A", "1.21.4");
    let s = after_exit(&root, &a, "a", "A", "1.21.4", None);
    assert!(s.errors.is_empty(), "{:?}", s.errors);
    assert_eq!(SyncConfig::load(&config_path(&root)).resource_packs, Some(vec!["vanilla".to_string(), "file/Faithful.zip".to_string()]));

    // B startet: bekommt Pack, Auswahl und Server; eigener Server bleibt
    before_launch(&root, &b, "b", "B", "1.20.1");
    assert_eq!(std::fs::read(b.join("resourcepacks/Faithful.zip")).unwrap(), b"faithful");
    let t = std::fs::read_to_string(b.join("options.txt")).unwrap();
    assert!(t.contains("resourcePacks:[\"vanilla\",\"file/Faithful.zip\"]"), "{t}");
    assert!(t.contains("incompatibleResourcePacks:[\"file/Faithful.zip\"]"), "{t}");
    let names: Vec<String> = read_servers(&b.join("servers.dat")).unwrap().into_iter().map(|s| s.name).collect();
    assert_eq!(names, vec!["Zuhause", "Hypixel"]);
    after_exit(&root, &b, "b", "B", "1.20.1", None);
    before_launch(&root, &a, "a", "A", "1.21.4");
    let names: Vec<String> = read_servers(&a.join("servers.dat")).unwrap().into_iter().map(|s| s.name).collect();
    assert_eq!(names, vec!["Zuhause", "Hypixel"]);

    // Laufende Instanz wird nicht angefasst: A „läuft“, B fügt ein Pack hinzu -> A bleibt, bis A wieder startet
    std::fs::write(b.join("resourcepacks/Neu.zip"), b"neu").unwrap();
    after_exit(&root, &b, "b", "B", "1.20.1", None);
    assert!(!a.join("resourcepacks/Neu.zip").exists());
    assert!(shared_dir(&root, "resourcepacks").join("Neu.zip").exists());

    // B schaltet Resourcepacks ab: nichts verschwindet aus B, gemeinsamer Ordner bleibt
    set_instance(&root, "b", true, vec!["servers".into()]).unwrap();
    assert!(!InstanceState::load(&root, "b").dirs.contains_key("resourcepacks"));
    std::fs::remove_file(b.join("resourcepacks/Faithful.zip")).unwrap();
    before_launch(&root, &b, "b", "B", "1.20.1");
    after_exit(&root, &b, "b", "B", "1.20.1", None);
    assert!(b.join("resourcepacks/Neu.zip").exists());
    assert!(shared_dir(&root, "resourcepacks").join("Faithful.zip").exists(), "Löschen ohne Sync wirkt nicht auf den gemeinsamen Ordner");
    // A bekommt beim nächsten Start das neue Pack
    before_launch(&root, &a, "a", "A", "1.21.4");
    assert!(a.join("resourcepacks/Neu.zip").exists() && a.join("resourcepacks/Faithful.zip").exists());

    // Snapshot-Wiederherstellung in A (alter Stand ohne Neu.zip) darf Neu.zip nicht überall löschen
    std::fs::remove_file(a.join("resourcepacks/Neu.zip")).unwrap();
    forget_state(&root, "a");
    before_launch(&root, &a, "a", "A", "1.21.4");
    assert!(a.join("resourcepacks/Neu.zip").exists());
    assert!(shared_dir(&root, "resourcepacks").join("Neu.zip").exists());
    std::fs::remove_dir_all(&root).ok();
}
