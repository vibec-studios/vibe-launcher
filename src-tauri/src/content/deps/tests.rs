use super::*;
use crate::content::index::MetaDep;
use crate::instance::Loader;

#[test]
fn ranges() {
    assert_eq!(satisfies(">=0.15.0", "0.16.9"), Some(true));
    assert_eq!(satisfies(">=0.17", "0.16.9"), Some(false));
    assert_eq!(satisfies("~1.20.1", "1.20.4"), Some(true));
    assert_eq!(satisfies("~1.20.1", "1.21"), Some(false));
    assert_eq!(satisfies("1.20.x", "1.20.6"), Some(true));
    assert_eq!(satisfies("1.20.x", "1.21.1"), Some(false));
    assert_eq!(satisfies(">=1.21 <1.22", "1.21.4"), Some(true));
    assert_eq!(satisfies(">=1.21 <1.22", "1.22"), Some(false));
    assert_eq!(satisfies("1.20.1 || 1.20.2", "1.20.2"), Some(true));
    assert_eq!(satisfies("^2.0", "3.1"), Some(false));
    assert_eq!(satisfies("*", "whatever"), None);
    assert_eq!(satisfies("[1.20.1,1.21)", "1.20.4"), Some(true));
    assert_eq!(satisfies("[1.20.1,1.21)", "1.21"), Some(false));
    assert_eq!(satisfies("[47,)", "47.2.0"), Some(true));
    assert_eq!(satisfies("[1.21.1]", "1.21.1"), Some(true));
    assert_eq!(satisfies("[1.0,2.0),[3.0,)", "3.5"), Some(true));
    assert_eq!(satisfies(">=0.5.0", "0.5.3+mc1.20.1"), Some(true));
    assert_eq!(satisfies(">=1.0.0", "1.0.0-beta.1"), Some(false));
}

fn scanned(file: &str, id: &str, version: &str, loader: &str, deps: Vec<MetaDep>) -> Scanned {
    Scanned {
        file_name: file.into(),
        key: format!("mods/{file}"),
        enabled: true,
        path: file.into(),
        meta: LocalMeta { mod_id: Some(id.into()), version: Some(version.into()), loader: Some(loader.into()), deps, ..Default::default() },
        modified: 0,
        size: 1,
    }
}

fn d(id: &str, range: Option<&str>, kind: &str) -> MetaDep {
    MetaDep { id: id.into(), range: range.map(str::to_string), kind: kind.into() }
}

#[test]
fn analyze_issues() {
    let inst: Instance = serde_json::from_value(serde_json::json!({
        "id": "x", "name": "x", "icon": null, "accent": null, "group": null, "mc_version": "1.20.1",
        "loader": Loader { kind: LoaderKind::Fabric, version: Some("0.16.9".into()) }, "created_at": 0
    }))
    .unwrap();
    let a = scanned("a.jar", "moda", "1.0", "fabric", vec![d("fabric-api", Some("*"), "required"), d("minecraft", Some("~1.20"), "required"), d("modb", None, "breaks")]);
    let b = scanned("b.jar", "modb", "2.0", "fabric", vec![d("minecraft", Some(">=1.21"), "required"), d("fabricloader", Some(">=0.17"), "required")]);
    let c1 = scanned("c-1.jar", "modc", "1.0.0", "fabric", vec![]);
    let c2 = scanned("c-2.jar", "modc", "1.2.0", "fabric", vec![]);
    let f = scanned("f.jar", "forgemod", "1", "forge", vec![]);
    let all = [&a, &b, &c1, &c2, &f];
    let mods: Vec<ModInfo> = all.iter().map(|s| ModInfo { s, id: s.meta.mod_id.as_deref().unwrap() }).collect();
    let issues = analyze(&inst, &mods, &[]);
    let kinds: Vec<IssueKind> = issues.iter().map(|i| i.kind).collect();
    assert!(kinds.contains(&IssueKind::MissingDependency), "{issues:#?}");
    assert!(kinds.contains(&IssueKind::Incompatible));
    assert!(kinds.contains(&IssueKind::WrongMinecraft));
    assert!(kinds.contains(&IssueKind::VersionMismatch), "fabricloader zu alt");
    assert!(kinds.contains(&IssueKind::WrongLoader));
    let dup = issues.iter().find(|i| i.kind == IssueKind::Duplicate).unwrap();
    assert_eq!(dup.file_name, "c-2.jar", "neuere Version bleibt");
    assert!(matches!(&dup.fixes[0], Fix::Remove { file_names } if file_names == &vec!["c-1.jar".to_string()]));
    // ~1.20 erlaubt 1.20.1 -> kein Minecraft-Problem für a
    assert!(!issues.iter().any(|i| i.kind == IssueKind::WrongMinecraft && i.file_name == "a.jar"));
}

#[test]
fn disabled_dependency() {
    let inst: Instance = serde_json::from_value(serde_json::json!({
        "id": "x", "name": "x", "icon": null, "accent": null, "group": null, "mc_version": "1.21.1",
        "loader": Loader { kind: LoaderKind::Fabric, version: Some("0.16.9".into()) }, "created_at": 0
    }))
    .unwrap();
    let a = scanned("vibey.jar", "vibey", "1.0", "fabric", vec![d("fabric-api", Some("*"), "required"), d("cloth-config", None, "required")]);
    let mut api = scanned("fabric-api-0.110.jar.disabled", "fabric-api", "0.110.0", "fabric", vec![]);
    api.enabled = false;
    api.meta.name = Some("Fabric API".into());
    let mods = [ModInfo { s: &a, id: "vibey" }];
    let off = [ModInfo { s: &api, id: "fabric-api" }];
    let issues = analyze(&inst, &mods, &off);
    let dis = issues.iter().find(|i| i.target.as_deref() == Some("fabric-api")).unwrap();
    assert_eq!(dis.kind, IssueKind::DisabledDependency);
    assert!(matches!(&dis.fixes[0], Fix::Enable { file_name, title } if file_name == "fabric-api-0.110.jar.disabled" && title == "Fabric API"));
    // Wirklich fehlende Abhängigkeit bleibt „fehlt“
    let miss = issues.iter().find(|i| i.target.as_deref() == Some("cloth-config")).unwrap();
    assert_eq!(miss.kind, IssueKind::MissingDependency);
    // Bereitgestellte ID einer deaktivierten Mod zählt auch
    let mut bundle = scanned("bundle.jar.disabled", "bundle", "1", "fabric", vec![]);
    bundle.enabled = false;
    bundle.meta.provides = vec!["cloth-config".into()];
    let off = [ModInfo { s: &api, id: "fabric-api" }, ModInfo { s: &bundle, id: "bundle" }];
    let issues = analyze(&inst, &mods, &off);
    assert!(issues.iter().all(|i| i.kind == IssueKind::DisabledDependency), "{issues:#?}");
}
