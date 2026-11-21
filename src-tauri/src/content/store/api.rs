use super::*;

pub(super) fn find<'a>(file: &'a StoreFile, id: &str) -> AppResult<&'a StoreProject> {
    file.projects
        .iter()
        .find(|p| p.id == id || p.slug.as_deref() == Some(id))
        .ok_or_else(|| AppError::NotFound(format!("Projekt {id} im Store {}", file.name)))
}

pub(super) fn matches_loader(p: &StoreProject, pt: ProjectType, loader: Option<LoaderKind>, mc: Option<&str>) -> bool {
    let Some(l) = loader else { return true };
    if !matches!(pt, ProjectType::Mod | ProjectType::Modpack) || l == LoaderKind::Vanilla {
        return true;
    }
    let Some((a, b)) = crate::content::provider::modrinth_loaders(pt, l, mc.unwrap_or("")) else { return true };
    p.versions.iter().any(|v| v.loaders.iter().any(|x| a.contains(x) || b.contains(x)) && mc.map_or(true, |m| v.game_versions.iter().any(|g| g == m)))
}

// ------------------------------------------------------------------ Provider-Funktionen

pub async fn search(state: &AppState, key: StoreKey, q: &SearchQuery) -> AppResult<SearchResult> {
    let file = load(state, key).await?;
    let needle = q.query.trim().to_lowercase();
    let mc = q.game_version.as_deref().filter(|v| !v.is_empty());
    let mut list: Vec<(i32, &StoreProject)> = file
        .projects
        .iter()
        .filter(|p| ptype(p) == q.project_type || (q.project_type == ProjectType::Datapack && p.versions.iter().any(|v| v.loaders.iter().any(|l| l == "datapack"))))
        .filter(|p| mc.map_or(true, |m| p.versions.iter().any(|v| v.game_versions.iter().any(|g| g == m))))
        .filter(|p| matches_loader(p, q.project_type, q.loader, mc))
        .filter(|p| q.categories.iter().all(|c| p.categories.contains(c)))
        .filter_map(|p| {
            if needle.is_empty() {
                return Some((0, p));
            }
            let t = p.title.to_lowercase();
            let score = if t == needle {
                100
            } else if t.starts_with(&needle) {
                80
            } else if t.contains(&needle) {
                60
            } else if p.id.contains(&needle) || p.slug.as_deref().is_some_and(|s| s.contains(&needle)) {
                50
            } else if p.description.to_lowercase().contains(&needle) || p.categories.iter().any(|c| c.contains(&needle)) {
                30
            } else if p.author.as_deref().is_some_and(|a| a.to_lowercase().contains(&needle)) {
                20
            } else {
                return None;
            };
            Some((score, p))
        })
        .collect();
    let updated = |p: &StoreProject| p.updated.clone().or_else(|| p.versions.iter().map(|v| v.date.clone()).max()).unwrap_or_default();
    let published = |p: &StoreProject| p.published.clone().or_else(|| p.versions.iter().map(|v| v.date.clone()).min()).unwrap_or_default();
    match q.sort {
        SortOrder::Relevance => list.sort_by(|a, b| b.0.cmp(&a.0).then(b.1.downloads.cmp(&a.1.downloads)).then(a.1.title.cmp(&b.1.title))),
        SortOrder::Downloads | SortOrder::Follows => list.sort_by(|a, b| b.1.downloads.cmp(&a.1.downloads).then(a.1.title.cmp(&b.1.title))),
        SortOrder::Newest => list.sort_by_key(|(_, p)| std::cmp::Reverse(published(p))),
        SortOrder::Updated => list.sort_by_key(|(_, p)| std::cmp::Reverse(updated(p))),
    }
    let total = list.len() as u64;
    let limit = q.limit.clamp(1, 100);
    let hits = list.into_iter().skip(q.offset as usize).take(limit as usize).map(|(_, p)| hit(key, &file, p)).collect();
    Ok(SearchResult { hits, total, offset: q.offset, limit })
}

pub async fn categories(state: &AppState, key: StoreKey, pt: ProjectType) -> AppResult<Vec<Category>> {
    let file = load(state, key).await?;
    let mut cats: Vec<String> = Vec::new();
    for p in file.projects.iter().filter(|p| ptype(p) == pt) {
        for c in &p.categories {
            if !cats.contains(c) {
                cats.push(c.clone());
            }
        }
    }
    cats.sort();
    Ok(cats
        .into_iter()
        .map(|c| {
            let name = c
                .split(['-', '_'])
                .map(|w| {
                    let mut ch = w.chars();
                    ch.next().map(|f| f.to_uppercase().collect::<String>() + ch.as_str()).unwrap_or_default()
                })
                .collect::<Vec<_>>()
                .join(" ");
            Category { id: c, name, icon: None }
        })
        .collect())
}

pub async fn project(state: &AppState, key: StoreKey, id: &str) -> AppResult<ProjectDetails> {
    let file = load(state, key).await?;
    let p = find(&file, id)?;
    let hit = hit(key, &file, p);
    Ok(ProjectDetails {
        body: p.body.clone().unwrap_or_else(|| p.description.clone()),
        body_format: "markdown".into(),
        gallery: p.gallery.iter().map(|g| GalleryImage { url: g.url.clone(), title: g.title.clone(), description: g.description.clone(), featured: false }).collect(),
        links: ProjectLinks { website: p.links.website.clone(), source: p.links.source.clone(), issues: p.links.issues.clone(), wiki: p.links.wiki.clone(), discord: p.links.discord.clone() },
        license: p.license.clone(),
        published: p.published.clone().or_else(|| p.versions.iter().map(|v| v.date.clone()).min()),
        page_url: p.links.website.clone().or_else(|| file.homepage.clone()).unwrap_or_default(),
        hit,
    })
}

pub async fn brief(state: &AppState, key: StoreKey, id: &str) -> AppResult<Brief> {
    let file = load(state, key).await?;
    let p = find(&file, id)?;
    Ok(Brief {
        id: p.id.clone(),
        title: p.title.clone(),
        icon_url: p.icon.clone().filter(|i| !i.is_empty()),
        project_type: ptype(p),
        page_url: p.links.website.clone().or_else(|| file.homepage.clone()).unwrap_or_default(),
        side: project_side(p),
    })
}

/// Alle Versionen eines Projekts (neueste zuerst) + Projekttyp.
pub async fn versions(state: &AppState, key: StoreKey, id: &str) -> AppResult<(Vec<ProjectVersion>, ProjectType)> {
    let file = load(state, key).await?;
    let p = find(&file, id)?;
    let mut v: Vec<ProjectVersion> = p.versions.iter().map(|v| convert_version(key, p, v)).collect();
    v.sort_by(|a, b| b.date.cmp(&a.date));
    Ok((v, ptype(p)))
}

pub async fn version(state: &AppState, key: StoreKey, project_id: &str, version_id: &str) -> AppResult<ProjectVersion> {
    let file = load(state, key).await?;
    let p = find(&file, project_id)?;
    let v = p.versions.iter().find(|v| v.id == version_id).ok_or_else(|| AppError::NotFound(format!("Version {version_id}")))?;
    Ok(convert_version(key, p, v))
}

/// Treffer einer Hash-Zuordnung.
pub struct HashMatch {
    pub key: StoreKey,
    pub title: String,
    pub icon: Option<String>,
    pub version: ProjectVersion,
    pub url: String,
    pub size: u64,
    pub side: Option<Side>,
}

/// sha1/sha256 -> Datei in einem aktivierten Store.
pub async fn by_hash(state: &AppState, hashes: &[(String, Option<String>)]) -> HashMap<String, HashMatch> {
    let mut out = HashMap::new();
    if hashes.is_empty() {
        return out;
    }
    for (key, file) in load_enabled(state).await {
        for p in &file.projects {
            for v in &p.versions {
                for f in &v.files {
                    for (sha1, sha256) in hashes {
                        let hit1 = f.sha1.as_deref().is_some_and(|h| h.eq_ignore_ascii_case(sha1));
                        let hit256 = matches!((f.sha256.as_deref(), sha256.as_deref()), (Some(a), Some(b)) if a.eq_ignore_ascii_case(b));
                        if (hit1 || hit256) && !out.contains_key(sha1) {
                            out.insert(
                                sha1.clone(),
                                HashMatch {
                                    key,
                                    title: p.title.clone(),
                                    icon: p.icon.clone(),
                                    version: convert_version(key, p, v),
                                    url: f.url.clone(),
                                    size: f.size,
                                    side: project_side(p),
                                },
                            );
                        }
                    }
                }
            }
        }
    }
    out
}
