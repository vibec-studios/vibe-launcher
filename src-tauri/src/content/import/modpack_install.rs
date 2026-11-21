use super::*;

/// Task-Körper von `modpack_install`.
pub async fn run_modpack_install(state: AppState, task: TaskHandle, source: Source, project_id: String, version_id: Option<String>) -> AppResult<()> {
    task.stage("Lade Modpack-Informationen …", None);
    let brief = provider::brief(&state, source, &project_id).await?;
    if brief.project_type != ProjectType::Modpack {
        return Err(AppError::Invalid(format!("{} ist kein Modpack", brief.title)));
    }
    task.set_title(format!("Modpack {} installieren", brief.title));
    let (version, file) = match source {
        Source::Modrinth => {
            let v = match &version_id {
                Some(v) => mr::convert_version(mr::raw_version(&state, v).await?),
                None => {
                    let mut list: Vec<ProjectVersion> = mr::raw_versions(&state, &brief.id).await?.into_iter().map(mr::convert_version).collect();
                    list.sort_by(|a, b| b.date.cmp(&a.date));
                    provider::pick_best(&list, None).ok_or_else(|| AppError::NotFound(format!("keine Version von {}", brief.title)))?
                }
            };
            let file = v
                .files
                .iter()
                .find(|f| f.primary && f.filename.ends_with(".mrpack"))
                .or_else(|| v.files.iter().find(|f| f.filename.ends_with(".mrpack")))
                .cloned()
                .ok_or_else(|| AppError::msg(format!("{} {}: keine .mrpack-Datei", brief.title, v.version_number)))?;
            (v, file)
        }
        Source::Curseforge => {
            cf::key(&state)?;
            let f = match &version_id {
                Some(v) => cf::raw_file(&state, &brief.id, v).await?,
                None => {
                    let mut files = cf::raw_files(&state, &brief.id, None, None).await?;
                    files.retain(|f| f.is_server_pack != Some(true) && f.is_available != Some(false));
                    cf::sort_files(&mut files);
                    files.iter().find(|f| f.release_type == 1).or(files.first()).cloned().ok_or_else(|| AppError::NotFound(format!("keine Datei von {}", brief.title)))?
                }
            };
            let v = cf::convert_file(&f);
            let file = v.files[0].clone();
            (v, file)
        }
        Source::Store(k) => {
            let v = match &version_id {
                Some(v) => crate::content::store::version(&state, k, &brief.id, v).await?,
                None => {
                    let (list, _) = crate::content::store::versions(&state, k, &brief.id).await?;
                    provider::pick_best(&list, None).ok_or_else(|| AppError::NotFound(format!("keine Version von {}", brief.title)))?
                }
            };
            let file = v.files.iter().find(|f| f.primary).or(v.files.first()).cloned().ok_or_else(|| AppError::msg(format!("{} {}: keine Datei", brief.title, v.version_number)))?;
            (v, file)
        }
    };
    let Some(url) = file.url.clone() else {
        return Err(AppError::msg(format!(
            "Der Autor von {} erlaubt keine Downloads über andere Launcher. Lade das Modpack auf {} herunter und importiere die Datei.",
            brief.title,
            format_args!("{}/files/{}", brief.page_url.trim_end_matches('/'), version.id)
        )));
    };
    task.check()?;
    let ext = match source {
        Source::Modrinth => "mrpack",
        Source::Curseforge => "zip",
        Source::Store(_) => file.filename.rsplit('.').next().filter(|e| ["mrpack", "zip", "vlpack"].contains(e)).unwrap_or("zip"),
    };
    let tmp = state.paths.tmp().join(format!("{}.{ext}", uuid::Uuid::new_v4()));
    task.stage(format!("Lade {} …", file.filename), Some(0.0));
    let dl = state
        .net
        .download_all(vec![DownloadItem::new(url, tmp.clone()).sha1(file.sha1.clone()).size(Some(file.size).filter(|s| *s > 0))], Some(&task.sub(0.0, 0.15)))
        .await;
    let res = match dl {
        Ok(()) => {
            let opts = ImportOptions {
                name: Some(brief.title.clone()),
                source: Some(PackSource {
                    kind: match source {
                        Source::Modrinth => PackSourceKind::Modrinth,
                        Source::Curseforge => PackSourceKind::Curseforge,
                        Source::Store(_) => PackSourceKind::Vlpack,
                    },
                    project_id: Some(brief.id.clone()),
                    version_id: Some(version.id.clone()),
                    name: Some(brief.title.clone()),
                    version_name: Some(version.version_number.clone()),
                }),
                icon_url: brief.icon_url.clone(),
                pack_source: Some(source),
            };
            run_import(&state, &task, &tmp, opts, task.sub(0.15, 1.0)).await.map(|_| ())
        }
        Err(e) => Err(e),
    };
    let _ = tokio::fs::remove_file(&tmp).await;
    res
}
