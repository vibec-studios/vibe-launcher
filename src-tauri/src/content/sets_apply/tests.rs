use super::*;

fn v(id: &str, date: &str, rt: &str, mcs: &[&str], loaders: &[&str]) -> ProjectVersion {
    ProjectVersion {
        source: Source::Modrinth,
        id: id.into(),
        project_id: "p".into(),
        name: id.into(),
        version_number: id.into(),
        game_versions: mcs.iter().map(|s| s.to_string()).collect(),
        loaders: loaders.iter().map(|s| s.to_string()).collect(),
        release_type: rt.into(),
        date: date.into(),
        downloads: 0,
        files: vec![],
        dependencies: vec![],
        changelog: None,
    }
}

fn sodium_like() -> Vec<ProjectVersion> {
    vec![
        v("f-1214-beta", "2025-03", "beta", &["1.21.4"], &["fabric"]),
        v("f-1214", "2025-02", "release", &["1.21.4"], &["fabric", "quilt"]),
        v("n-1214", "2025-02", "release", &["1.21.4"], &["neoforge"]),
        v("f-1211", "2024-10", "release", &["1.21", "1.21.1"], &["fabric"]),
        v("f-1201", "2024-01", "release", &["1.20.1"], &["fabric"]),
    ]
}

#[test]
fn resolves_per_version_and_loader() {
    let all = sodium_like();
    // Fabric 1.21.4: stabile Version vor neuerer Beta
    match classify(&all, ProjectType::Mod, "1.21.4", LoaderKind::Fabric) {
        Resolution::Ok(x) => assert_eq!(x.id, "f-1214"),
        r => panic!("{r:?}"),
    }
    // Quilt nutzt Fabric-Dateien
    match classify(&all, ProjectType::Mod, "1.20.1", LoaderKind::Quilt) {
        Resolution::Ok(x) => assert_eq!(x.id, "f-1201"),
        r => panic!("{r:?}"),
    }
    match classify(&all, ProjectType::Mod, "1.21.4", LoaderKind::Neoforge) {
        Resolution::Ok(x) => assert_eq!(x.id, "n-1214"),
        r => panic!("{r:?}"),
    }
}

#[test]
fn explains_unavailable() {
    let all = sodium_like();
    // Forge: gibt es nicht – Loader-Liste für diese Version
    match classify(&all, ProjectType::Mod, "1.21.4", LoaderKind::Forge) {
        Resolution::Unavailable { reason, loaders, older, .. } => {
            assert_eq!(reason, Reason::OtherLoader);
            assert_eq!(loaders, vec!["fabric", "quilt", "neoforge"]);
            assert!(older.is_none());
        }
        r => panic!("{r:?}"),
    }
    // Fabric 1.21.5: noch nicht – nächstältere als Alternative (nur auf Wunsch)
    match classify(&all, ProjectType::Mod, "1.21.5", LoaderKind::Fabric) {
        Resolution::Unavailable { reason, mc_range, older, .. } => {
            assert_eq!(reason, Reason::OtherMc);
            assert_eq!(mc_range, Some(("1.20.1".into(), "1.21.4".into())));
            let (ov, g) = older.unwrap();
            assert_eq!(ov.id, "f-1214");
            assert_eq!(g, "1.21.4");
        }
        r => panic!("{r:?}"),
    }
    // Neoforge 1.21.1: es gibt Fabric für 1.21.1 -> anderer Loader; ältere Neoforge-Version gibt es nicht
    match classify(&all, ProjectType::Mod, "1.21.1", LoaderKind::Neoforge) {
        Resolution::Unavailable { reason, loaders, older, .. } => {
            assert_eq!(reason, Reason::OtherLoader);
            assert_eq!(loaders, vec!["fabric"]);
            assert!(older.is_none());
        }
        r => panic!("{r:?}"),
    }
    // Vanilla braucht einen Loader
    assert!(matches!(classify(&all, ProjectType::Mod, "1.21.4", LoaderKind::Vanilla), Resolution::Unavailable { reason: Reason::NeedsLoader, .. }));
    assert!(matches!(classify(&[], ProjectType::Mod, "1.21.4", LoaderKind::Fabric), Resolution::Unavailable { reason: Reason::NoFiles, .. }));
    assert!(matches!(classify(&all, ProjectType::Modpack, "1.21.4", LoaderKind::Fabric), Resolution::Unavailable { reason: Reason::Modpack, .. }));
}

#[test]
fn datapack_variant_and_loaderless_types() {
    // Mod mit Datapack-Variante: Vanilla bekommt die Datapack-Datei
    let all = vec![v("dp", "2024-05", "release", &["1.21.1"], &["datapack"]), v("fab", "2024-05", "release", &["1.21.1"], &["fabric"])];
    match classify(&all, ProjectType::Mod, "1.21.1", LoaderKind::Vanilla) {
        Resolution::Ok(x) => assert_eq!(x.id, "dp"),
        r => panic!("{r:?}"),
    }
    match classify(&all, ProjectType::Mod, "1.21.1", LoaderKind::Fabric) {
        Resolution::Ok(x) => assert_eq!(x.id, "fab"),
        r => panic!("{r:?}"),
    }
    // Shader/Resourcepacks: Loader egal, nur die Version zählt
    let sh = vec![v("s", "2024", "release", &["1.20.1", "1.21.1"], &["iris", "optifine"])];
    assert!(matches!(classify(&sh, ProjectType::Shader, "1.21.1", LoaderKind::Forge), Resolution::Ok(_)));
    assert!(matches!(classify(&sh, ProjectType::Shader, "1.21.4", LoaderKind::Fabric), Resolution::Unavailable { reason: Reason::OtherMc, .. }));
}

#[test]
fn mc_versions() {
    assert_eq!(mc_cmp("1.21.10", "1.21.9"), Some(Ordering::Greater));
    assert_eq!(mc_cmp("1.21", "1.21.0"), Some(Ordering::Equal));
    assert_eq!(mc_cmp("24w10a", "1.21"), None);
    let mut v = vec!["1.20.1".to_string(), "1.21.4".into(), "1.9".into()];
    sort_mc_desc(&mut v);
    assert_eq!(v, vec!["1.21.4", "1.20.1", "1.9"]);
}

#[test]
fn conflicts_and_installed() {
    let ids: HashSet<String> = ["optifine".to_string(), "fabric-api".into()].into_iter().collect();
    assert_eq!(group_conflicts("sodium", &ids), vec!["optifine"]);
    assert_eq!(group_conflicts("iris", &ids), vec!["optifine"]);
    assert!(group_conflicts("lithium", &ids).is_empty());
    let e = SetEntry { source: Source::Modrinth, project_id: "P7dR8mSH".into(), slug: Some("fabric-api".into()), title: "Fabric API".into(), icon_url: None, project_type: ProjectType::Mod, added: 0 };
    assert!(same_project(&e, &ids, &HashMap::new()).is_some());
    let names: HashMap<String, String> = [(norm("Xaero's Minimap"), "Xaero's Minimap".to_string())].into_iter().collect();
    let x = SetEntry { slug: None, title: "Xaero's Minimap".into(), ..e.clone() };
    assert_eq!(same_project(&x, &HashSet::new(), &names).as_deref(), Some("Xaero's Minimap"));
    let y = SetEntry { slug: Some("sodium".into()), title: "Sodium".into(), ..e };
    assert!(same_project(&y, &ids, &names).is_none());
}

#[test]
fn news_after_apply() {
    let set = sets::ModSet {
        id: "s".into(),
        name: "Performance".into(),
        description: None,
        created: 0,
        updated: 0,
        apply_on_create: false,
        entries: vec![
            SetEntry { source: Source::Modrinth, project_id: "a".into(), slug: None, title: "A".into(), icon_url: None, project_type: ProjectType::Mod, added: 0 },
            SetEntry { source: Source::Modrinth, project_id: "b".into(), slug: None, title: "B".into(), icon_url: None, project_type: ProjectType::Mod, added: 0 },
            SetEntry { source: Source::Modrinth, project_id: "c".into(), slug: None, title: "C".into(), icon_url: None, project_type: ProjectType::Mod, added: 0 },
        ],
    };
    let applied = AppliedSet { applied_at: 1, known: ["modrinth:a".to_string()].into_iter().collect() };
    let mut idx = ContentIndex::default();
    idx.files.insert(
        "mods/c.jar".into(),
        super::super::index::IndexEntry {
            source: Source::Modrinth,
            project_id: "c".into(),
            version_id: "1".into(),
            sha1: None,
            sha512: None,
            title: None,
            icon_url: None,
            version_number: None,
            url: None,
            size: None,
            date: None,
            release_type: None,
            side: None,
        },
    );
    // b ist neu; c ist neu im Set, aber schon installiert
    let n: Vec<&str> = new_entries(&set, &applied, &idx).iter().map(|e| e.project_id.as_str()).collect();
    assert_eq!(n, vec!["b"]);
}

fn planned(id: &str, title: &str) -> Planned {
    let mut ver = v(&format!("{id}-v"), "2025", "release", &["1.21.4"], &["fabric"]);
    ver.files = vec![VersionFile { url: Some(format!("https://cdn.example/{id}.jar")), filename: format!("{id}.jar"), size: 1, sha1: None, primary: true, sha512: None, fingerprint: None }];
    Planned {
        brief: provider::Brief { id: id.into(), title: title.into(), icon_url: None, project_type: ProjectType::Mod, page_url: String::new(), side: None },
        source: Source::Modrinth,
        kind: ContentKind::Mod,
        file: ver.files[0].clone(),
        version: ver,
        side: None,
    }
}

#[test]
fn dependencies_merged_and_listed() {
    // Mod Menu braucht Fabric API, Iris braucht Sodium; Fabric API wird von zwei Projekten gebraucht
    let a = vec![planned("modmenu", "Mod Menu"), planned("fabric-api", "Fabric API")];
    let b = vec![planned("iris", "Iris"), planned("sodium", "Sodium"), planned("fabric-api", "Fabric API")];
    let deps = dep_infos(&b);
    assert_eq!(deps.iter().map(|d| d.title.as_str()).collect::<Vec<_>>(), vec!["Sodium", "Fabric API"]);
    assert_eq!(deps[0].key, "modrinth:sodium");
    assert!(dep_infos(&a[..1]).is_empty());
    let merged = merge_plans(vec![a, b, vec![planned("sodium", "Sodium")]]);
    assert_eq!(merged.iter().map(|p| p.brief.id.as_str()).collect::<Vec<_>>(), vec!["modmenu", "fabric-api", "iris", "sodium"]);
}

#[test]
fn compat_columns_keep_1_21_and_own() {
    // Wie im Echttest (Sodium & Co.): viele neue 26.x-Versionen dürfen 1.21.x nicht verdrängen
    let gs = ["26.3", "26.2", "26.1.2", "26.1.1", "26.1", "1.21.11", "1.21.10", "1.21.4", "1.21.1", "1.20.1", "1.19.2", "1.18.2", "1.16.5", "1.12.2", "1.8.9"];
    let s: Support = gs.iter().map(|g| (g.to_string(), LoaderKind::Fabric)).collect();
    let cols = pick_mc_columns(&[s], &["1.8.9".to_string()]);
    assert_eq!(cols.len(), 10);
    for want in ["26.3", "1.21.11", "1.21.1", "1.21.4", "1.8.9"] {
        assert!(cols.contains(&want.to_string()), "{want} fehlt in {cols:?}");
    }
    assert_eq!(cols.first().map(String::as_str), Some("26.3"));
    assert_eq!(cols.last().map(String::as_str), Some("1.8.9"));
}

#[test]
fn compat_matrix() {
    let a = support_of(&sodium_like(), ProjectType::Mod);
    assert!(a.contains(&("1.21.4".into(), LoaderKind::Quilt)));
    assert!(!a.contains(&("1.21.4".into(), LoaderKind::Forge)));
    assert!(!a.contains(&("1.21.4".into(), LoaderKind::Vanilla)));
    let b = support_of(&[v("b", "1", "release", &["1.21.4", "1.20.1"], &["forge", "fabric"])], ProjectType::Mod);
    let supports = vec![a, b];
    let cols = pick_mc_columns(&supports, &["1.21".to_string()]);
    assert_eq!(cols, vec!["1.21.4", "1.21.1", "1.21", "1.20.1"]);
    let cells = build_matrix(&supports, &cols, &MATRIX_LOADERS);
    let get = |mc: &str, l: LoaderKind| cells.iter().find(|c| c.mc == mc && c.loader == l).unwrap().available;
    assert_eq!(get("1.21.4", LoaderKind::Fabric), 2);
    assert_eq!(get("1.21.4", LoaderKind::Forge), 1);
    assert_eq!(get("1.20.1", LoaderKind::Neoforge), 1); // NeoForge 1.20.1 nimmt Forge-Dateien
    assert_eq!(get("1.21.4", LoaderKind::Neoforge), 1);
    assert_eq!(get("1.21.1", LoaderKind::Forge), 0);
    let best = best_cell(&cells, &cols, &MATRIX_LOADERS).unwrap();
    assert_eq!((best.mc.as_str(), best.loader, best.available), ("1.21.4", LoaderKind::Fabric, 2));
}
