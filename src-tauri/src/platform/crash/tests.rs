//! Tests der Crash-Muster mit anonymisierten Beispiel-Logs (`testdata/`).
use super::*;

fn fixture(name: &str) -> LogText {
    let p = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src/platform/crash/testdata").join(name);
    LogText::read(&p, name).unwrap_or_else(|| panic!("Fixture {name} fehlt"))
}

fn ctx(loader: &str, mc: &str) -> Ctx {
    Ctx { exit_code: Some(1), crash_report: false, max_memory_mb: 4096, system_memory_mb: 32768, mc_version: Some(mc.into()), loader: Some(loader.into()) }
}

fn idx(mods: &[(&str, &str, Option<&str>, Option<&str>)]) -> ModIndex {
    let mut i = ModIndex::default();
    for (id, file, name, ver) in mods {
        i.add(id, ModEntry { file: (*file).into(), name: name.map(Into::into), version: ver.map(Into::into) });
    }
    i
}

fn run(files: &[&str], c: &Ctx, mods: &ModIndex) -> Vec<Diagnosis> {
    let src: Vec<LogText> = files.iter().map(|f| fixture(f)).collect();
    analyze(&src, c, mods)
}

fn find<'a>(d: &'a [Diagnosis], id: &str) -> &'a Diagnosis {
    d.iter().find(|x| x.id == id).unwrap_or_else(|| panic!("{id} fehlt: {d:#?}"))
}

fn ids(d: &[Diagnosis]) -> Vec<&str> {
    d.iter().map(|x| x.id.as_str()).collect()
}

fn culprit_id(d: &Diagnosis) -> Option<&str> {
    d.culprit.as_ref().and_then(|c| c.mod_id.as_deref())
}

#[test]
fn tables_compile_and_examples_match() {
    let t = table();
    assert!(t.patterns.len() >= 20);
    for p in &t.patterns {
        let ex = p.raw.example.as_deref().unwrap_or_else(|| panic!("{}: Beispiel fehlt", p.raw.id));
        assert!(p.re.is_match(&super::logs::LogText::new("x", ex).text), "{}: Beispiel trifft nicht", p.raw.id);
    }
    assert!(!t.pairs.is_empty());
    assert!(t.pairs.iter().all(|p| !p.raw.source.is_empty()), "jedes Paar braucht eine Quelle");
}

#[test]
fn crlf_logs_give_the_same_results() {
    // Echte Windows-Logs (und die Fixtures nach dem Auschecken mit autocrlf) haben CRLF
    for f in ["forge-missing-dependency.txt", "mixin-conflict-vibey-crosshair.log.txt", "broken-config-fabric.txt"] {
        let lf = fixture(f).text.replace("\r\n", "\n");
        let crlf = lf.replace('\n', "\r\n");
        let c = Ctx { crash_report: true, ..ctx("forge", "1.20.1") };
        let a = analyze(&[LogText::new(f, &lf)], &c, &ModIndex::default());
        let b = analyze(&[LogText::new(f, &crlf)], &c, &ModIndex::default());
        assert!(!a.is_empty(), "{f}");
        assert_eq!(a, b, "{f}");
    }
}

#[test]
fn normal_logs_have_no_findings() {
    let none = ModIndex::default();
    for f in ["normal-fabric.txt", "normal-neoforge.txt"] {
        let c = Ctx { exit_code: Some(0), ..ctx("fabric", "1.21.1") };
        let d = run(&[f], &c, &none);
        assert!(d.is_empty(), "{f}: {d:#?}");
        // Auch ohne Exit-Code (Logs-Tab)
        let c = Ctx { exit_code: None, ..ctx("neoforge", "1.21.1") };
        assert!(run(&[f], &c, &none).is_empty(), "{f}");
    }
}

#[test]
fn normal_warnings_do_not_add_findings_to_a_real_crash() {
    // OOM-Absturz + Log mit üblichen Warnungen: nur die echte Ursache
    let d = run(&["oom.txt", "normal-fabric.txt"], &Ctx { crash_report: true, ..ctx("fabric", "1.21.1") }, &ModIndex::default());
    assert_eq!(ids(&d), vec!["out_of_memory"], "{d:#?}");
}

#[test]
fn fabric_missing_dependency_with_range_and_location() {
    let mods = idx(&[("sodium-extra", "sodium-extra-0.5.4.jar", Some("Sodium Extra"), None)]);
    let d = run(&["fabric-missing-dependency.txt"], &ctx("fabric", "1.20.4"), &mods);
    let m: Vec<_> = d.iter().filter(|x| x.id == "missing_dependency").collect();
    assert_eq!(m.len(), 2, "{d:#?}");
    assert_eq!(m[0].params["dependency"], "fabric-api");
    assert_eq!(m[0].culprit.as_ref().unwrap().file.as_deref(), Some("sodium-extra-0.5.4.jar"));
    assert!(matches!(&m[0].actions[0], Action::InstallDependency { mod_id, .. } if mod_id == "fabric-api"));
    assert_eq!(m[1].params["dependency"], "cloth-config");
    assert_eq!(m[1].params["dependency_name"], "Cloth Config v13");
    assert_eq!(m[1].params["range"], "13.0.0 or later");
    assert_eq!(m[0].source.as_deref(), Some("fabric-missing-dependency.txt"));
    assert_eq!(m[0].line, Some(8));
    assert_eq!(m[0].rule.as_deref(), Some("fabric_missing"));
}

#[test]
fn disabled_dependency_is_enabled_instead_of_installed() {
    let mut mods = ModIndex::default();
    mods.disabled.insert("fabric-api".into(), ModEntry { file: "fabric-api-0.92.jar.disabled".into(), name: Some("Fabric API".into()), version: None });
    let d = run(&["fabric-missing-dependency.txt"], &ctx("fabric", "1.20.4"), &mods);
    let m = d.iter().find(|x| x.params.get("dependency").map(String::as_str) == Some("fabric-api")).unwrap();
    assert_eq!(m.params["disabled_file"], "fabric-api-0.92.jar.disabled");
    assert!(matches!(&m.actions[0], Action::EnableMod { file, .. } if file == "fabric-api-0.92.jar.disabled"));
}

#[test]
fn fabric_outdated_dependency_wrong_minecraft_and_loader() {
    let mods = idx(&[
        ("cloth-config", "cloth-config-15.0.127-fabric.jar", Some("Cloth Config v15"), Some("15.0.127")),
        ("roughlyenoughitems", "rei-16.0.783.jar", Some("REI"), None),
        ("xaerominimap", "xaeros-minimap-24.0.2.jar", None, None),
    ]);
    let d = run(&["fabric-outdated-dependency.txt"], &ctx("fabric", "1.21.1"), &mods);
    let o = find(&d, "outdated_dependency");
    assert_eq!(o.params["dependency"], "cloth-config");
    assert_eq!(o.params["present"], "15.0.127");
    assert_eq!(o.params["range"], "15.0.140 or later");
    assert_eq!(o.actions[0], Action::UpdateMod { file: "cloth-config-15.0.127-fabric.jar".into(), mod_id: "cloth-config".into() });
    let w = find(&d, "wrong_minecraft");
    assert_eq!(culprit_id(w), Some("xaerominimap"));
    assert_eq!((w.params["required"].as_str(), w.params["present"].as_str()), ("1.20.1", "1.21.1"));
    assert_eq!(w.actions[0], Action::DisableMod { file: "xaeros-minimap-24.0.2.jar".into() });
    let l = find(&d, "loader_version");
    assert_eq!(l.params["loader"], "fabricloader");
    assert_eq!(l.params["required"], "0.16.10 or later");
}

#[test]
fn forge_missing_outdated_and_wrong_minecraft() {
    let mods = idx(&[("balm", "balm-forge-1.20.1-7.1.4.jar", Some("Balm"), Some("7.1.4")), ("oldmod", "oldmod-1.19.2.jar", None, None)]);
    let d = run(&["forge-missing-dependency.txt"], &ctx("forge", "1.20.1"), &mods);
    let m = find(&d, "missing_dependency");
    assert_eq!(m.params["dependency"], "architectury");
    assert_eq!(m.params["range"], "[9.1.12,)");
    assert_eq!(culprit_id(m), Some("roughlyenoughitems"));
    let o = find(&d, "outdated_dependency");
    assert_eq!(o.params["dependency"], "balm");
    assert_eq!(o.actions[0], Action::UpdateMod { file: "balm-forge-1.20.1-7.1.4.jar".into(), mod_id: "balm".into() });
    assert_eq!(culprit_id(find(&d, "wrong_minecraft")), Some("oldmod"));
    assert_eq!(find(&d, "loader_version").params["loader"], "forge");
}

#[test]
fn neoforge_loading_errors_without_color_codes() {
    let mods = idx(&[("flywheel", "flywheel-neoforge-1.21.1-1.0.0.jar", Some("Flywheel"), Some("1.0.0"))]);
    let d = run(&["neoforge-missing-dependency.txt"], &ctx("neoforge", "1.21.1"), &mods);
    let m = find(&d, "missing_dependency");
    assert_eq!(m.params["dependency"], "sodium");
    assert_eq!(m.culprit.as_ref().unwrap().name.as_deref(), Some("Sodium Extras"));
    assert_eq!(m.params["range"], "0.6.0 or above");
    let o = find(&d, "outdated_dependency");
    assert_eq!(o.params["dependency"], "flywheel");
    assert_eq!(o.params["present"], "1.0.0");
    assert!(matches!(&o.actions[0], Action::UpdateMod { mod_id, .. } if mod_id == "flywheel"));
}

#[test]
fn missing_class_maps_to_library() {
    let mods = idx(&[("roughlyenoughitems", "rei-12.0.jar", Some("REI"), None)]);
    let d = run(&["missing-class.txt"], &Ctx { crash_report: true, ..ctx("fabric", "1.20.1") }, &mods);
    let m = find(&d, "missing_dependency");
    assert_eq!(m.params["dependency"], "architectury-api");
    assert_eq!(m.params["dependency_name"], "Architectury API");
    assert_eq!(culprit_id(m), Some("roughlyenoughitems"));
    assert_eq!(d.iter().filter(|x| x.id == "missing_dependency").count(), 1, "NoClassDefFound + ClassNotFound nur einmal: {d:#?}");
    // Schon installiert -> kein Vorschlag (die Ursache ist eine andere)
    let mut with = mods.clone();
    with.add("architectury", ModEntry { file: "architectury-9.jar".into(), ..Default::default() });
    assert!(!run(&["missing-class.txt"], &Ctx { crash_report: true, ..ctx("fabric", "1.20.1") }, &with).iter().any(|x| x.id == "missing_dependency"));
}

#[test]
fn mixin_conflict_vibey_client_and_centered_crosshair() {
    // Realer Fall: Vibey Client 0.3.0 + Centered Crosshair stürzen beim Start ab
    let mut mods = idx(&[
        ("centered-crosshair", "centered-crosshair-1.3.1+1.21.4.jar", Some("Centered Crosshair"), Some("1.3.1+1.21.4")),
        ("vibeyclient", "vibeyclient-fabric-1.21.4-0.3.0.jar", Some("Vibey Client"), Some("0.3.0+1.21.4")),
        ("fabric-api", "fabric-api-0.110.5.jar", Some("Fabric API"), None),
    ]);
    mods.mixins.insert("centeredcrosshair.mixins.json".into(), "centered-crosshair".into());
    mods.mixins.insert("vibeyclient.mixins.json".into(), "vibeyclient".into());
    let c = Ctx { crash_report: true, ..ctx("fabric", "1.21.4") };
    let d = run(&["mixin-conflict-vibey-crosshair.txt", "mixin-conflict-vibey-crosshair.log.txt"], &c, &mods);
    assert_eq!(d[0].id, "mixin_conflict", "{d:#?}");
    let m = &d[0];
    assert_eq!(culprit_id(m), Some("centered-crosshair"));
    assert_eq!(m.culprit.as_ref().unwrap().file.as_deref(), Some("centered-crosshair-1.3.1+1.21.4.jar"));
    assert_eq!(m.params["other_id"], "vibeyclient");
    assert_eq!(m.params["other_file"], "vibeyclient-fabric-1.21.4-0.3.0.jar");
    assert_eq!(m.params["other_name"], "Vibey Client");
    assert_eq!(m.actions[0], Action::DisableMod { file: "centered-crosshair-1.3.1+1.21.4.jar".into() });
    // Einzelbefund „Mixin-Fehler“ und bekanntes Paar gehen im Konflikt auf, „Suspected Mods“ ist nur Rückfall
    assert_eq!(d.iter().filter(|x| matches!(x.id.as_str(), "mixin_conflict" | "mixin" | "known_conflict" | "suspected_mod")).count(), 1, "{d:#?}");

    // Nur mit dem Crash-Report (ohne Konflikt-Warnung): Meldung nennt die Mod, Stacktrace „[from mod vibeyclient]“
    // ist nur Teil der Laufzeit -> Einzelbefund + bekanntes Paar aus conflicts.toml
    let d = run(&["mixin-conflict-vibey-crosshair.txt"], &c, &mods);
    assert_eq!(culprit_id(find(&d, "mixin")), Some("centered-crosshair"), "{d:#?}");
    let k = find(&d, "known_conflict");
    assert_eq!(k.culprit.as_ref().unwrap().file.as_deref(), Some("centered-crosshair-1.3.1+1.21.4.jar"));
    assert_eq!(k.params["other_file"], "vibeyclient-fabric-1.21.4-0.3.0.jar");
}

#[test]
fn redirect_conflict_warning_alone_is_not_a_crash() {
    // Dieselbe Warnung im Log eines sauber beendeten Spiels -> kein Befund
    let mut t = fixture("mixin-conflict-vibey-crosshair.log.txt");
    t.text = t.text.lines().filter(|l| !l.contains("ERROR") && !l.contains("Crash report")).collect::<Vec<_>>().join("\n");
    let d = analyze(&[t], &Ctx { exit_code: Some(0), ..ctx("fabric", "1.21.4") }, &ModIndex::default());
    assert!(d.is_empty(), "{d:#?}");
}

#[test]
fn single_mixin_failure_names_mod() {
    let mods = idx(&[("betterclouds", "betterclouds-v1.3.2.jar", Some("Better Clouds"), None)]);
    let d = run(&["mixin-single.txt"], &Ctx { crash_report: true, ..ctx("fabric", "1.21.1") }, &mods);
    assert_eq!(d[0].id, "mixin", "{d:#?}");
    let c = d[0].culprit.as_ref().unwrap();
    assert_eq!((c.mod_id.as_deref(), c.name.as_deref()), (Some("betterclouds"), Some("Better Clouds")));
    assert_eq!(d[0].actions[0], Action::DisableMod { file: "betterclouds-v1.3.2.jar".into() });
}

#[test]
fn mixin_configs_and_packages_resolve_mods() {
    let mut mods = idx(&[("sodium", "sodium-0.6.jar", None, None)]);
    mods.packages.push(("net.caffeinemc.mods.sodium.mixin.".into(), "sodium".into()));
    assert_eq!(mods_in("at net.caffeinemc.mods.sodium.mixin.core.WorldMixin.foo", &mods), vec!["sodium"]);
    mods.mixins.insert("sodium-common.mixins.json".into(), "sodium".into());
    assert_eq!(mods_in("in sodium-common.mixins.json:Foo", &mods), vec!["sodium"]);
    // Ohne Index: Config-Name ≈ Mod-ID, Refmaps zählen nicht
    assert_eq!(mods_in("Using refmap a-refmap.json [ -> betterclouds.mixins.json:X", &ModIndex::default()), vec!["betterclouds"]);
}

#[test]
fn duplicates_from_log_and_folder() {
    let d = run(&["duplicate-forge.txt"], &ctx("forge", "1.20.1"), &ModIndex::default());
    assert_eq!(d[0].id, "duplicate_mod");
    assert_eq!(d[0].actions[0], Action::DisableMod { file: "jei-1.20.1-forge-15.3.0.4.jar".into() });
    assert_eq!(d.iter().filter(|x| x.id == "duplicate_mod").count(), 1, "{d:#?}");

    let mods = idx(&[("sodium", "sodium-fabric-0.5.3+mc1.20.1.jar", None, None), ("sodium", "sodium-fabric-0.5.8+mc1.20.4.jar", None, None)]);
    let d = run(&["duplicate-fabric.txt"], &ctx("fabric", "1.20.4"), &mods);
    let dup = find(&d, "duplicate_mod");
    assert_eq!(culprit_id(dup), Some("sodium"));
    assert!(dup.actions.iter().any(|a| matches!(a, Action::DisableMod { .. })));
}

#[test]
fn wrong_loader_file() {
    let d = run(&["wrong-loader-neoforge.txt"], &ctx("neoforge", "1.21.1"), &ModIndex::default());
    let w = find(&d, "wrong_loader");
    assert_eq!(w.params["mod_loader"], "fabric");
    assert_eq!(w.culprit.as_ref().unwrap().file.as_deref(), Some("sodium-fabric-0.6.0+mc1.21.1.jar"));
    assert_eq!(w.actions[0], Action::DisableMod { file: "sodium-fabric-0.6.0+mc1.21.1.jar".into() });
    assert!(w.evidence.as_deref().unwrap().contains("<user>"), "Fixture ist anonymisiert");
}

#[test]
fn java_versions() {
    let d = run(&["java-class-version.txt"], &ctx("fabric", "1.20.6"), &ModIndex::default());
    assert_eq!(d[0].id, "java_version");
    assert_eq!((d[0].params["required"].as_str(), d[0].params["present"].as_str()), ("21", "17"));
    assert_eq!(d[0].actions[0], Action::SetJava { major: 21 });

    // Java 21 für Forge 1.18.2 zu neu -> 17
    let d = run(&["java-too-new.txt"], &ctx("forge", "1.18.2"), &ModIndex::default());
    assert_eq!(d[0].id, "java_version", "{d:#?}");
    assert_eq!(d[0].params["direction"], "older");
    assert_eq!(d[0].actions[0], Action::SetJava { major: 17 });
    // Für 1.21 wäre Java 21 richtig -> kein Befund
    assert!(!run(&["java-too-new.txt"], &ctx("forge", "1.21.1"), &ModIndex::default()).iter().any(|x| x.id == "java_version"));

    let d = run(&["java8-forge.txt"], &ctx("forge", "1.12.2"), &ModIndex::default());
    assert_eq!(d[0].actions[0], Action::SetJava { major: 8 });

    // Fabric: „requires version 21 or later of java“
    let t = LogText::new("x", " - Mod 'Sodium' (sodium) 0.6.0 requires version 21 or later of java, but only the wrong version is present: 17!");
    let d = analyze(&[t], &ctx("fabric", "1.21.1"), &ModIndex::default());
    assert_eq!(d[0].actions[0], Action::SetJava { major: 21 });

    assert_eq!(recommended_java("1.16.5"), Some(8));
    assert_eq!(recommended_java("1.20.4"), Some(17));
    assert_eq!(recommended_java("1.20.5"), Some(21));
    assert_eq!(recommended_java("1.21.4"), Some(21));
    assert_eq!(recommended_java("24w14a"), None);
}

#[test]
fn memory_within_system_limits() {
    let d = run(&["oom.txt"], &Ctx { crash_report: true, max_memory_mb: 2048, ..ctx("fabric", "1.21.1") }, &ModIndex::default());
    assert_eq!(d[0].id, "out_of_memory");
    assert_eq!(d[0].actions[0], Action::IncreaseRam { suggest_mb: 4096 });
    // 8 GB System: höchstens 5 GB
    assert_eq!(suggest_ram(4096, 8192), 5120);
    assert_eq!(suggest_ram(6144, 32768), 9216);
    assert_eq!(suggest_ram(16384, 65536), 16384);
    // Mehr geht nicht -> kein Fix, sondern Hinweis
    let d = run(&["oom.txt"], &Ctx { crash_report: true, max_memory_mb: 6144, system_memory_mb: 8192, ..ctx("fabric", "1.21.1") }, &ModIndex::default());
    assert!(!d[0].actions.iter().any(|a| matches!(a, Action::IncreaseRam { .. })), "{d:#?}");
    assert_eq!(d[0].params["limit"], "8192");

    let d = run(&["heap-reserve.txt"], &Ctx { max_memory_mb: 8192, ..ctx("fabric", "1.21.1") }, &ModIndex::default());
    assert_eq!(d[0].id, "heap_reserve");
}

#[test]
fn broken_configs_are_reset_one_file() {
    let d = run(&["broken-config-forge.txt"], &ctx("forge", "1.20.1"), &ModIndex::default());
    let c = find(&d, "broken_config");
    assert_eq!(c.params["path"], "config/jei-client.toml");
    assert_eq!(culprit_id(c), Some("jei"));
    assert_eq!(c.actions[0], Action::ResetConfig { path: "config/jei-client.toml".into() });

    let d = run(&["broken-config-fabric.txt"], &ctx("fabric", "1.21.1"), &ModIndex::default());
    let c = find(&d, "broken_config");
    assert_eq!(c.params["path"], "config/sodium-options.json");
    assert_eq!(d.iter().filter(|x| x.id == "broken_config").count(), 1, "{d:#?}");

    assert_eq!(config_path(r"C:\x\minecraft\config\sub\a.json5"), Some("config/sub/a.json5".into()));
    assert_eq!(config_path("config/../../evil.json"), None);
    assert_eq!(config_path("myconfig/a.json"), None);
}

#[test]
fn graphics_is_hint_only() {
    let d = run(&["graphics-glfw.txt"], &ctx("fabric", "1.21.1"), &ModIndex::default());
    assert_eq!(d[0].id, "graphics");
    assert!(d[0].actions.iter().all(|a| matches!(a, Action::UpdateDrivers | Action::Upload)));
    let d = run(&["hs_err_pid12345.txt"], &Ctx { exit_code: Some(-1073741819), ..ctx("fabric", "1.21.1") }, &ModIndex::default());
    assert_eq!(d[0].id, "graphics");
    assert_eq!(d[0].params["dll"], "atio6axx.dll");
}

#[test]
fn declared_conflict_and_known_pairs() {
    let mods = idx(&[("sodium", "sodium-0.5.8.jar", Some("Sodium"), None), ("optifabric", "optifabric-1.14.3.jar", Some("OptiFabric"), None)]);
    let d = run(&["fabric-breaks.txt"], &ctx("fabric", "1.20.4"), &mods);
    let c = find(&d, "mod_conflict");
    assert_eq!(culprit_id(c), Some("optifabric"));
    assert_eq!(c.params["other_id"], "sodium");
    assert_eq!(c.actions[0], Action::DisableMod { file: "optifabric-1.14.3.jar".into() });
    assert!(!d.iter().any(|x| x.id == "known_conflict"), "Paar schon als Konflikt gemeldet: {d:#?}");

    // OptiFine ohne Metadaten (Forge) + Embeddium
    let mut m = idx(&[("embeddium", "embeddium-0.3.18.jar", Some("Embeddium"), None)]);
    m.files.push("OptiFine_1.20.1_HD_U_I6.jar".into());
    let h = known_pairs(&m);
    assert_eq!(h.len(), 1, "{h:#?}");
    assert_eq!((h[0].a_file.as_str(), h[0].b_file.as_str()), ("OptiFine_1.20.1_HD_U_I6.jar", "embeddium-0.3.18.jar"));

    // Versionsgebunden: Vibey Client 0.4.0 ist nicht betroffen
    let ok = idx(&[("centered-crosshair", "cc.jar", None, None), ("vibeyclient", "vibeyclient-fabric-1.21.4-0.4.0.jar", None, Some("0.4.0+1.21.4"))]);
    assert!(known_pairs(&ok).is_empty());
    let bad = idx(&[("centered-crosshair", "cc.jar", None, None), ("vibeyclient", "vibeyclient-fabric-1.21.4-0.3.0.jar", None, Some("0.3.0+1.21.4"))]);
    assert_eq!(known_pairs(&bad)[0].id, "centeredcrosshair-vibey");
}

#[test]
fn suspected_fallback_and_exit_codes() {
    let t = LogText::new("x", "-- System Details --\nDetails:\n\tSuspected Mods: Sodium (sodium), Version: 0.5.8+mc1.20.4\n\t\tat TRANSFORMER/sodium@0.5.8/me.jellysquid.Foo");
    let d = analyze(&[t], &Ctx { crash_report: true, ..ctx("fabric", "1.20.4") }, &ModIndex::default());
    assert_eq!(d.len(), 1, "nur der erste unsichere Treffer: {d:#?}");
    assert_eq!(d[0].id, "suspected_mod");
    assert_eq!(culprit_id(&d[0]), Some("sodium"));
    let none = LogText::new("x", "\tSuspected Mods: None");
    assert!(analyze(&[none], &Ctx { crash_report: true, exit_code: None, ..ctx("fabric", "1.20.4") }, &ModIndex::default()).is_empty());

    let d = analyze_text("nichts Besonderes", Some(-805306369), &ModIndex::default(), 4096);
    assert_eq!(d[0].id, "exit_code");
    assert_eq!(d[0].params["hint"], "exit_hang");
    assert!(analyze_text("alles gut", Some(0), &ModIndex::default(), 4096).is_empty());
}

#[test]
fn sources_skip_logs_of_older_launches() {
    let dir = std::env::temp_dir().join(format!("vl-crash-src-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(dir.join("logs")).unwrap();
    std::fs::create_dir_all(dir.join("crash-reports")).unwrap();
    std::fs::write(dir.join("logs/latest.log"), "[main/INFO]: alt\n").unwrap();
    std::fs::write(dir.join("crash-reports/crash-1.txt"), "---- Minecraft Crash Report ----\njava.lang.OutOfMemoryError: Java heap space\n").unwrap();
    std::fs::write(dir.join("hs_err_pid1.log"), "# A fatal error has been detected\n").unwrap();
    // Sitzung beginnt nach den Dateien: latest.log und hs_err sind von einem früheren Start
    let later = crate::util::now_ms() + 60_000;
    let s = collect_sources(&dir, Some("crash-reports/crash-1.txt"), Some(later), "");
    let names: Vec<&str> = s.iter().map(|x| x.name.as_str()).collect();
    assert_eq!(names, vec!["crash-reports/crash-1.txt"], "{names:?}");
    let s = collect_sources(&dir, None, Some(crate::util::now_ms() - 60_000), "konsole");
    let names: Vec<&str> = s.iter().map(|x| x.name.as_str()).collect();
    assert_eq!(names, vec!["hs_err_pid1.log", "logs/latest.log", "console"]);
    // Pfade außerhalb des Spielordners werden ignoriert
    assert!(collect_sources(&dir, Some("../../etc/passwd"), None, "").iter().all(|x| x.name != "crash-report"));
    let _ = std::fs::remove_dir_all(&dir);
}
