use super::*;

pub fn convert_file(f: &CfFile) -> ProjectVersion {
    let (game_versions, loaders) = split_game_versions(&f.game_versions);
    ProjectVersion {
        source: Source::Curseforge,
        id: f.id.to_string(),
        project_id: f.mod_id.to_string(),
        name: if f.display_name.is_empty() { f.file_name.clone() } else { f.display_name.clone() },
        version_number: if f.display_name.is_empty() { f.file_name.clone() } else { f.display_name.clone() },
        game_versions,
        loaders,
        release_type: match f.release_type {
            2 => "beta",
            3 => "alpha",
            _ => "release",
        }
        .into(),
        date: f.file_date.clone(),
        downloads: f.download_count.max(0.0) as u64,
        files: vec![VersionFile {
            url: f.download_url.clone().filter(|u| !u.is_empty()),
            filename: f.file_name.clone(),
            size: f.file_length,
            sha1: f.sha1(),
            primary: true,
            sha512: None,
            fingerprint: fingerprint32(f.file_fingerprint),
        }],
        dependencies: f
            .dependencies
            .iter()
            .map(|d| Dependency {
                project_id: Some(d.mod_id.to_string()),
                version_id: None,
                kind: match d.relation_type {
                    3 => DependencyKind::Required,
                    5 => DependencyKind::Incompatible,
                    1 | 6 => DependencyKind::Embedded,
                    _ => DependencyKind::Optional,
                },
                source: None,
            })
            .collect(),
        changelog: None,
    }
}

pub fn mod_to_hit(m: &CfMod) -> ProjectHit {
    let mut gv: Vec<String> = Vec::new();
    let mut loaders: Vec<String> = Vec::new();
    for i in &m.latest_files_indexes {
        if !gv.contains(&i.game_version) && is_mc_version(&i.game_version) {
            gv.push(i.game_version.clone());
        }
        if let Some(l) = i.mod_loader.and_then(loader_name) {
            if !loaders.iter().any(|x| x == l) {
                loaders.push(l.to_string());
            }
        }
    }
    gv.sort_by_key(|v| std::cmp::Reverse(version_key(v)));
    ProjectHit {
        source: Source::Curseforge,
        id: m.id.to_string(),
        slug: m.slug.clone(),
        title: m.name.clone(),
        description: m.summary.clone(),
        author: m.authors.first().map(|a| a.name.clone()).unwrap_or_default(),
        icon_url: m.logo.as_ref().and_then(|l| l.thumbnail_url.clone().or(l.url.clone())).filter(|u| !u.is_empty()),
        downloads: m.download_count.max(0.0) as u64,
        follows: m.thumbs_up_count,
        categories: m.categories.iter().map(|c| c.name.clone()).collect(),
        project_type: project_type_of_class(m.class_id),
        updated: m.date_modified.clone(),
        game_versions: gv,
        loaders,
        banner_url: m.screenshots.iter().find_map(|s| s.thumbnail_url.clone().or(s.url.clone()).filter(|u| !u.is_empty())),
        color: None,
        created: m.date_created.clone(),
        manual_download: manual_only(m),
    }
}

pub fn page_url(m: &CfMod) -> String {
    m.links.website_url.clone().filter(|u| !u.is_empty()).unwrap_or_else(|| {
        let seg = match project_type_of_class(m.class_id) {
            ProjectType::Mod => "mc-mods",
            ProjectType::Modpack => "modpacks",
            ProjectType::Resourcepack => "texture-packs",
            ProjectType::Shader => "shaders",
            ProjectType::Datapack => "data-packs",
        };
        format!("https://www.curseforge.com/minecraft/{seg}/{}", m.slug)
    })
}

/// Dateiseite auf curseforge.com (für manuelle Downloads).
pub fn file_page_url(m: &CfMod, file_id: u64) -> String {
    format!("{}/files/{file_id}", page_url(m).trim_end_matches('/'))
}

/// Suchparameter (ohne Basis-URL).
pub fn search_params(q: &SearchQuery) -> Vec<(String, String)> {
    let mut p: Vec<(String, String)> = vec![
        ("gameId".into(), GAME_ID.to_string()),
        ("classId".into(), class_id(q.project_type).to_string()),
        ("sortField".into(), sort_field(q.sort, !q.query.trim().is_empty()).to_string()),
        ("sortOrder".into(), "desc".into()),
        ("index".into(), q.offset.min(9_950).to_string()),
        ("pageSize".into(), q.limit.clamp(1, 50).to_string()),
    ];
    if !q.query.trim().is_empty() {
        p.push(("searchFilter".into(), q.query.trim().to_string()));
    }
    if let Some(v) = q.game_version.as_ref().filter(|v| !v.is_empty()) {
        p.push(("gameVersion".into(), v.clone()));
    }
    if matches!(q.project_type, ProjectType::Mod | ProjectType::Modpack) {
        if let Some(l) = q.loader {
            let ml = mod_loader_types(l);
            match ml.len() {
                0 => {}
                1 => p.push(("modLoaderType".into(), ml[0].to_string())),
                _ => p.push(("modLoaderTypes".into(), serde_json::to_string(&ml).unwrap_or_default())),
            }
        }
    }
    let cats: Vec<u64> = q.categories.iter().filter_map(|c| c.parse().ok()).collect();
    match cats.len() {
        0 => {}
        1 => p.push(("categoryId".into(), cats[0].to_string())),
        _ => p.push(("categoryIds".into(), serde_json::to_string(&cats.iter().take(10).collect::<Vec<_>>()).unwrap_or_default())),
    }
    p
}

/// Passt eine Datei zur Instanz? (`loader = None` = egal, z. B. Resourcepacks)
pub fn file_compatible(f: &CfFile, mc: Option<&str>, loader: Option<LoaderKind>) -> bool {
    if f.is_available == Some(false) || f.is_server_pack == Some(true) {
        return false;
    }
    let (versions, loaders) = split_game_versions(&f.game_versions);
    if let Some(mc) = mc {
        if !versions.iter().any(|v| v == mc) {
            return false;
        }
    }
    match loader {
        None | Some(LoaderKind::Vanilla) => true,
        Some(l) => {
            if loaders.is_empty() {
                // Alte Forge-Dateien tragen oft keinen Loader
                return l == LoaderKind::Forge;
            }
            let ok: &[&str] = match l {
                LoaderKind::Fabric => &["fabric"],
                LoaderKind::Quilt => &["quilt", "fabric"],
                LoaderKind::Forge => &["forge"],
                LoaderKind::Neoforge => &["neoforge"],
                LoaderKind::Vanilla => &[],
            };
            loaders.iter().any(|x| ok.contains(&x.as_str())) || (l == LoaderKind::Neoforge && mc == Some("1.20.1") && loaders.iter().any(|x| x == "forge"))
        }
    }
}
