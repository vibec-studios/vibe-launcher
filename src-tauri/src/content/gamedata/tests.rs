use super::*;

fn tmp() -> PathBuf {
    let d = std::env::temp_dir().join(format!("vl-gd-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&d).unwrap();
    d
}

fn write(p: &Path, s: &str) {
    std::fs::create_dir_all(p.parent().unwrap()).unwrap();
    std::fs::write(p, s).unwrap();
}

fn set_mtime(p: &Path, ms: i64) {
    let f = std::fs::File::options().write(true).open(p).unwrap();
    f.set_modified(std::time::UNIX_EPOCH + std::time::Duration::from_millis(ms as u64)).unwrap();
}

fn by<'a>(v: &'a [DataEntry], p: &str) -> Option<&'a DataEntry> {
    v.iter().find(|e| e.path == p)
}

#[test]
fn rules_all_launchers() {
    use LauncherKind::*;
    for k in [Modrinth, Prism, Multimc, Curseforge, Atlauncher, Norisk, Folder] {
        for keep in ["config", "saves", "xaero", "XaeroWaypoints", "journeymap", "schematics", "screenshots", "options.txt", "servers.dat", "resourcepacks", "shaderpacks", "kubejs", "essential"] {
            assert!(!skip_top(k, Purpose::Import, keep), "{k:?}: {keep} muss mitkommen");
            assert!(!skip_top(k, Purpose::Reimport, keep), "{k:?}: {keep} muss nachimportierbar sein");
        }
        for skip in ["logs", "crash-reports", "hs_err_pid123.log", "servers.dat_old", "usercache.json", ".fabric", "accounts.json", "launcher_accounts.json", "launcher_accounts_microsoft_store.json", "launcher_profiles.json", "versions", "libraries", "assets"] {
            assert!(skip_top(k, Purpose::Import, skip), "{k:?}: {skip} darf nicht mitkommen");
        }
        // Mods nie beim Nachimport
        assert!(skip_top(k, Purpose::Reimport, "mods"));
    }
    // Mods beim Import: Kopie (außer NoRisk – dort über Modrinth/lose JARs)
    assert!(!skip_top(Prism, Purpose::Import, "mods"));
    assert!(skip_top(Norisk, Purpose::Import, "mods"));
    assert!(skip_top(Norisk, Purpose::Import, "NoRiskClient") && skip_top(Norisk, Purpose::Import, "optionsNRC.json"));
    assert!(!skip_top(Prism, Purpose::Import, "NoRiskClient"), "nur bei NoRisk Launcher-intern");
    assert!(skip_top(Curseforge, Purpose::Import, "minecraftinstance.json"));
    assert!(skip_top(Atlauncher, Purpose::Import, "instance.json"));
    assert!(skip_inner("accounts.json") && skip_inner("microsoft_accounts.json") && !skip_inner("waypoints.txt"));
}

#[test]
fn official_launcher_internals() {
    for skip in [
        "launcher_entitlements_microsoft_store.json",
        "launcher_product_state_microsoft_store.json",
        "launcher_ui_state_microsoft_store.json",
        "launcher_gamer_pics_microsoft_store.json",
        "launcher_msa_credentials_microsoft_store.bin",
        "launcher_cef_log.txt",
        "clientId_v2.txt",
        "clientId.txt",
        "staging",
        "quickPlay",
        "webcache2",
    ] {
        assert!(skip_top(LauncherKind::Folder, Purpose::Import, skip), "{skip} ist Launcher-intern");
    }
    for keep in ["options.txt", "launcher.png", "resourcepacks", "screenshots", "pvpai-models"] {
        assert!(!skip_top(LauncherKind::Folder, Purpose::Import, keep), "{keep} gehört zum Spiel");
    }
}

/// Früherer NoRisk-Import (feste Liste): `xaero/` fehlt, Welt wurde übernommen, in der Quelle weitergespielt.
#[test]
fn scan_legacy_norisk() {
    let root = tmp();
    let (src, dst) = (root.join("src"), root.join("dst"));
    let t0 = 1_700_000_000_000i64;
    write(&src.join("xaero/minimap/Multiplayer_x/waypoints.txt"), "w");
    write(&src.join("journeymap/data/a.dat"), "jm");
    write(&src.join("options.txt"), "fov:1");
    write(&src.join("saves/Alt/level.dat"), "lvl2");
    write(&src.join("saves/Neu/level.dat"), "lvl");
    write(&src.join("saves/kein-welt/foo.txt"), "x");
    write(&src.join("logs/latest.log"), "log");
    write(&src.join("mods/a.jar"), "jar");
    write(&src.join("NoRiskClient/x.json"), "nrc");
    write(&src.join("essential/microsoft_accounts.json"), "TOKEN");
    write(&src.join("essential/settings.json"), "{}");
    write(&dst.join("options.txt"), "fov:1");
    write(&dst.join("saves/Alt/level.dat"), "lvl1");
    set_mtime(&dst.join("saves/Alt/level.dat"), t0);
    set_mtime(&src.join("saves/Alt/level.dat"), t0 + 3_600_000);
    // Import lange vor dem Anlegen der Fixtures -> alles in der Quelle ist „neu seit dem Import“
    let prior = Prior { launcher: Some(LauncherKind::Norisk), imported_at: 1_000, copied: None };
    let v = scan(&src, &[], &dst, LauncherKind::Norisk, &prior);
    let x = by(&v, "xaero").unwrap();
    assert_eq!((x.status, x.kind, x.missing_files, x.default_on), (DataStatus::Missing, DataKind::Dir, 1, true));
    assert_eq!(by(&v, "journeymap").unwrap().status, DataStatus::Missing);
    // Welten einzeln: neue fehlt, alte in der Quelle weitergespielt
    let neu = by(&v, "saves/Neu").unwrap();
    assert_eq!((neu.kind, neu.status, neu.default_on), (DataKind::World, DataStatus::Missing, true));
    let alt = by(&v, "saves/Alt").unwrap();
    assert_eq!((alt.status, alt.default_on), (DataStatus::Newer, false));
    assert!(by(&v, "saves/kein-welt").is_none());
    // gleiche Datei, Logs, Mods, NoRisk-Interna und Tokens nicht
    assert!(by(&v, "options.txt").is_none());
    for p in ["logs", "mods", "NoRiskClient"] {
        assert!(by(&v, p).is_none(), "{p}");
    }
    assert_eq!(by(&v, "essential").unwrap().missing_files, 1, "Konto-Datei wird nicht mitgezählt");

    // Standard übernehmen: nur Fehlendes, keine Welt ersetzt, keine Tokens
    let picks: Vec<DataPick> = v.iter().filter(|e| e.default_on).map(|e| DataPick { path: e.path.clone(), overwrite: false }).collect();
    let p = plan(&src, &[], &dst, LauncherKind::Norisk, &prior, &picks);
    assert!(p.replace_worlds.is_empty() && p.ops.iter().all(|o| !o.replace));
    let keep = root.join("keep");
    execute(&p, &dst, &keep, |_| {}, || Ok(())).unwrap();
    assert!(dst.join("xaero/minimap/Multiplayer_x/waypoints.txt").is_file());
    assert!(dst.join("saves/Neu/level.dat").is_file());
    assert_eq!(std::fs::read_to_string(dst.join("saves/Alt/level.dat")).unwrap(), "lvl1", "nicht überschrieben");
    assert!(!dst.join("essential/microsoft_accounts.json").exists());
    assert!(!dst.join("mods").exists() && !dst.join("logs").exists());
    // Danach: nur noch die neuere Welt
    let v2 = scan(&src, &[], &dst, LauncherKind::Norisk, &prior);
    assert_eq!(v2.iter().map(|e| e.path.as_str()).collect::<Vec<_>>(), vec!["saves/Alt"]);
    // Ausdrücklich ersetzen
    let p = plan(&src, &[], &dst, LauncherKind::Norisk, &prior, &[DataPick { path: "saves/Alt".into(), overwrite: true }]);
    assert_eq!(p.replace_worlds, vec!["Alt".to_string()]);
    execute(&p, &dst, &keep, |_| {}, || Ok(())).unwrap();
    assert_eq!(std::fs::read_to_string(dst.join("saves/Alt/level.dat")).unwrap(), "lvl2");
    std::fs::remove_dir_all(&root).ok();
}

/// Prism-Import mit Liste: in Vibe gelöschte Dinge werden nicht vorausgewählt; neuere Dateien nur ausdrücklich.
#[test]
fn scan_removed_and_overwrite() {
    let root = tmp();
    let (src, dst) = (root.join("src"), root.join("dst"));
    write(&src.join("screenshots/a.png"), "a");
    write(&src.join("schematics/haus.litematic"), "neu");
    write(&src.join("config/jei.toml"), "a=2");
    write(&src.join("config/neu.toml"), "n");
    write(&src.join("servers.dat"), "srv");
    write(&dst.join("schematics/haus.litematic"), "alt");
    write(&dst.join("config/jei.toml"), "a=1");
    write(&dst.join("servers.dat"), "srv-vibe");
    let old = 1_600_000_000_000i64;
    set_mtime(&dst.join("schematics/haus.litematic"), old);
    set_mtime(&src.join("schematics/haus.litematic"), old + 100_000);
    set_mtime(&src.join("servers.dat"), old);
    set_mtime(&dst.join("servers.dat"), old + 100_000);
    set_mtime(&src.join("config/jei.toml"), old);
    set_mtime(&dst.join("config/jei.toml"), old + 100_000);
    // Alles existierte schon beim Import (Erstellzeit < imported_at), screenshots wurde übernommen
    let prior = Prior { launcher: Some(LauncherKind::Prism), imported_at: i64::MAX / 2, copied: Some(vec!["screenshots".into(), "schematics".into(), "config".into(), "servers.dat".into()]) };
    let v = scan(&src, &[], &dst, LauncherKind::Prism, &prior);
    let s = by(&v, "screenshots").unwrap();
    assert_eq!((s.status, s.default_on), (DataStatus::Removed, false), "in Vibe gelöscht");
    let sc = by(&v, "schematics").unwrap();
    assert_eq!((sc.status, sc.overwrite_files, sc.default_on), (DataStatus::Newer, 1, false));
    // config: neu.toml existierte schon beim Import -> gilt als gelöscht; jei.toml unterschiedlich (Vibe neuer)
    let c = by(&v, "config").unwrap();
    assert_eq!((c.status, c.overwrite_files), (DataStatus::Changed, 1));
    // servers.dat: Vibe neuer, nicht in ALWAYS_COMPARE -> nicht angeboten
    assert!(by(&v, "servers.dat").is_none());

    // Ohne overwrite passiert bei „neuer“ nichts
    assert!(plan(&src, &[], &dst, LauncherKind::Prism, &prior, &[DataPick { path: "schematics".into(), overwrite: false }]).is_empty());
    let p = plan(&src, &[], &dst, LauncherKind::Prism, &prior, &[DataPick { path: "schematics".into(), overwrite: true }, DataPick { path: "screenshots".into(), overwrite: false }]);
    assert_eq!(p.ops.len(), 2);
    assert!(!p.touches_snapshot());
    let keep = root.join("keep");
    execute(&p, &dst, &keep, |_| {}, || Ok(())).unwrap();
    assert_eq!(std::fs::read_to_string(dst.join("schematics/haus.litematic")).unwrap(), "neu");
    assert_eq!(std::fs::read_to_string(keep.join("schematics/haus.litematic")).unwrap(), "alt", "alte Fassung gesichert");
    assert!(dst.join("screenshots/a.png").is_file(), "ausdrücklich wiederhergestellt");
    // config überschreiben -> Snapshot-Bereich (keine Extra-Sicherung)
    let p = plan(&src, &[], &dst, LauncherKind::Prism, &prior, &[DataPick { path: "config".into(), overwrite: true }]);
    assert!(p.touches_snapshot());
    assert_eq!(p.ops.len(), 1);
    // Unbekannte/manipulierte Pfade werden ignoriert
    assert!(plan(&src, &[], &dst, LauncherKind::Prism, &prior, &[DataPick { path: "../x".into(), overwrite: true }]).is_empty());
    std::fs::remove_dir_all(&root).ok();
}

#[test]
fn new_files_after_import_count_as_missing() {
    let root = tmp();
    let (src, dst) = (root.join("src"), root.join("dst"));
    write(&src.join("screenshots/neu.png"), "n");
    std::fs::create_dir_all(dst.join("screenshots")).unwrap();
    // Import vor langer Zeit -> Datei ist neu
    let prior = Prior { launcher: Some(LauncherKind::Modrinth), imported_at: 1_000, copied: Some(vec!["screenshots".into()]) };
    let v = scan(&src, &[], &dst, LauncherKind::Modrinth, &prior);
    let s = by(&v, "screenshots").unwrap();
    assert_eq!((s.status, s.missing_files, s.default_on), (DataStatus::Partial, 1, true));
    std::fs::remove_dir_all(&root).ok();
}

#[test]
fn top_names_dedup() {
    let rels = [PathBuf::from("config/a"), PathBuf::from("Config/b"), PathBuf::from("options.txt"), PathBuf::from("xaero/x")];
    assert_eq!(top_names(rels.iter().map(PathBuf::as_path)), vec!["config", "options.txt", "xaero"]);
}
