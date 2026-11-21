use super::*;

// ------------------------------------------------------------------ Mapping

pub fn project_type_from(s: &str) -> ProjectType {
    match s {
        "modpack" => ProjectType::Modpack,
        "resourcepack" => ProjectType::Resourcepack,
        "shader" => ProjectType::Shader,
        "datapack" => ProjectType::Datapack,
        _ => ProjectType::Mod,
    }
}

pub fn project_type_str(t: ProjectType) -> &'static str {
    match t {
        ProjectType::Mod => "mod",
        ProjectType::Modpack => "modpack",
        ProjectType::Resourcepack => "resourcepack",
        ProjectType::Shader => "shader",
        ProjectType::Datapack => "datapack",
    }
}

pub(super) fn split_categories(cats: &[String]) -> (Vec<String>, Vec<String>) {
    let mut c = Vec::new();
    let mut l = Vec::new();
    for x in cats {
        if LOADER_TAGS.contains(&x.as_str()) {
            if !l.contains(x) {
                l.push(x.clone());
            }
        } else if !c.contains(x) {
            c.push(x.clone());
        }
    }
    (c, l)
}

/// Datapacks sind bei Modrinth Mods mit Loader "datapack" – Typ anhand der Loader korrigieren.
pub(super) fn effective_type(project_type: &str, loaders: &[String]) -> ProjectType {
    let t = project_type_from(project_type);
    if t == ProjectType::Mod && !loaders.is_empty() && loaders.iter().all(|l| l == "datapack") {
        ProjectType::Datapack
    } else {
        t
    }
}

pub fn page_url(project_type: ProjectType, slug: &str) -> String {
    let seg = match project_type {
        ProjectType::Mod => "mod",
        ProjectType::Modpack => "modpack",
        ProjectType::Resourcepack => "resourcepack",
        ProjectType::Shader => "shader",
        ProjectType::Datapack => "datapack",
    };
    format!("https://modrinth.com/{seg}/{slug}")
}

pub fn convert_version(v: MrVersion) -> ProjectVersion {
    let release_type = match v.version_type.as_str() {
        "beta" => "beta",
        "alpha" => "alpha",
        _ => "release",
    }
    .to_string();
    ProjectVersion {
        source: Source::Modrinth,
        id: v.id,
        project_id: v.project_id,
        name: v.name,
        version_number: v.version_number,
        game_versions: v.game_versions,
        loaders: v.loaders,
        release_type,
        date: v.date_published,
        downloads: v.downloads,
        files: v
            .files
            .into_iter()
            .map(|f| VersionFile {
                url: Some(f.url).filter(|u| !u.is_empty()),
                filename: f.filename,
                size: f.size,
                sha1: f.hashes.sha1,
                primary: f.primary,
                sha512: f.hashes.sha512,
                fingerprint: None,
            })
            .collect(),
        dependencies: v
            .dependencies
            .into_iter()
            .map(|d| Dependency {
                project_id: d.project_id,
                version_id: d.version_id,
                kind: match d.dependency_type.as_str() {
                    "required" => DependencyKind::Required,
                    "incompatible" => DependencyKind::Incompatible,
                    "embedded" => DependencyKind::Embedded,
                    _ => DependencyKind::Optional,
                },
                source: None,
            })
            .collect(),
        changelog: v.changelog.filter(|c| !c.trim().is_empty()),
    }
}

pub fn project_to_hit(p: &MrProject, author: String) -> ProjectHit {
    let mut categories = p.categories.clone();
    for c in &p.additional_categories {
        if !categories.contains(c) {
            categories.push(c.clone());
        }
    }
    let (categories, _) = split_categories(&categories);
    ProjectHit {
        source: Source::Modrinth,
        id: p.id.clone(),
        slug: p.slug.clone(),
        title: p.title.clone(),
        description: p.description.clone(),
        author,
        icon_url: p.icon_url.clone().filter(|u| !u.is_empty()),
        downloads: p.downloads,
        follows: p.followers,
        categories,
        project_type: effective_type(&p.project_type, &p.loaders),
        updated: p.updated.clone(),
        game_versions: p.game_versions.iter().rev().cloned().collect(),
        loaders: p.loaders.clone(),
        banner_url: p
            .gallery
            .iter()
            .filter(|g| !g.url.is_empty())
            .min_by_key(|g| (!g.featured, g.ordering))
            .map(|g| g.url.clone()),
        color: p.color,
        created: p.published.clone(),
        manual_download: false,
    }
}

/// Facets für die Suche (als JSON-String).
pub fn build_facets(q: &SearchQuery) -> String {
    let mut facets: Vec<Vec<String>> = Vec::new();
    match q.project_type {
        ProjectType::Datapack => facets.push(vec!["categories:datapack".into()]),
        t => facets.push(vec![format!("project_type:{}", project_type_str(t))]),
    }
    if let Some(v) = q.game_version.as_ref().filter(|v| !v.is_empty()) {
        facets.push(vec![format!("versions:{v}")]);
    }
    if matches!(q.project_type, ProjectType::Mod | ProjectType::Modpack) {
        if let Some(l) = q.loader {
            let ls: Vec<String> = match l {
                LoaderKind::Vanilla => vec![],
                LoaderKind::Quilt => vec!["categories:quilt".into(), "categories:fabric".into()],
                other => vec![format!("categories:{}", other.as_str())],
            };
            if !ls.is_empty() {
                facets.push(ls);
            }
        }
    }
    for c in &q.categories {
        if !c.is_empty() {
            facets.push(vec![format!("categories:{c}")]);
        }
    }
    if let Some(ts) = q.created_after {
        facets.push(vec![format!("created_timestamp>{ts}")]);
    }
    serde_json::to_string(&facets).unwrap_or_else(|_| "[]".into())
}

pub(super) fn sort_index(s: SortOrder) -> &'static str {
    match s {
        SortOrder::Relevance => "relevance",
        SortOrder::Downloads => "downloads",
        SortOrder::Follows => "follows",
        SortOrder::Newest => "newest",
        SortOrder::Updated => "updated",
    }
}

pub(super) fn pretty_name(name: &str) -> String {
    name.split(['-', '_'])
        .filter(|w| !w.is_empty())
        .map(|w| {
            let mut c = w.chars();
            match c.next() {
                Some(f) => f.to_uppercase().collect::<String>() + c.as_str(),
                None => String::new(),
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}
