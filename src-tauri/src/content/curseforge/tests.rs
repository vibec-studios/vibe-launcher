use super::*;

const SEARCH: &str = include_str!("../testdata/cf_search.json");
const FILES: &str = include_str!("../testdata/cf_files.json");
const FP: &str = include_str!("../testdata/cf_fingerprints.json");

#[test]
fn parse_search() {
    let r: CfPage<CfMod> = serde_json::from_str(SEARCH).unwrap();
    assert_eq!(r.pagination.total_count, 12345);
    let h = mod_to_hit(&r.data[0]);
    assert_eq!(h.id, "238222");
    assert_eq!(h.title, "Just Enough Items (JEI)");
    assert_eq!(h.author, "mezz");
    assert_eq!(h.project_type, ProjectType::Mod);
    assert_eq!(h.downloads, 300000000);
    assert_eq!(h.game_versions, vec!["1.20.1", "1.19.2"]);
    assert_eq!(h.loaders, vec!["forge", "neoforge", "fabric"]);
    assert_eq!(h.icon_url.as_deref(), Some("https://media.forgecdn.net/avatars/thumbnails/29/69/64/64/635838945588716414.jpeg"));
    assert_eq!(page_url(&r.data[0]), "https://www.curseforge.com/minecraft/mc-mods/jei");
    assert_eq!(file_page_url(&r.data[0], 4712866), "https://www.curseforge.com/minecraft/mc-mods/jei/files/4712866");
}

#[test]
fn parse_files() {
    let mut r: CfPage<CfFile> = serde_json::from_str(FILES).unwrap();
    sort_files(&mut r.data);
    let f = &r.data[0];
    assert_eq!(f.id, 4712866);
    assert!(file_compatible(f, Some("1.20.1"), Some(LoaderKind::Forge)));
    assert!(!file_compatible(f, Some("1.20.1"), Some(LoaderKind::Fabric)));
    assert!(file_compatible(f, Some("1.20.1"), Some(LoaderKind::Neoforge)), "NeoForge 1.20.1 lädt Forge-Mods");
    assert!(!file_compatible(f, Some("1.19.2"), Some(LoaderKind::Forge)));
    let v = convert_file(f);
    assert_eq!(v.game_versions, vec!["1.20.1"]);
    assert_eq!(v.loaders, vec!["forge"]);
    assert_eq!(v.release_type, "release");
    assert_eq!(v.files[0].sha1.as_deref(), Some("0123456789abcdef0123456789abcdef01234567"));
    assert_eq!(v.files[0].url.as_deref(), Some("https://edge.forgecdn.net/files/4712/866/jei-1.20.1-forge-15.2.0.27.jar"));
    assert_eq!(v.dependencies.len(), 3);
    assert_eq!(v.dependencies[0].kind, DependencyKind::Required);
    assert_eq!(v.dependencies[1].kind, DependencyKind::Optional);
    assert_eq!(v.dependencies[2].kind, DependencyKind::Incompatible);
    // Gesperrter Download
    let locked = &r.data[1];
    assert_eq!(convert_file(locked).files[0].url, None);
    assert_eq!(convert_file(locked).release_type, "beta");
    // Fabric-Datei auf Quilt erlaubt
    let fabric = &r.data[2];
    assert!(file_compatible(fabric, Some("1.20.1"), Some(LoaderKind::Quilt)));
    assert!(!file_compatible(fabric, Some("1.20.1"), Some(LoaderKind::Forge)));
}

#[test]
fn parse_fingerprints() {
    let r: CfData<CfFingerprintResult> = serde_json::from_str(FP).unwrap();
    assert_eq!(r.data.exact_matches.len(), 1);
    assert_eq!(r.data.exact_matches[0].id, 238222);
    assert_eq!(r.data.exact_matches[0].file.file_fingerprint, 3089143260);
}

#[test]
fn params() {
    let q = SearchQuery {
        source: Source::Curseforge,
        query: "jei".into(),
        project_type: ProjectType::Mod,
        game_version: Some("1.20.1".into()),
        loader: Some(LoaderKind::Quilt),
        categories: vec!["423".into(), "424".into()],
        sort: SortOrder::Relevance,
        offset: 20,
        limit: 100,
        created_after: None,
    };
    let p = search_params(&q);
    let get = |k: &str| p.iter().find(|(a, _)| a == k).map(|(_, v)| v.clone());
    assert_eq!(get("classId").as_deref(), Some("6"));
    assert_eq!(get("sortField").as_deref(), Some("1"));
    assert_eq!(get("pageSize").as_deref(), Some("50"));
    assert_eq!(get("modLoaderTypes").as_deref(), Some("[5,4]"));
    assert_eq!(get("categoryIds").as_deref(), Some("[423,424]"));
    assert_eq!(get("searchFilter").as_deref(), Some("jei"));
    let q2 = SearchQuery { project_type: ProjectType::Shader, loader: Some(LoaderKind::Forge), query: "".into(), categories: vec![], ..q };
    let p2 = search_params(&q2);
    assert!(p2.iter().all(|(k, _)| k != "modLoaderType" && k != "modLoaderTypes"));
    assert!(p2.iter().any(|(k, v)| k == "classId" && v == "6552"));
    assert!(p2.iter().any(|(k, v)| k == "sortField" && v == "2"));
}

#[test]
fn manual_download_detection() {
    // Echte (gekürzte) API-Antwort: Xray Ultimate erlaubt keine Downloads über andere Launcher
    let m: CfData<CfMod> = serde_json::from_str(include_str!("../testdata/cf_xray_mod.json")).unwrap();
    assert_eq!(m.data.id, 226375);
    assert!(manual_only(&m.data));
    let h = mod_to_hit(&m.data);
    assert!(h.manual_download);
    assert_eq!(h.project_type, ProjectType::Resourcepack);
    assert_eq!(
        file_page_url(&m.data, 9139602),
        "https://www.curseforge.com/minecraft/texture-packs/xray-ultimate-1-11-compatible/files/9139602"
    );
    let files: CfPage<CfFile> = serde_json::from_str(include_str!("../testdata/cf_xray_files.json")).unwrap();
    assert!(files.data.iter().all(|f| f.locked()));
    assert!(file_compatible(&files.data[0], Some("1.21.1"), None));

    // JEI erlaubt Fremd-Downloads; fehlende Angabe (alte Projekte) gilt als erlaubt
    let r: CfPage<CfMod> = serde_json::from_str(SEARCH).unwrap();
    assert!(!mod_to_hit(&r.data[0]).manual_download);
    let unknown = CfMod { allow_mod_distribution: None, ..Default::default() };
    assert!(!manual_only(&unknown));
    let locked = CfFile { download_url: Some(String::new()), ..Default::default() };
    assert!(locked.locked());
    assert_eq!(fingerprint32(0), None);
    assert_eq!(fingerprint32(u32::MAX as u64 + 1), None);
    assert_eq!(fingerprint32(201562264), Some(201562264));
}

#[test]
fn game_versions_split() {
    let (mc, l) = split_game_versions(&["1.20.1".into(), "NeoForge".into(), "Client".into(), "Java 17".into(), "1.21-Snapshot".into()]);
    assert_eq!(mc, vec!["1.20.1", "1.21-Snapshot"]);
    assert_eq!(l, vec!["neoforge"]);
}
