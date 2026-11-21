use super::*;

// ------------------------------------------------------------------ Suche

#[derive(Debug, Clone, Serialize)]
pub struct AddonHit {
    pub source: AddonSource,
    /// Modrinth-Projekt-ID bzw. Hangar „owner/slug“
    pub id: String,
    pub slug: String,
    pub title: String,
    pub description: String,
    pub author: String,
    pub icon_url: Option<String>,
    pub downloads: u64,
    pub updated: Option<String>,
    pub page_url: String,
    /// Passt das Projekt zu diesem Server (Loader/Plattform, Minecraft-Version, server_side)?
    pub compat: AddonCompat,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct AddonCompat {
    pub ok: bool,
    pub reason: Option<String>,
    pub version: Option<String>,
}

impl AddonCompat {
    pub fn ok() -> Self {
        AddonCompat { ok: true, reason: None, version: None }
    }
}

/// Kompatibilität eines Modrinth-Suchtreffers mit dem Server.
pub fn hit_compat(t: &AddonTarget, categories: &[String], versions: &[String], server_side: Option<&str>) -> AddonCompat {
    let no = |r: String| AddonCompat { ok: false, reason: Some(r), version: None };
    if !categories.is_empty() && !categories.iter().any(|c| t.loaders.contains(c)) {
        return no(format!("Nicht für {} verfügbar.", t.loaders.join("/")));
    }
    if !t.mc.is_empty() && !versions.is_empty() && !versions.contains(&t.mc) {
        return no(format!("Keine Version für Minecraft {}.", t.mc));
    }
    if !t.plugins && server_side == Some("unsupported") {
        return no("Läuft nur im Spiel (Client), nicht auf einem Server.".into());
    }
    AddonCompat { ok: true, reason: None, version: (!t.mc.is_empty()).then(|| t.mc.clone()) }
}

#[derive(Debug, Clone, Serialize)]
pub struct AddonSearch {
    pub hits: Vec<AddonHit>,
    pub total: u64,
    pub offset: u32,
}

/// Modrinth-Facets für die Suche.
pub fn modrinth_facets(t: &AddonTarget) -> String {
    let mut f: Vec<Vec<String>> = vec![vec![format!("project_type:{}", if t.plugins { "plugin" } else { "mod" })]];
    f.push(t.loaders.iter().map(|l| format!("categories:{l}")).collect());
    if !t.mc.is_empty() {
        f.push(vec![format!("versions:{}", t.mc)]);
    }
    if !t.plugins {
        f.push(vec!["server_side:required".into(), "server_side:optional".into()]);
    }
    serde_json::to_string(&f).unwrap_or_else(|_| "[]".into())
}

#[derive(Deserialize)]
pub(super) struct MrSearch {
    #[serde(default)]
    pub(super) hits: Vec<MrHit>,
    #[serde(default)]
    pub(super) total_hits: u64,
}

#[derive(Deserialize)]
pub(super) struct MrHit {
    pub(super) project_id: String,
    #[serde(default)]
    pub(super) categories: Vec<String>,
    #[serde(default)]
    pub(super) versions: Vec<String>,
    #[serde(default)]
    pub(super) server_side: Option<String>,
    #[serde(default)]
    pub(super) slug: Option<String>,
    #[serde(default)]
    pub(super) title: String,
    #[serde(default)]
    pub(super) description: String,
    #[serde(default)]
    pub(super) author: String,
    #[serde(default)]
    pub(super) icon_url: Option<String>,
    #[serde(default)]
    pub(super) downloads: u64,
    #[serde(default)]
    pub(super) date_modified: Option<String>,
}

#[derive(Deserialize)]
pub(super) struct HangarPage<T> {
    pub(super) pagination: HangarPagination,
    pub(super) result: Vec<T>,
}

#[derive(Deserialize)]
pub(super) struct HangarPagination {
    #[serde(default)]
    pub(super) count: u64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct HangarProject {
    pub(super) name: String,
    pub(super) namespace: HangarNamespace,
    #[serde(default)]
    pub(super) description: String,
    #[serde(default)]
    pub(super) avatar_url: Option<String>,
    #[serde(default)]
    pub(super) last_updated: Option<String>,
    #[serde(default)]
    pub(super) stats: HangarStats,
}

#[derive(Deserialize)]
pub(super) struct HangarNamespace {
    pub(super) owner: String,
    pub(super) slug: String,
}

#[derive(Deserialize, Default)]
pub(super) struct HangarStats {
    #[serde(default)]
    pub(super) downloads: u64,
}

pub fn parse_hangar_search(b: &[u8], offset: u32) -> AppResult<AddonSearch> {
    let p: HangarPage<HangarProject> = http::parse(b, "Hangar")?;
    Ok(AddonSearch {
        total: p.pagination.count,
        offset,
        hits: p
            .result
            .into_iter()
            .map(|h| AddonHit {
                source: AddonSource::Hangar,
                id: format!("{}/{}", h.namespace.owner, h.namespace.slug),
                page_url: hangar_page(&format!("{}/{}", h.namespace.owner, h.namespace.slug)),
                slug: h.namespace.slug,
                title: h.name,
                description: h.description,
                author: h.namespace.owner,
                icon_url: h.avatar_url.filter(|u| !u.contains("/avatars/default/")),
                downloads: h.stats.downloads,
                updated: h.last_updated,
                compat: AddonCompat::ok(),
            })
            .collect(),
    })
}

pub async fn search(state: &Core, s: &Server, source: AddonSource, query: &str, sort: &str, offset: u32) -> AppResult<AddonSearch> {
    let t = target(s).ok_or_else(|| AppError::Invalid("Vanilla-Server haben keine Plugins oder Mods.".into()))?;
    let limit = 20u32;
    match source {
        AddonSource::Modrinth => {
            let index = if sort == "downloads" { "downloads" } else if sort == "updated" { "updated" } else { "relevance" };
            let mut url = format!(
                "{}/search?facets={}&index={index}&offset={offset}&limit={limit}",
                mr::API,
                urlencoding::encode(&modrinth_facets(&t))
            );
            if !query.trim().is_empty() {
                url.push_str(&format!("&query={}", urlencoding::encode(query.trim())));
            }
            let b = http::cached(state, url.clone(), state.net.client.get(&url), "Modrinth").await?;
            let r: MrSearch = http::parse(&b, "Modrinth")?;
            Ok(AddonSearch {
                total: r.total_hits,
                offset,
                hits: r
                    .hits
                    .into_iter()
                    .map(|h| {
                        let slug = h.slug.unwrap_or_else(|| h.project_id.clone());
                        let compat = hit_compat(&t, &h.categories, &h.versions, h.server_side.as_deref());
                        AddonHit {
                            compat,
                            source: AddonSource::Modrinth,
                            page_url: modrinth_page(&slug, t.plugins),
                            id: h.project_id,
                            slug,
                            title: h.title,
                            description: h.description,
                            author: h.author,
                            icon_url: h.icon_url.filter(|u| !u.is_empty()),
                            downloads: h.downloads,
                            updated: h.date_modified,
                        }
                    })
                    .collect(),
            })
        }
        AddonSource::Hangar => {
            let platform = t.hangar.ok_or_else(|| AppError::Invalid("Hangar bietet für diese Server-Software keine Plugins an.".into()))?;
            let sort = if sort == "updated" { "-updated" } else if sort == "downloads" || query.trim().is_empty() { "-downloads" } else { "-stars" };
            let mut url = format!(
                "{HANGAR}/projects?limit={limit}&offset={offset}&platform={platform}&version={}&sort={sort}",
                urlencoding::encode(&t.mc)
            );
            if !query.trim().is_empty() {
                url.push_str(&format!("&q={}", urlencoding::encode(query.trim())));
            }
            let b = http::cached(state, url.clone(), state.net.client.get(&url), "Hangar").await?;
            parse_hangar_search(&b, offset)
        }
    }
}
