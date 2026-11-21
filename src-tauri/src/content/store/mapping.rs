use super::*;

// ------------------------------------------------------------------ Mapping

pub(super) fn ptype(p: &StoreProject) -> ProjectType {
    crate::content::modrinth::project_type_from(p.project_type.as_deref().unwrap_or("mod"))
}

pub(super) fn version_key(s: &str) -> Vec<u64> {
    s.split(['.', '-']).map(|p| p.parse().unwrap_or(0)).collect()
}

pub(super) fn hit(key: StoreKey, file: &StoreFile, p: &StoreProject) -> ProjectHit {
    let mut gv: Vec<String> = Vec::new();
    let mut loaders: Vec<String> = Vec::new();
    for v in &p.versions {
        for g in &v.game_versions {
            if !gv.contains(g) {
                gv.push(g.clone());
            }
        }
        for l in &v.loaders {
            if !loaders.contains(l) {
                loaders.push(l.clone());
            }
        }
    }
    gv.sort_by_key(|v| std::cmp::Reverse(version_key(v)));
    let updated = p.updated.clone().or_else(|| p.versions.iter().map(|v| v.date.clone()).max());
    ProjectHit {
        source: Source::Store(key),
        id: p.id.clone(),
        slug: p.slug.clone().unwrap_or_else(|| p.id.clone()),
        title: p.title.clone(),
        description: p.description.clone(),
        author: p.author.clone().unwrap_or_else(|| file.name.clone()),
        icon_url: p.icon.clone().filter(|i| !i.is_empty()),
        downloads: p.downloads.unwrap_or(0),
        follows: 0,
        categories: p.categories.clone(),
        project_type: ptype(p),
        updated,
        game_versions: gv,
        loaders,
        banner_url: None,
        color: None,
        created: None,
        manual_download: false,
    }
}

pub(super) fn dep_kind(k: Option<&str>) -> DependencyKind {
    match k.unwrap_or("required") {
        "optional" => DependencyKind::Optional,
        "incompatible" => DependencyKind::Incompatible,
        "embedded" => DependencyKind::Embedded,
        _ => DependencyKind::Required,
    }
}

pub fn convert_version(key: StoreKey, p: &StoreProject, v: &StoreVersion) -> ProjectVersion {
    ProjectVersion {
        source: Source::Store(key),
        id: v.id.clone(),
        project_id: p.id.clone(),
        name: v.name.clone().unwrap_or_else(|| v.version_number.clone()),
        version_number: v.version_number.clone(),
        game_versions: v.game_versions.clone(),
        loaders: v.loaders.clone(),
        release_type: match v.release_type.as_deref() {
            Some("beta") => "beta",
            Some("alpha") => "alpha",
            _ => "release",
        }
        .into(),
        date: v.date.clone(),
        downloads: v.downloads.unwrap_or(0),
        files: v
            .files
            .iter()
            .enumerate()
            .map(|(i, f)| VersionFile {
                url: Some(f.url.clone()).filter(|u| !u.is_empty()),
                filename: if f.filename.is_empty() { f.url.rsplit('/').next().unwrap_or("download").to_string() } else { f.filename.clone() },
                size: f.size,
                sha1: f.sha1.clone().map(|s| s.to_ascii_lowercase()),
                primary: f.primary.unwrap_or(i == 0),
                sha512: f.sha512.clone(),
                fingerprint: None,
            })
            .collect(),
        dependencies: v
            .dependencies
            .iter()
            .map(|d| Dependency {
                project_id: Some(d.project_id.clone()),
                version_id: d.version_id.clone(),
                kind: dep_kind(d.kind.as_deref()),
                source: Some(match d.source.as_deref() {
                    Some("modrinth") => Source::Modrinth,
                    Some("curseforge") => Source::Curseforge,
                    _ => Source::Store(key),
                }),
            })
            .collect(),
        changelog: v.changelog.clone().filter(|c| !c.trim().is_empty()),
    }
}

/// Client/Server laut Store-Angabe.
pub fn project_side(p: &StoreProject) -> Option<Side> {
    if p.client_side.is_none() && p.server_side.is_none() {
        return None;
    }
    Some(crate::content::sides::from_sides(p.client_side.as_deref(), p.server_side.as_deref()))
}
