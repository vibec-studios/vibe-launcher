//! Modrinth API v2 (https://docs.modrinth.com/api/). Kein Key nötig; User-Agent setzt `Net`.
use super::http;
use super::*;
use crate::error::AppResult;
use crate::state::AppState;
use serde::Deserialize;
pub use vibe_server_core::content::modrinth::*;

// ------------------------------------------------------------------ Rohdaten

#[derive(Debug, Deserialize)]
struct MrSearch {
    #[serde(default)]
    hits: Vec<MrHit>,
    #[serde(default)]
    total_hits: u64,
}

#[derive(Debug, Deserialize)]
struct MrHit {
    project_id: String,
    #[serde(default)]
    slug: Option<String>,
    #[serde(default)]
    title: String,
    #[serde(default)]
    description: String,
    #[serde(default)]
    author: String,
    #[serde(default)]
    icon_url: Option<String>,
    #[serde(default)]
    downloads: u64,
    #[serde(default)]
    follows: u64,
    #[serde(default)]
    categories: Vec<String>,
    #[serde(default)]
    display_categories: Vec<String>,
    #[serde(default)]
    project_type: String,
    #[serde(default)]
    date_modified: Option<String>,
    #[serde(default)]
    versions: Vec<String>,
    #[serde(default)]
    featured_gallery: Option<String>,
    #[serde(default)]
    gallery: Vec<String>,
    #[serde(default)]
    color: Option<u32>,
    #[serde(default)]
    date_created: Option<String>,
}

#[derive(Debug, Deserialize)]
struct MrMember {
    #[serde(default)]
    role: String,
    #[serde(default)]
    is_owner: bool,
    user: MrUser,
}

#[derive(Debug, Deserialize)]
struct MrUser {
    #[serde(default)]
    username: String,
}

#[derive(Debug, Deserialize)]
struct MrCategory {
    #[serde(default)]
    icon: Option<String>,
    name: String,
    #[serde(default)]
    project_type: String,
    #[serde(default)]
    header: String,
}

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

fn split_categories(cats: &[String]) -> (Vec<String>, Vec<String>) {
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
fn effective_type(project_type: &str, loaders: &[String]) -> ProjectType {
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

fn sort_index(s: SortOrder) -> &'static str {
    match s {
        SortOrder::Relevance => "relevance",
        SortOrder::Downloads => "downloads",
        SortOrder::Follows => "follows",
        SortOrder::Newest => "newest",
        SortOrder::Updated => "updated",
    }
}

fn pretty_name(name: &str) -> String {
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


pub async fn search(state: &AppState, q: &SearchQuery) -> AppResult<SearchResult> {
    let limit = q.limit.clamp(1, 100);
    let mut url = format!(
        "/search?facets={}&index={}&offset={}&limit={}",
        urlencoding::encode(&build_facets(q)),
        sort_index(q.sort),
        q.offset,
        limit
    );
    if !q.query.trim().is_empty() {
        url.push_str(&format!("&query={}", urlencoding::encode(q.query.trim())));
    }
    let r: MrSearch = get(state, &url).await?;
    let hits = r
        .hits
        .into_iter()
        .map(|h| {
            let mut cats = h.categories.clone();
            for c in &h.display_categories {
                if !cats.contains(c) {
                    cats.push(c.clone());
                }
            }
            let (categories, loaders) = split_categories(&cats);
            let mut pt = effective_type(&h.project_type, &loaders);
            if q.project_type == ProjectType::Datapack {
                pt = ProjectType::Datapack;
            }
            let slug = h.slug.clone().unwrap_or_else(|| h.project_id.clone());
            ProjectHit {
                source: Source::Modrinth,
                id: h.project_id,
                slug,
                title: h.title,
                description: h.description,
                author: h.author,
                icon_url: h.icon_url.filter(|u| !u.is_empty()),
                downloads: h.downloads,
                follows: h.follows,
                categories,
                project_type: pt,
                updated: h.date_modified,
                game_versions: h.versions.into_iter().rev().collect(),
                loaders,
                banner_url: h.featured_gallery.filter(|u| !u.is_empty()).or_else(|| h.gallery.into_iter().find(|u| !u.is_empty())),
                color: h.color,
                created: h.date_created,
                manual_download: false,
            }
        })
        .collect();
    Ok(SearchResult { hits, total: r.total_hits, offset: q.offset, limit })
}

pub async fn categories(state: &AppState, project_type: ProjectType) -> AppResult<Vec<Category>> {
    let all: Vec<MrCategory> = get(state, "/tag/category").await?;
    // Datapacks nutzen bei Modrinth die Mod-Kategorien
    let pt = match project_type {
        ProjectType::Datapack => "mod",
        t => project_type_str(t),
    };
    let mut out: Vec<(String, Category)> = all
        .into_iter()
        .filter(|c| c.project_type == pt)
        .map(|c| (c.header.clone(), Category { name: pretty_name(&c.name), id: c.name, icon: c.icon.filter(|i| !i.is_empty()) }))
        .collect();
    out.sort_by(|a, b| a.0.cmp(&b.0).then(a.1.name.cmp(&b.1.name)));
    Ok(out.into_iter().map(|(_, c)| c).collect())
}


async fn author_of(state: &AppState, p: &MrProject) -> String {
    // v3 kennt `is_owner`; gehört das Projekt einer Organisation, gibt es keinen Owner-Nutzer
    let url = format!("https://api.modrinth.com/v3/project/{}/members", p.id);
    let members: Vec<MrMember> = match http::cached(state, url.clone(), state.net.client.get(&url), S).await {
        Ok(b) => serde_json::from_slice(&b).unwrap_or_default(),
        Err(_) => vec![],
    };
    if let Some(o) = members.iter().find(|m| m.is_owner) {
        return o.user.username.clone();
    }
    if p.organization.is_none() {
        let lead = members.iter().find(|m| {
            let r = m.role.to_ascii_lowercase();
            r.contains("owner") || r.contains("lead")
        });
        if let Some(o) = lead.or(members.first()) {
            return o.user.username.clone();
        }
    }
    if let Some(org) = &p.organization {
        #[derive(Deserialize)]
        struct Org {
            name: String,
        }
        let url = format!("https://api.modrinth.com/v3/organization/{org}");
        if let Ok(b) = http::cached(state, url.clone(), state.net.client.get(&url), S).await {
            if let Ok(o) = serde_json::from_slice::<Org>(&b) {
                return o.name;
            }
        }
    }
    members.first().map(|m| m.user.username.clone()).unwrap_or_default()
}

pub async fn project(state: &AppState, id: &str) -> AppResult<ProjectDetails> {
    let p = raw_project(state, id).await?;
    let author = author_of(state, &p).await;
    let hit = project_to_hit(&p, author);
    let mut gallery: Vec<&MrGallery> = p.gallery.iter().collect();
    gallery.sort_by_key(|g| (!g.featured, g.ordering));
    let page_url = page_url(hit.project_type, &p.slug);
    Ok(ProjectDetails {
        body: p.body.clone(),
        body_format: "markdown".into(),
        gallery: gallery
            .into_iter()
            .map(|g| GalleryImage { url: g.url.clone(), title: g.title.clone(), description: g.description.clone(), featured: g.featured })
            .collect(),
        links: ProjectLinks {
            website: p.donation_urls.as_ref().and_then(|d| d.first()).map(|d| d.url.clone()),
            source: p.source_url.clone(),
            issues: p.issues_url.clone(),
            wiki: p.wiki_url.clone(),
            discord: p.discord_url.clone(),
        },
        license: p.license.as_ref().map(|l| if l.name.is_empty() { l.id.clone() } else { l.name.clone() }).filter(|l| !l.is_empty()),
        published: p.published.clone(),
        page_url,
        hit,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn facets() {
        let q = SearchQuery {
            source: Source::Modrinth,
            query: "".into(),
            project_type: ProjectType::Mod,
            game_version: Some("1.20.1".into()),
            loader: Some(LoaderKind::Quilt),
            categories: vec!["technology".into()],
            sort: SortOrder::Downloads,
            offset: 0,
            limit: 20,
            created_after: None,
        };
        assert_eq!(
            build_facets(&q),
            r#"[["project_type:mod"],["versions:1.20.1"],["categories:quilt","categories:fabric"],["categories:technology"]]"#
        );
        let q2 = SearchQuery { project_type: ProjectType::Shader, loader: Some(LoaderKind::Fabric), categories: vec![], ..q };
        assert_eq!(build_facets(&q2), r#"[["project_type:shader"],["versions:1.20.1"]]"#);
        let q3 = SearchQuery { game_version: None, created_after: Some(1_757_000_000), ..q2 };
        assert_eq!(build_facets(&q3), r#"[["project_type:shader"],["created_timestamp>1757000000"]]"#);
    }

    #[test]
    fn search_hit_banner() {
        let h: MrHit = serde_json::from_str(
            r#"{"project_id":"a","title":"A","gallery":["g1","g2"],"featured_gallery":"f","color":123,"date_created":"2025-01-01T00:00:00Z"}"#,
        )
        .unwrap();
        assert_eq!(h.featured_gallery.as_deref(), Some("f"));
        assert_eq!(h.gallery.len(), 2);
        assert_eq!(h.color, Some(123));
    }

    #[test]
    fn version_mapping() {
        let raw = r#"{"id":"abc","project_id":"P1","name":"Sodium 0.5","version_number":"mc1.20.1-0.5.3","changelog":"",
          "dependencies":[{"version_id":null,"project_id":"P2","file_name":null,"dependency_type":"required"},
                          {"project_id":"P3","dependency_type":"incompatible"}],
          "game_versions":["1.20.1"],"version_type":"beta","loaders":["fabric","quilt"],"date_published":"2023-01-01T00:00:00Z",
          "downloads":5,"files":[{"hashes":{"sha1":"aa","sha512":"bb"},"url":"https://cdn.modrinth.com/x.jar","filename":"x.jar","primary":true,"size":10}]}"#;
        let v: MrVersion = serde_json::from_str(raw).unwrap();
        let pv = convert_version(v);
        assert_eq!(pv.release_type, "beta");
        assert_eq!(pv.changelog, None);
        assert_eq!(pv.dependencies[0].kind, DependencyKind::Required);
        assert_eq!(pv.dependencies[1].kind, DependencyKind::Incompatible);
        assert_eq!(pv.files[0].sha512.as_deref(), Some("bb"));
    }

    #[test]
    fn pretty() {
        assert_eq!(pretty_name("game-mechanics"), "Game Mechanics");
        assert_eq!(pretty_name("worldgen"), "Worldgen");
    }
}
