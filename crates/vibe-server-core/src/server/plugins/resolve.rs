use super::*;

// ------------------------------------------------------------------ Versionen + Installation

/// Eine konkrete Datei, die installiert werden soll.
#[derive(Debug, Clone)]
pub struct Resolved {
    pub source: AddonSource,
    pub project_id: String,
    pub slug: Option<String>,
    pub title: Option<String>,
    pub icon_url: Option<String>,
    pub version_id: String,
    pub version_name: String,
    pub file_name: String,
    pub url: String,
    pub size: Option<u64>,
    pub sha1: Option<String>,
    pub sha256: Option<String>,
    /// Pflicht-Abhängigkeiten (Modrinth-Projekt-IDs)
    pub deps: Vec<String>,
}

pub(super) fn rank(version_type: &str) -> u8 {
    match version_type.to_ascii_lowercase().as_str() {
        "release" => 0,
        "beta" => 1,
        _ => 2,
    }
}

/// Beste Modrinth-Version: neueste Release, sonst Beta, sonst Alpha (API liefert neueste zuerst).
pub fn pick_modrinth(versions: &[mr::MrVersion], t: &AddonTarget) -> Option<mr::MrVersion> {
    let fits = |v: &&mr::MrVersion| v.loaders.iter().any(|l| t.loaders.contains(l)) && (t.mc.is_empty() || v.game_versions.contains(&t.mc));
    let mut c: Vec<&mr::MrVersion> = versions.iter().filter(fits).collect();
    c.sort_by(|a, b| rank(&a.version_type).cmp(&rank(&b.version_type)).then(b.date_published.cmp(&a.date_published)));
    c.first().map(|v| (*v).clone())
}

pub(super) async fn resolve_modrinth(state: &Core, t: &AddonTarget, project: &str) -> AppResult<Resolved> {
    let url = format!(
        "{}/project/{}/version?loaders={}&game_versions={}",
        mr::API,
        urlencoding::encode(project),
        urlencoding::encode(&serde_json::to_string(&t.loaders)?),
        urlencoding::encode(&serde_json::to_string(&[&t.mc])?)
    );
    let b = http::cached(state, url.clone(), state.net.client.get(&url), "Modrinth").await?;
    let versions: Vec<mr::MrVersion> = http::parse(&b, "Modrinth")?;
    let v = pick_modrinth(&versions, t).ok_or_else(|| {
        AppError::Invalid(format!("Keine passende Version für Minecraft {} ({}) gefunden.", t.mc, t.loaders.join("/")))
    })?;
    let p = mr::raw_project(state, &v.project_id).await.ok();
    resolved_from(&v, p.as_ref())
}

pub(super) fn resolved_from(v: &mr::MrVersion, p: Option<&mr::MrProject>) -> AppResult<Resolved> {
    let f = v.files.iter().find(|f| f.primary).or(v.files.first()).ok_or_else(|| AppError::msg("Version ohne Datei"))?;
    Ok(Resolved {
        source: AddonSource::Modrinth,
        project_id: v.project_id.clone(),
        slug: p.map(|p| p.slug.clone()),
        title: p.map(|p| p.title.clone()),
        icon_url: p.and_then(|p| p.icon_url.clone()).filter(|u| !u.is_empty()),
        version_id: v.id.clone(),
        version_name: v.version_number.clone(),
        file_name: f.filename.clone(),
        url: f.url.clone(),
        size: Some(f.size).filter(|s| *s > 0),
        sha1: f.hashes.sha1.clone(),
        sha256: None,
        deps: v.dependencies.iter().filter(|d| d.dependency_type == "required").filter_map(|d| d.project_id.clone()).collect(),
    })
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct HangarVersion {
    pub(super) name: String,
    #[serde(default)]
    pub(super) created_at: String,
    pub(super) channel: HangarChannel,
    #[serde(default)]
    pub(super) downloads: HashMap<String, HangarDownload>,
}

#[derive(Deserialize)]
pub(super) struct HangarChannel {
    pub(super) name: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct HangarDownload {
    #[serde(default)]
    pub(super) file_info: Option<HangarFileInfo>,
    #[serde(default)]
    pub(super) download_url: Option<String>,
    #[serde(default)]
    pub(super) external_url: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct HangarFileInfo {
    pub(super) name: String,
    #[serde(default)]
    pub(super) size_bytes: Option<u64>,
    #[serde(default)]
    pub(super) sha256_hash: Option<String>,
}

/// Gewählte Hangar-Version: (Versionsname, Download-URL, Dateiname, Größe, SHA-256).
pub type HangarPick = (String, String, String, Option<u64>, Option<String>);

/// Hangar-Versionen: „Release“-Kanal bevorzugt, sonst neueste. Externe Downloads gehen nicht.
pub fn pick_hangar(b: &[u8], platform: &str) -> AppResult<Option<HangarPick>> {
    let p: HangarPage<HangarVersion> = http::parse(b, "Hangar")?;
    let mut list: Vec<&HangarVersion> = p.result.iter().filter(|v| v.downloads.contains_key(platform)).collect();
    list.sort_by(|a, b| {
        let ra = !a.channel.name.eq_ignore_ascii_case("release");
        let rb = !b.channel.name.eq_ignore_ascii_case("release");
        ra.cmp(&rb).then(b.created_at.cmp(&a.created_at))
    });
    let Some(v) = list.first() else { return Ok(None) };
    let d = &v.downloads[platform];
    let Some(url) = d.download_url.clone() else {
        return Err(AppError::Invalid(match &d.external_url {
            Some(u) => format!("Diese Version gibt es nur extern ({u}) – bitte dort herunterladen."),
            None => "Diese Version hat keinen Download.".into(),
        }));
    };
    let fi = d.file_info.as_ref();
    Ok(Some((
        v.name.clone(),
        url,
        fi.map(|f| f.name.clone()).unwrap_or_else(|| format!("{}.jar", v.name)),
        fi.and_then(|f| f.size_bytes),
        fi.and_then(|f| f.sha256_hash.clone()),
    )))
}

pub(super) async fn resolve_hangar(state: &Core, t: &AddonTarget, project: &str, fresh: bool) -> AppResult<Resolved> {
    let platform = t.hangar.ok_or_else(|| AppError::Invalid("Hangar bietet für diese Server-Software keine Plugins an.".into()))?;
    let slug = project.rsplit('/').next().unwrap_or(project);
    let url = format!(
        "{HANGAR}/projects/{}/versions?limit=25&offset=0&platform={platform}&platformVersion={}",
        urlencoding::encode(slug),
        urlencoding::encode(&t.mc)
    );
    let b = if fresh { http::send(state.net.client.get(&url), "Hangar").await? } else { http::cached(state, url.clone(), state.net.client.get(&url), "Hangar").await? };
    let (name, dl, file, size, sha256) =
        pick_hangar(&b, platform)?.ok_or_else(|| AppError::Invalid(format!("Keine Hangar-Version für Minecraft {} gefunden.", t.mc)))?;
    let purl = format!("{HANGAR}/projects/{}", urlencoding::encode(slug));
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct P {
        name: String,
        namespace: HangarNamespace,
        #[serde(default)]
        avatar_url: Option<String>,
    }
    let p: Option<P> = http::cached(state, purl.clone(), state.net.client.get(&purl), "Hangar").await.ok().and_then(|b| serde_json::from_slice(&b).ok());
    Ok(Resolved {
        source: AddonSource::Hangar,
        project_id: p.as_ref().map(|p| format!("{}/{}", p.namespace.owner, p.namespace.slug)).unwrap_or_else(|| project.to_string()),
        slug: p.as_ref().map(|p| format!("{}/{}", p.namespace.owner, p.namespace.slug)),
        title: p.as_ref().map(|p| p.name.clone()),
        icon_url: p.and_then(|p| p.avatar_url).filter(|u| !u.contains("/avatars/default/")),
        version_id: name.clone(),
        version_name: name,
        file_name: file,
        url: dl,
        size,
        sha1: None,
        sha256: sha256.map(|s| s.to_ascii_lowercase()),
        deps: vec![],
    })
}

pub(super) fn safe_file_name(n: &str) -> String {
    let n: String = n.chars().map(|c| if c.is_control() || "\\/:*?\"<>|".contains(c) { '_' } else { c }).collect();
    let n = n.trim().trim_start_matches('.').to_string();
    if n.to_ascii_lowercase().ends_with(".jar") { n } else { format!("{n}.jar") }
}

/// Datei laden, prüfen, alte Datei desselben Projekts ersetzen, Index aktualisieren.
pub(super) async fn place(state: &Core, s: &Server, t: &AddonTarget, r: &Resolved, replace: Option<&str>) -> AppResult<String> {
    let sdir = server_dir(&state.paths, &s.id);
    let dir = sdir.join(t.folder);
    tokio::fs::create_dir_all(&dir).await?;
    let file = safe_file_name(&r.file_name);
    let keep_disabled = replace.is_some_and(|f| f.ends_with(".disabled"));
    let final_name = if keep_disabled { format!("{file}.disabled") } else { file.clone() };
    let tmp = dir.join(format!(".{file}.part"));
    let _ = tokio::fs::remove_file(&tmp).await;
    let item = DownloadItem::new(&r.url, &tmp).sha1(r.sha1.clone()).size(r.size);
    state.net.download_all(vec![item], None).await?;
    if let Some(want) = &r.sha256 {
        let t2 = tmp.clone();
        let got = tokio::task::spawn_blocking(move || crate::net::sha256_file(&t2)).await??;
        if !got.eq_ignore_ascii_case(want) {
            let _ = tokio::fs::remove_file(&tmp).await;
            return Err(AppError::msg(format!("{}: Prüfsumme stimmt nicht – Download beschädigt.", r.file_name)));
        }
    }
    if let Some(old) = replace {
        if base_name(old) != file {
            if let Some(p) = crate::util::safe_join(&dir, old) {
                let _ = tokio::fs::remove_file(p).await;
            }
        }
    }
    let dst = dir.join(&final_name);
    let _ = tokio::fs::remove_file(&dst).await;
    tokio::fs::rename(&tmp, &dst).await?;
    let mut idx = load_index(&sdir);
    if let Some(old) = replace {
        idx.remove(base_name(old));
    }
    idx.insert(
        file.clone(),
        IndexEntry {
            source: Some(r.source),
            project_id: Some(r.project_id.clone()),
            slug: r.slug.clone(),
            version_id: Some(r.version_id.clone()),
            version_name: Some(r.version_name.clone()),
            title: r.title.clone(),
            icon_url: r.icon_url.clone(),
        },
    );
    save_index(&sdir, &idx)?;
    Ok(final_name)
}
