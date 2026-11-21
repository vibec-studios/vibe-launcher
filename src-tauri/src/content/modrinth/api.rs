use super::*;

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

pub(super) async fn author_of(state: &AppState, p: &MrProject) -> String {
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
