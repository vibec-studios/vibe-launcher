use super::*;

// ------------------------------------------------------------------ Projektdetails (Overlay)

/// Details eines Hangar-Projekts im Format der Projektseite (`ProjectDetails` im Frontend).
#[derive(Debug, Clone, Serialize)]
pub struct AddonProject {
    pub source: AddonSource,
    pub id: String,
    pub slug: String,
    pub title: String,
    pub description: String,
    pub author: String,
    pub icon_url: Option<String>,
    pub downloads: u64,
    /// Sterne
    pub follows: u64,
    pub categories: Vec<String>,
    pub project_type: &'static str,
    pub updated: Option<String>,
    pub created: Option<String>,
    pub published: Option<String>,
    pub game_versions: Vec<String>,
    pub loaders: Vec<String>,
    pub body: String,
    pub body_format: &'static str,
    pub gallery: Vec<crate::content::GalleryImage>,
    pub links: crate::content::ProjectLinks,
    pub license: Option<String>,
    pub page_url: String,
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub(super) struct HangarFull {
    pub(super) name: String,
    pub(super) namespace: Option<HangarNamespace>,
    pub(super) description: String,
    pub(super) avatar_url: Option<String>,
    pub(super) last_updated: Option<String>,
    pub(super) created_at: Option<String>,
    pub(super) published_at: Option<String>,
    pub(super) category: Option<String>,
    pub(super) stats: HangarFullStats,
    pub(super) settings: HangarSettings,
    pub(super) supported_platforms: HashMap<String, Vec<String>>,
}

#[derive(Deserialize, Default)]
#[serde(default)]
pub(super) struct HangarFullStats {
    pub(super) downloads: u64,
    pub(super) stars: u64,
}

#[derive(Deserialize, Default)]
#[serde(default)]
pub(super) struct HangarSettings {
    pub(super) links: Vec<HangarLinkSection>,
    pub(super) tags: Vec<String>,
    pub(super) license: Option<HangarLicense>,
    pub(super) keywords: Vec<String>,
}

#[derive(Deserialize, Default)]
#[serde(default)]
pub(super) struct HangarLinkSection {
    pub(super) links: Vec<HangarLink>,
}

#[derive(Deserialize, Default)]
#[serde(default)]
pub(super) struct HangarLink {
    pub(super) name: String,
    pub(super) url: String,
}

#[derive(Deserialize, Default)]
#[serde(default)]
pub(super) struct HangarLicense {
    pub(super) name: Option<String>,
    #[serde(rename = "type")]
    pub(super) kind: Option<String>,
}

/// Hangar-Projekt (JSON von `/projects/{slug}`) + Hauptseite (Markdown) umwandeln.
pub fn parse_hangar_project(b: &[u8], page: Option<String>) -> AppResult<AddonProject> {
    let p: HangarFull = http::parse(b, "Hangar")?;
    let ns = p.namespace.unwrap_or(HangarNamespace { owner: String::new(), slug: p.name.clone() });
    let full = format!("{}/{}", ns.owner, ns.slug);
    let mut links = crate::content::ProjectLinks::default();
    for l in p.settings.links.iter().flat_map(|s| s.links.iter()) {
        if !l.url.starts_with("https://") && !l.url.starts_with("http://") {
            continue;
        }
        let n = l.name.to_ascii_lowercase();
        let u = Some(l.url.clone());
        if n.contains("issue") || n.contains("bug") {
            links.issues = links.issues.or(u);
        } else if n.contains("source") || n.contains("github") || n.contains("code") {
            links.source = links.source.or(u);
        } else if n.contains("wiki") || n.contains("doc") {
            links.wiki = links.wiki.or(u);
        } else if l.url.contains("discord.") {
            links.discord = links.discord.or(u);
        } else if links.website.is_none() && !n.contains("donat") && !n.contains("sponsor") {
            links.website = u;
        }
    }
    // Versionen der Server-Software (Paper), neueste zuerst
    let mut game_versions: Vec<String> = p.supported_platforms.get("PAPER").cloned().unwrap_or_default();
    game_versions.sort_by_key(|v| std::cmp::Reverse(version_key(v)));
    let mut loaders: Vec<String> = p.supported_platforms.keys().map(|k| k.to_ascii_lowercase()).collect();
    loaders.sort();
    if p.settings.tags.iter().any(|t| t == "SUPPORTS_FOLIA") && !loaders.iter().any(|l| l == "folia") {
        loaders.push("folia".into());
    }
    let mut categories: Vec<String> = p.category.into_iter().map(|c| c.replace('_', "-")).collect();
    categories.extend(p.settings.keywords.into_iter().take(4));
    let license = p.settings.license.and_then(|l| l.name.filter(|n| !n.is_empty()).or(l.kind));
    let body = page.filter(|b| !b.trim().is_empty()).unwrap_or_else(|| p.description.clone());
    Ok(AddonProject {
        source: AddonSource::Hangar,
        id: full.clone(),
        slug: ns.slug,
        title: p.name,
        description: p.description,
        author: ns.owner,
        icon_url: p.avatar_url.filter(|u| !u.contains("/avatars/default/")),
        downloads: p.stats.downloads,
        follows: p.stats.stars,
        categories,
        project_type: "plugin",
        updated: p.last_updated,
        created: p.created_at,
        published: p.published_at,
        game_versions,
        loaders,
        body,
        body_format: "markdown",
        gallery: vec![],
        links,
        license,
        page_url: hangar_page(&full),
    })
}

/// „1.21.11“ -> [1, 21, 11] zum Sortieren.
pub(super) fn version_key(v: &str) -> Vec<u32> {
    v.split('.').map(|p| p.parse().unwrap_or(0)).collect()
}

pub async fn hangar_project(state: &Core, project: &str) -> AppResult<AddonProject> {
    let slug = project.rsplit('/').next().unwrap_or(project);
    if slug.is_empty() || slug.contains(['?', '#', '\\']) {
        return Err(AppError::Invalid("Ungültiges Hangar-Projekt".into()));
    }
    let enc = urlencoding::encode(slug);
    let purl = format!("{HANGAR}/projects/{enc}");
    let b = http::cached(state, purl.clone(), state.net.client.get(&purl), "Hangar").await?;
    let page_url = format!("{HANGAR}/pages/main/{enc}");
    let page = http::cached(state, page_url.clone(), state.net.client.get(&page_url), "Hangar")
        .await
        .ok()
        .map(|b| String::from_utf8_lossy(&b).into_owned());
    parse_hangar_project(&b, page)
}
