use super::*;

pub(super) fn project(p: &install::Planned) -> Project {
    (p.source, p.brief.id.clone())
}

pub(super) fn file_name(p: &install::Planned) -> String {
    crate::paths::sanitize_file_name(&p.file.filename)
}

pub(super) fn mod_version(p: &install::Planned, target: &Instance) -> bool {
    p.kind == ContentKind::Mod
        && target.loader.kind != LoaderKind::Vanilla
        && provider::compatible(&p.version, p.brief.project_type, &target.mc_version, target.loader.kind)
        && ["jar", "zip", "litemod"]
            .iter()
            .any(|ext| Path::new(&file_name(p)).extension().is_some_and(|e| e.eq_ignore_ascii_case(ext)))
}

pub(super) fn existing_download<'a>(p: &install::Planned, files: &'a [Existing]) -> Option<&'a Path> {
    let key = project(p);
    files
        .iter()
        .find(|file| {
            file.project().as_ref() == Some(&key)
                && file.origin.as_ref().is_some_and(|e| e.version_id == p.version.id)
                && p.file
                    .sha1
                    .as_ref()
                    .map_or(true, |sha| file.scan.meta.sha1.as_ref().is_some_and(|local| local.eq_ignore_ascii_case(sha)))
        })
        .map(|file| file.scan.path.as_path())
}

pub(super) async fn resolve(state: &AppState, target: &Instance, file: &Existing, files: &[Existing]) -> Result<Vec<install::Planned>, Problem> {
    let origin = file.origin.as_ref().ok_or(Problem::Unknown)?;
    let loader = target.loader.kind;
    if loader == LoaderKind::Vanilla {
        return Err(Problem::Unavailable);
    }
    let mc = &target.mc_version;
    let (mut versions, preferred, kind) = provider::versions_for(state, origin.source, &origin.project_id, Some(mc), Some(loader))
        .await
        .map_err(|e| {
            if matches!(e, AppError::NotFound(_)) {
                Problem::Unavailable
            } else {
                Problem::CheckFailed
            }
        })?;
    versions.retain(|v| kind != ProjectType::Modpack && provider::target_kind(kind, v, loader, mc) == ContentKind::Mod && !v.files.is_empty());
    let version = versions
        .iter()
        .find(|v| v.id == origin.version_id)
        .cloned()
        .or_else(|| (!file.pinned).then(|| provider::pick_best(&versions, preferred.as_deref())).flatten())
        .ok_or(if file.pinned { Problem::Pinned } else { Problem::Unavailable })?;

    let mut warnings = vec![];
    let root = (origin.source, origin.project_id.clone(), Some(version.id));
    let mut planned = install::plan(state, target, &ContentIndex::default(), vec![root], &mut warnings)
        .await
        .map_err(|_| Problem::CheckFailed)?;
    if !warnings.is_empty() || planned.is_empty() || planned.iter().any(|p| !mod_version(p, target)) {
        return Err(Problem::Dependencies);
    }
    for p in &planned {
        for dep in p.version.dependencies.iter().filter(|d| d.kind == DependencyKind::Required) {
            let source = dep.source.unwrap_or(p.source);
            if !planned.iter().any(|d| {
                d.source == source
                    && dep.project_id.as_ref().map_or(true, |id| id == &d.brief.id)
                    && dep.version_id.as_ref().map_or(true, |id| id == &d.version.id)
                    && (dep.project_id.is_some() || dep.version_id.is_some())
            }) {
                return Err(Problem::Dependencies);
            }
        }
    }
    let hashes: Vec<_> = planned
        .iter()
        .filter(|p| p.file.url.is_none() && existing_download(p, files).is_none())
        .filter_map(|p| p.file.sha1.clone())
        .collect();
    let mirrors = modrinth::mirrors(state, &hashes).await;
    for p in &mut planned {
        if p.file.url.is_none() {
            p.file.url = p.file.sha1.as_ref().and_then(|h| mirrors.get(&h.to_ascii_lowercase())).map(|m| m.url.clone());
        }
    }
    if planned.iter().any(|p| p.file.url.is_none() && existing_download(p, files).is_none()) {
        return Err(Problem::Manual);
    }
    Ok(planned)
}

pub(super) fn merge(selected: &mut Vec<Selected>, incoming: Vec<install::Planned>, file: &Existing, files: &[Existing]) -> Result<(), Problem> {
    let mut names = HashMap::new();
    for p in &incoming {
        let key = project(p);
        let name = file_name(p);
        if names.insert(name.to_lowercase(), &p.brief.id).is_some()
            || files.iter().any(|f| {
                f.project().as_ref() != Some(&key) && index::strip_disabled(&f.scan.file_name).eq_ignore_ascii_case(&name)
                    || f.project().as_ref() == Some(&key) && f.pinned && f.origin.as_ref().is_some_and(|e| e.version_id != p.version.id)
            })
            || selected.iter().any(|s| {
                let other = &s.planned;
                if project(other) == key {
                    other.version.id != p.version.id
                } else {
                    file_name(other).eq_ignore_ascii_case(&name)
                }
            })
        {
            return Err(Problem::Conflict);
        }
    }
    for planned in incoming {
        if let Some(s) = selected.iter_mut().find(|s| project(&s.planned) == project(&planned)) {
            s.enabled |= file.scan.enabled;
        } else {
            selected.push(Selected {
                planned,
                enabled: file.scan.enabled,
            });
        }
    }
    Ok(())
}
