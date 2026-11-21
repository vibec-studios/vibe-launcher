use super::*;

pub(super) async fn prepare(state: &AppState, id: &str, version: &GameVersion) -> AppResult<Plan> {
    let mut target = state.instances.get(id)?;
    let before = GameVersion::from(&target);
    if target.is_bedrock()
        || version == &before
        || version.mc_version.is_empty()
        || (version.loader.kind != LoaderKind::Vanilla && version.loader.version.is_none())
    {
        return Err(AppError::Invalid(
            "Bitte eine andere Java-Version oder einen anderen Mod-Loader auswählen".into(),
        ));
    }
    target.mc_version = version.mc_version.clone();
    target.loader = version.loader.clone();
    let (scanned, idx) = local::refresh(state, id, ContentKind::Mod).await?;
    let mut files: Vec<_> = scanned
        .into_iter()
        .map(|scan| Existing {
            origin: idx.files.get(&scan.key).cloned(),
            pinned: idx.pinned.contains(&scan.key),
            scan,
        })
        .collect();
    files.sort_by(|a, b| b.scan.enabled.cmp(&a.scan.enabled).then_with(|| a.scan.file_name.cmp(&b.scan.file_name)));
    let checks: Vec<_> = files.iter().map(|f| resolve(state, &target, f, &files)).collect();
    let results = futures::stream::iter(checks)
        .buffered(6)
        .collect::<Vec<_>>()
        .await;
    let mut selected = Vec::<Selected>::new();
    let problems: Vec<_> = files
        .iter()
        .zip(results)
        .map(|(f, r)| r.and_then(|p| merge(&mut selected, p, f, &files)).err())
        .collect();
    let items: Vec<_> = files
        .iter()
        .zip(problems)
        .map(|(f, problem)| {
            let selected = f.project().and_then(|key| selected.iter().find(|s| project(&s.planned) == key));
            PreviewItem {
                file_name: f.scan.file_name.clone(),
                title: f
                    .origin
                    .as_ref()
                    .and_then(|o| o.title.clone())
                    .or_else(|| f.scan.meta.name.clone())
                    .unwrap_or_else(|| f.scan.file_name.clone()),
                version: selected.map(|s| s.planned.version.version_number.clone()),
                problem: if selected.is_some() { None } else { problem },
            }
        })
        .collect();
    let dependencies = selected
        .iter()
        .filter(|s| !files.iter().any(|f| f.project() == Some(project(&s.planned))))
        .map(|s| s.planned.brief.title.clone())
        .collect();
    let inventory: Vec<_> = files
        .iter()
        .map(|f| (&f.scan.file_name, f.scan.modified, f.scan.size, &f.scan.meta.sha1, f.project(), f.pinned))
        .collect();
    let targets: Vec<_> = selected
        .iter()
        .map(|s| {
            (
                project(&s.planned),
                &s.planned.version.id,
                file_name(&s.planned),
                &s.planned.file.sha1,
                s.enabled,
            )
        })
        .collect();
    let token = format!("{:x}", Sha1::digest(serde_json::to_vec(&(&before, version, inventory, targets, &items))?));
    Ok(Plan {
        before,
        files,
        selected,
        preview: Preview { token, items, dependencies },
    })
}

pub async fn preview(state: &AppState, id: &str, version: GameVersion) -> AppResult<Preview> {
    Ok(prepare(state, id, &version).await?.preview)
}
