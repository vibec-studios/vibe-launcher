use super::*;
use crate::platform::crash::Culprit;
use std::collections::BTreeMap;

fn issue(kind: IssueKind, file: &str, name: &str, target: Option<&str>, other: Option<&str>, fixes: Vec<Fix>) -> DepIssue {
    DepIssue {
        kind,
        severity: "error".into(),
        file_name: file.into(),
        mod_name: name.into(),
        target: target.map(Into::into),
        other_file: other.map(Into::into),
        message: format!("{name}: {kind:?}"),
        fixes,
    }
}

fn diag(id: &str, file: Option<&str>, name: Option<&str>, actions: Vec<CrashAction>) -> Diagnosis {
    Diagnosis {
        id: id.into(),
        confidence: 90,
        culprit: Some(Culprit { mod_id: name.map(|n| n.to_lowercase()), name: name.map(Into::into), file: file.map(Into::into) }),
        params: BTreeMap::new(),
        actions,
        evidence: None,
        source: None,
        line: None,
        rule: None,
    }
}

#[test]
fn missing_deps_are_grouped_and_skip_removed_mods() {
    let issues = vec![
        issue(IssueKind::MissingDependency, "a.jar", "A", Some("fabric-api"), None, vec![]),
        issue(IssueKind::MissingDependency, "b.jar", "B", Some("Fabric-API"), None, vec![]),
        // c wird für den falschen Loader gebaut -> dessen Abhängigkeiten sind egal
        issue(IssueKind::WrongLoader, "c.jar", "C", None, None, vec![]),
        issue(IssueKind::MissingDependency, "c.jar", "C", Some("forgeonly"), None, vec![]),
    ];
    let n = needs(&issues, &[], &HashMap::new());
    let installs: Vec<&Need> = n.iter().filter(|x| matches!(x, Need::Install { .. })).collect();
    assert_eq!(installs.len(), 1, "{n:#?}");
    assert!(matches!(installs[0], Need::Install { dep_id, required_by, required_files, .. }
        if dep_id == "fabric-api" && required_by == &vec!["A".to_string(), "B".to_string()] && required_files.len() == 2));
    assert!(n.iter().any(|x| matches!(x, Need::Swap { file, reason, .. } if file == "c.jar" && reason == "wrong_loader")));
}

#[test]
fn duplicates_are_disabled_not_removed() {
    let issues = vec![
        issue(IssueKind::Duplicate, "sodium-2.jar", "Sodium", Some("sodium"), None, vec![Fix::Remove { file_names: vec!["sodium-1.jar".into()] }]),
        // Dieselbe Datei hat zusätzlich eine fehlende Abhängigkeit -> wird nicht gebraucht
        issue(IssueKind::MissingDependency, "sodium-1.jar", "Sodium", Some("x"), None, vec![]),
    ];
    let n = needs(&issues, &[], &HashMap::new());
    assert_eq!(n.len(), 1, "{n:#?}");
    assert!(matches!(&n[0], Need::Disable { file, reason, confirm: false, .. } if file == "sodium-1.jar" && reason == "duplicate"));
}

#[test]
fn conflicts_need_confirmation_and_offer_alternative() {
    let issues = vec![
        issue(IssueKind::Incompatible, "a.jar", "A", Some("b"), Some("b.jar"), vec![]),
        issue(IssueKind::Incompatible, "b.jar", "B", Some("a"), Some("a.jar"), vec![]),
    ];
    let mut names = HashMap::new();
    names.insert("b.jar".to_string(), "Bee".to_string());
    let n = needs(&issues, &[], &names);
    assert_eq!(n.len(), 1, "Paar nur einmal: {n:#?}");
    assert!(matches!(&n[0], Need::Disable { file, name, confirm: true, alt: Some((af, an)), .. }
        if file == "b.jar" && name == "Bee" && af == "a.jar" && an == "A"));
}

#[test]
fn version_mismatch_updates_dependency_or_reports_loader() {
    let issues = vec![
        issue(IssueKind::VersionMismatch, "a.jar", "A", Some("cloth-config"), Some("cloth-1.jar"), vec![]),
        issue(IssueKind::VersionMismatch, "a.jar", "A", Some("fabricloader"), None, vec![]),
        issue(IssueKind::DisabledDependency, "a.jar", "A", Some("lib"), None, vec![Fix::Enable { file_name: "lib.jar.disabled".into(), title: "Lib".into() }]),
    ];
    let n = needs(&issues, &[], &HashMap::new());
    assert!(n.iter().any(|x| matches!(x, Need::Update { file, required_by, .. } if file == "cloth-1.jar" && required_by == "A")));
    // Loader-Version übernimmt loaderfix (Version anheben) -> hier weder Bedarf noch Hinweis
    assert!(!n.iter().any(|x| matches!(x, Need::Unfixable(_))), "{n:#?}");
    assert!(n.iter().any(|x| matches!(x, Need::Enable { file, name, .. } if file == "lib.jar.disabled" && name == "Lib")));
}

#[test]
fn crash_diagnoses_merge_with_dependency_check() {
    let issues = vec![issue(IssueKind::MissingDependency, "a.jar", "A", Some("fabric-api"), None, vec![])];
    let diags = vec![
        diag("missing_dependency", Some("a.jar"), Some("A"), vec![CrashAction::InstallDependency { mod_id: "fabric-api".into(), name: None }]),
        diag("missing_dependency", Some("b.jar"), Some("B"), vec![CrashAction::InstallDependency { mod_id: "cloth-config".into(), name: None }]),
        diag("java_version", None, None, vec![CrashAction::SetJava { major: 21 }]),
        diag("java_version", None, None, vec![CrashAction::SetJava { major: 17 }]),
        diag("suspected_mod", Some("weird.jar"), Some("Weird"), vec![CrashAction::DisableMod { file: "weird.jar".into() }]),
        diag("graphics", None, None, vec![CrashAction::UpdateDrivers]),
    ];
    let n = needs(&issues, &diags, &HashMap::new());
    let installs: Vec<_> = n.iter().filter_map(|x| if let Need::Install { dep_id, cause, .. } = x { Some((dep_id.as_str(), cause.is_some())) } else { None }).collect();
    // fabric-api fand schon der Abhängigkeits-Check – der Absturz bestätigt es (Zuordnung zur Ursache)
    assert_eq!(installs, vec![("fabric-api", true), ("cloth-config", true)]);
    assert_eq!(n.iter().filter(|x| matches!(x, Need::Java { major: 21, cause: Some(2) })).count(), 1);
    assert!(!n.iter().any(|x| matches!(x, Need::Java { major: 17, .. })));
    assert!(n.iter().any(|x| matches!(x, Need::Disable { file, reason, confirm: true, .. } if file == "weird.jar" && reason == "crash_suspect")));
    assert!(n.iter().any(|x| matches!(x, Need::Unfixable(u) if u.reason == "graphics")));
}

fn with(mut d: Diagnosis, params: &[(&str, &str)]) -> Diagnosis {
    for (k, v) in params {
        d.params.insert((*k).into(), (*v).into());
    }
    d
}

#[test]
fn crash_causes_become_confirmed_choices_and_updates() {
    let diags = vec![
        // Vibey Client + Centered Crosshair: eine von beiden deaktivieren (Rückfrage, Alternative)
        with(
            diag("mixin_conflict", Some("cc.jar"), Some("Centered Crosshair"), vec![CrashAction::DisableMod { file: "cc.jar".into() }]),
            &[("other_file", "vibey.jar"), ("other_name", "Vibey Client")],
        ),
        with(
            diag("outdated_dependency", Some("rei.jar"), Some("REI"), vec![CrashAction::UpdateMod { file: "cloth.jar".into(), mod_id: "cloth-config".into() }]),
            &[("dependency_file", "cloth.jar"), ("dependency_name", "Cloth Config")],
        ),
        diag("broken_config", None, Some("jei"), vec![CrashAction::ResetConfig { path: "config/jei-client.toml".into() }]),
        with(diag("out_of_memory", None, None, vec![]), &[("current", "6144")]),
        diag("known_conflict", Some("cc.jar"), Some("Centered Crosshair"), vec![CrashAction::DisableMod { file: "cc.jar".into() }]),
    ];
    let n = needs(&[], &diags, &HashMap::new());
    assert!(n.iter().any(|x| matches!(x, Need::Disable { file, reason, confirm: true, alt: Some((af, an)), cause: Some(0), .. }
        if file == "cc.jar" && reason == "mixin_conflict" && af == "vibey.jar" && an == "Vibey Client")), "{n:#?}");
    assert!(n.iter().any(|x| matches!(x, Need::Update { file, name, required_by, cause: Some(1) } if file == "cloth.jar" && name == "Cloth Config" && required_by == "REI")));
    assert!(n.iter().any(|x| matches!(x, Need::ResetConfig { path, cause: Some(2), .. } if path == "config/jei-client.toml")));
    // Mehr RAM gibt das System nicht her -> Hinweis statt Schritt
    assert!(n.iter().any(|x| matches!(x, Need::Unfixable(u) if u.reason == "ram_limit" && u.cause == Some(3))));
    // Bekanntes Paar für dieselbe Datei: kein zweiter Schritt
    assert_eq!(n.iter().filter(|x| matches!(x, Need::Disable { file, .. } if file == "cc.jar")).count(), 1);
}

#[test]
fn static_findings_are_linked_to_the_crash_cause() {
    // Abhängigkeits-Check findet die fehlende Abhängigkeit schon – der Absturz bestätigt sie
    let issues = vec![
        issue(IssueKind::MissingDependency, "a.jar", "A", Some("fabric-api"), None, vec![]),
        issue(IssueKind::Duplicate, "s2.jar", "Sodium", Some("sodium"), None, vec![Fix::Remove { file_names: vec!["s1.jar".into()] }]),
    ];
    let diags = vec![
        diag("missing_dependency", Some("a.jar"), Some("A"), vec![CrashAction::InstallDependency { mod_id: "fabric-api".into(), name: None }]),
        diag("duplicate_mod", None, Some("Sodium"), vec![CrashAction::DisableMod { file: "s1.jar".into() }]),
    ];
    let n = needs(&issues, &diags, &HashMap::new());
    assert!(n.iter().any(|x| matches!(x, Need::Install { dep_id, cause: Some(0), .. } if dep_id == "fabric-api")), "{n:#?}");
    assert!(n.iter().any(|x| matches!(x, Need::Disable { file, cause: Some(1), .. } if file == "s1.jar")), "{n:#?}");
    assert_eq!(n.len(), 2);
}

#[test]
fn report_with_config_backups_can_be_undone() {
    let rep: FixReport = serde_json::from_str(r#"{"created":1,"snapshot_id":null,"results":[],"manual":[],"prev_java":null,"config_backups":[{"path":"config/a.json","backup":"x"}]}"#).unwrap();
    assert!(can_undo(&rep));
    let a: FixAction = serde_json::from_str(r#"{"kind":"reset_config","path":"config/a.json"}"#).unwrap();
    assert_eq!(a, FixAction::ResetConfig { path: "config/a.json".into() });
}

#[test]
fn crash_wrong_minecraft_is_swapped_once() {
    let issues = vec![issue(IssueKind::WrongMinecraft, "old.jar", "Old", Some("minecraft"), None, vec![])];
    let diags = vec![diag("wrong_minecraft", Some("old.jar"), Some("Old"), vec![CrashAction::DisableMod { file: "old.jar".into() }])];
    let n = needs(&issues, &diags, &HashMap::new());
    assert_eq!(n.iter().filter(|x| matches!(x, Need::Swap { .. })).count(), 1, "{n:#?}");
}

#[test]
fn known_conflicts_from_modrinth_versions() {
    let v = |id: &str, deps: &[(&str, &str)]| mr::MrVersion {
        id: id.into(),
        dependencies: deps.iter().map(|(p, t)| mr::MrDependency { project_id: Some((*p).into()), version_id: None, dependency_type: (*t).into() }).collect(),
        ..Default::default()
    };
    let versions = vec![v("va", &[("pb", "incompatible"), ("pc", "required")]), v("vb", &[("pa", "incompatible")]), v("vc", &[])];
    let file_of: HashMap<&str, &str> = [("va", "a.jar"), ("vb", "b.jar"), ("vc", "c.jar")].into_iter().collect();
    let by_project: HashMap<String, String> = [("pa", "a.jar"), ("pb", "b.jar"), ("pc", "c.jar")].into_iter().map(|(a, b)| (a.to_string(), b.to_string())).collect();
    let c = conflicts_of(&versions, &file_of, &by_project);
    assert_eq!(c, vec![("a.jar".to_string(), "b.jar".to_string())]);
}

#[test]
fn actions_roundtrip_and_order() {
    let mut a = vec![
        FixAction::SetRam { mb: 6144 },
        FixAction::Install { source: Source::Modrinth, project_id: "P7dR8mSH".into(), title: "Fabric API".into() },
        FixAction::Disable { file_name: "x.jar".into() },
        FixAction::SetJava { major: 21, path: None },
        FixAction::Enable { file_name: "y.jar.disabled".into() },
        FixAction::RepairLoader { loader: LoaderKind::Fabric, version: Some("0.16.9".into()) },
        FixAction::SetLoader { loader: LoaderKind::Fabric, from: Some("0.16.9".into()), to: "0.16.14".into() },
    ];
    order(&mut a);
    assert!(matches!(a[0], FixAction::Disable { .. }));
    assert!(matches!(a[1], FixAction::Enable { .. }));
    assert!(matches!(a[3], FixAction::SetJava { .. }), "Java vor dem Loader (Forge-Installer braucht es)");
    assert!(matches!(a[4], FixAction::SetRam { .. }));
    assert!(matches!(a[5], FixAction::SetLoader { .. }));
    assert!(matches!(a[6], FixAction::RepairLoader { .. }));
    let json = serde_json::to_string(&a).unwrap();
    assert!(json.contains(r#""kind":"set_java""#), "{json}");
    assert!(json.contains(r#""kind":"set_loader","loader":"fabric","from":"0.16.9","to":"0.16.14""#), "{json}");
    let back: Vec<FixAction> = serde_json::from_str(&json).unwrap();
    assert_eq!(back, a);
    // Frontend schickt `manual`/`path` evtl. nicht mit
    let r: FixAction = serde_json::from_str(r#"{"kind":"replace","file_name":"a.jar","source":"modrinth","project_id":"p","version_id":"v","title":"A","from_version":null,"to_version":"2"}"#).unwrap();
    assert!(matches!(r, FixAction::Replace { manual: false, .. }));
    let l: FixAction = serde_json::from_str(r#"{"kind":"repair_loader","loader":"neoforge"}"#).unwrap();
    assert_eq!(l, FixAction::RepairLoader { loader: LoaderKind::Neoforge, version: None });
    // Alte Berichte ohne prev_loader bleiben lesbar
    let rep: FixReport = serde_json::from_str(r#"{"created":1,"snapshot_id":null,"results":[],"manual":[],"prev_java":null}"#).unwrap();
    assert!(rep.snapshot_scopes.is_none());
    assert!(!can_undo(&rep));
    assert!(rep.prev_loader.is_none());
}

#[test]
fn wrong_loader_mods_are_swapped_not_deleted() {
    // Forge-Mod in Fabric-Instanz: Tauschen (sonst deaktivieren), ihre Abhängigkeiten zählen nicht mehr
    let issues = vec![
        issue(IssueKind::WrongLoader, "create-forge.jar", "Create", None, None, vec![Fix::Disable { file_name: "create-forge.jar".into() }]),
        issue(IssueKind::MissingDependency, "create-forge.jar", "Create", Some("flywheel"), None, vec![]),
        issue(IssueKind::VersionMismatch, "create-forge.jar", "Create", Some("forge"), None, vec![]),
    ];
    let n = needs(&issues, &[], &HashMap::new());
    assert_eq!(n.len(), 1, "{n:#?}");
    assert!(matches!(&n[0], Need::Swap { file, reason, .. } if file == "create-forge.jar" && reason == "wrong_loader"));
}

#[test]
fn loader_needs_become_steps_and_hints() {
    let inst: Instance = serde_json::from_value(serde_json::json!({
        "id": "x", "name": "x", "icon": null, "accent": null, "group": null, "mc_version": "1.21.1",
        "loader": Loader { kind: LoaderKind::Fabric, version: Some("0.16.9".into()) }, "created_at": 0
    }))
    .unwrap();
    let mut b = Builder { steps: vec![], unfixable: vec![] };
    loader_steps(
        &inst,
        vec![
            LoaderNeed::Set { from: Some("0.16.9".into()), to: "0.16.14".into(), reason: "loader_too_old", required_by: vec!["Create".into()], detail: Some("Create >=0.16.10".into()) },
            LoaderNeed::Repair { version: Some("0.16.9".into()), reason: "loader_files_broken", detail: Some("2".into()) },
            LoaderNeed::Unfixable { reason: "loader_offline", detail: None },
        ],
        &mut b,
    );
    assert_eq!(b.steps.len(), 2);
    let s = &b.steps[0];
    assert_eq!((s.reason.as_str(), s.name.as_str(), s.selected, s.confirm), ("loader_too_old", "Fabric", true, false));
    assert_eq!(s.required_by, vec!["Create".to_string()]);
    assert_eq!(s.detail.as_deref(), Some("Create >=0.16.10"));
    assert!(matches!(&s.action, FixAction::SetLoader { loader: LoaderKind::Fabric, to, .. } if to == "0.16.14"));
    assert!(matches!(&b.steps[1].action, FixAction::RepairLoader { .. }));
    assert_eq!(b.unfixable, vec![Unfixable { reason: "loader_offline".into(), name: "Fabric".into(), detail: None, cause: None }]);
}
