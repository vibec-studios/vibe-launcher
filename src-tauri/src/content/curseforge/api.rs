use super::*;

// ------------------------------------------------------------------ API

pub fn key(state: &AppState) -> AppResult<String> {
    state.settings().curseforge_key().ok_or_else(|| {
        AppError::NotConfigured("Für CurseForge wird ein API-Key benötigt. Du kannst ihn in den Einstellungen hinterlegen.".into())
    })
}

pub fn available(state: &AppState) -> bool {
    state.settings().curseforge_key().is_some()
}

pub(crate) async fn get<T: serde::de::DeserializeOwned>(state: &AppState, path_and_query: &str) -> AppResult<T> {
    let key = key(state)?;
    let url = format!("{API}{path_and_query}");
    let rb = state.net.client.get(&url).header("x-api-key", key).header("Accept", "application/json");
    let b = http::cached(state, url.clone(), rb, S).await?;
    http::parse(&b, S)
}

pub(super) async fn post<T: serde::de::DeserializeOwned>(state: &AppState, path: &str, body: &serde_json::Value) -> AppResult<T> {
    let key = key(state)?;
    let url = format!("{API}{path}");
    let cache_key = format!("POST {url} {body}");
    let rb = state.net.client.post(&url).header("x-api-key", key).header("Accept", "application/json").json(body);
    let b = http::cached(state, cache_key, rb, S).await?;
    http::parse(&b, S)
}

pub(super) fn query_string(p: &[(String, String)]) -> String {
    p.iter().map(|(k, v)| format!("{k}={}", urlencoding::encode(v))).collect::<Vec<_>>().join("&")
}

pub async fn search(state: &AppState, q: &SearchQuery) -> AppResult<SearchResult> {
    let params = search_params(q);
    let r: CfPage<CfMod> = get(state, &format!("/mods/search?{}", query_string(&params))).await?;
    let limit = q.limit.clamp(1, 50);
    Ok(SearchResult {
        hits: r.data.iter().map(mod_to_hit).collect(),
        // CurseForge liefert höchstens 10 000 Ergebnisse
        total: r.pagination.total_count.min(10_000),
        offset: q.offset,
        limit,
    })
}

pub async fn categories(state: &AppState, project_type: ProjectType) -> AppResult<Vec<Category>> {
    let r: CfData<Vec<CfCategory>> = get(state, &format!("/categories?gameId={GAME_ID}&classId={}", class_id(project_type))).await?;
    let mut v: Vec<Category> = r
        .data
        .into_iter()
        .filter(|c| c.is_class != Some(true))
        .map(|c| Category { id: c.id.to_string(), name: c.name, icon: c.icon_url.filter(|u| !u.is_empty()) })
        .collect();
    v.sort_by_key(|c| c.name.to_lowercase());
    Ok(v)
}

pub(super) fn parse_id(id: &str) -> AppResult<u64> {
    id.trim().parse().map_err(|_| AppError::Invalid(format!("Ungültige CurseForge-ID: {id}")))
}

pub async fn raw_mod(state: &AppState, id: &str) -> AppResult<CfMod> {
    let r: CfData<CfMod> = get(state, &format!("/mods/{}", parse_id(id)?)).await?;
    Ok(r.data)
}

/// Projekt per Slug aus einem curseforge.com-Link (`hint`: Projektart aus dem Link, sonst alle Arten).
pub async fn mod_by_slug(state: &AppState, slug: &str, hint: Option<ProjectType>) -> AppResult<Option<CfMod>> {
    let mut q = format!("/mods/search?gameId={GAME_ID}&slug={}", urlencoding::encode(slug));
    if let Some(t) = hint {
        q.push_str(&format!("&classId={}", class_id(t)));
    }
    let r: CfPage<CfMod> = get(state, &q).await?;
    Ok(r.data.into_iter().find(|m| m.slug.eq_ignore_ascii_case(slug)))
}

pub async fn raw_mods(state: &AppState, ids: &[u64]) -> AppResult<Vec<CfMod>> {
    let mut out = Vec::new();
    for chunk in ids.chunks(500) {
        let r: CfData<Vec<CfMod>> = post(state, "/mods", &json!({ "modIds": chunk, "filterPcOnly": true })).await?;
        out.extend(r.data);
    }
    Ok(out)
}

pub async fn raw_files_by_id(state: &AppState, ids: &[u64]) -> AppResult<Vec<CfFile>> {
    let mut out = Vec::new();
    for chunk in ids.chunks(500) {
        let r: CfData<Vec<CfFile>> = post(state, "/mods/files", &json!({ "fileIds": chunk })).await?;
        out.extend(r.data);
    }
    Ok(out)
}

pub async fn raw_file(state: &AppState, mod_id: &str, file_id: &str) -> AppResult<CfFile> {
    let r: CfData<CfFile> = get(state, &format!("/mods/{}/files/{}", parse_id(mod_id)?, parse_id(file_id)?)).await?;
    Ok(r.data)
}

/// Dateien eines Projekts (serverseitig nach Version/Loader gefiltert, max. 1000).
pub async fn raw_files(state: &AppState, mod_id: &str, mc: Option<&str>, loader: Option<LoaderKind>) -> AppResult<Vec<CfFile>> {
    let id = parse_id(mod_id)?;
    let mut out = Vec::new();
    let mut index = 0u32;
    // Quilt (Fabric-Dateien erlaubt) und NeoForge 1.20.1 (Forge-Dateien erlaubt): serverseitig nicht
    // nach Loader filtern, clientseitig prüfen
    let ml = loader
        .filter(|l| !(*l == LoaderKind::Neoforge && mc == Some("1.20.1")))
        .map(mod_loader_types)
        .filter(|v| v.len() == 1)
        .map(|v| v[0]);
    loop {
        let mut q = format!("/mods/{id}/files?index={index}&pageSize=50");
        if let Some(mc) = mc {
            q.push_str(&format!("&gameVersion={}", urlencoding::encode(mc)));
        }
        if let Some(ml) = ml {
            q.push_str(&format!("&modLoaderType={ml}"));
        }
        let page: CfPage<CfFile> = get(state, &q).await?;
        let n = page.data.len() as u32;
        out.extend(page.data);
        index += n;
        if n == 0 || index as u64 >= page.pagination.total_count || index >= 1000 {
            break;
        }
    }
    Ok(out)
}

pub async fn description(state: &AppState, id: &str) -> AppResult<String> {
    let r: CfData<String> = get(state, &format!("/mods/{}/description", parse_id(id)?)).await?;
    Ok(r.data)
}

pub async fn changelog(state: &AppState, mod_id: &str, file_id: &str) -> AppResult<String> {
    let r: CfData<String> = get(state, &format!("/mods/{}/files/{}/changelog", parse_id(mod_id)?, parse_id(file_id)?)).await?;
    Ok(r.data)
}

pub async fn project(state: &AppState, id: &str) -> AppResult<ProjectDetails> {
    let (m, body) = futures::future::join(raw_mod(state, id), description(state, id)).await;
    let m = m?;
    let body = body.unwrap_or_else(|_| format!("<p>{}</p>", m.summary));
    let hit = mod_to_hit(&m);
    Ok(ProjectDetails {
        body,
        body_format: "html".into(),
        gallery: m
            .screenshots
            .iter()
            .filter_map(|s| {
                Some(GalleryImage {
                    url: s.url.clone().or(s.thumbnail_url.clone())?,
                    title: s.title.clone().filter(|t| !t.is_empty()),
                    description: s.description.clone().filter(|t| !t.is_empty()),
                    featured: false,
                })
            })
            .collect(),
        links: ProjectLinks {
            website: None,
            source: m.links.source_url.clone().filter(|u| !u.is_empty()),
            issues: m.links.issues_url.clone().filter(|u| !u.is_empty()),
            wiki: m.links.wiki_url.clone().filter(|u| !u.is_empty()),
            discord: None,
        },
        license: None,
        published: m.date_released.clone().or(m.date_created.clone()),
        page_url: page_url(&m),
        hit,
    })
}

/// Fingerprints (Murmur2) -> exakte Treffer.
pub async fn fingerprints(state: &AppState, fps: &[u32]) -> AppResult<Vec<CfFingerprintMatch>> {
    let mut out = Vec::new();
    for chunk in fps.chunks(500) {
        let r: CfData<CfFingerprintResult> = post(state, &format!("/fingerprints/{GAME_ID}"), &json!({ "fingerprints": chunk })).await?;
        out.extend(r.data.exact_matches);
    }
    Ok(out)
}

/// Sortiert nach Datum, neueste zuerst.
pub fn sort_files(files: &mut [CfFile]) {
    files.sort_by(|a, b| b.file_date.cmp(&a.file_date));
}
