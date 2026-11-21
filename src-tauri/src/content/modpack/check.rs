use super::*;

pub(super) async fn pack_versions(state: &AppState, source: Source, project_id: &str) -> AppResult<Vec<ProjectVersion>> {
    let mut v: Vec<ProjectVersion> = match source {
        Source::Modrinth => mr::raw_versions(state, project_id).await?.into_iter().map(mr::convert_version).collect(),
        Source::Curseforge => {
            let files = cf::raw_files(state, project_id, None, None).await?;
            files.iter().filter(|f| f.is_server_pack != Some(true) && f.is_available != Some(false)).map(cf::convert_file).collect()
        }
        Source::Store(k) => crate::content::store::versions(state, k, project_id).await?.0,
    };
    v.sort_by(|a, b| b.date.cmp(&a.date));
    Ok(v)
}

#[derive(Debug, Clone, Serialize)]
pub struct ModpackUpdate {
    pub source: Source,
    pub project_id: String,
    pub current_version: Option<String>,
    pub current_version_id: Option<String>,
    pub latest: ProjectVersion,
}

/// Neuere Pack-Version vorhanden?
pub async fn check(state: &AppState, instance_id: &str) -> AppResult<Option<ModpackUpdate>> {
    let inst = state.instances.get(instance_id)?;
    let Some((rec, _)) = record_or_fallback(state, &inst) else { return Ok(None) };
    let (Some(source), Some(pid)) = (rec.source, rec.project_id.clone()) else { return Ok(None) };
    if source == Source::Curseforge && !cf::available(state) {
        return Ok(None);
    }
    let versions = pack_versions(state, source, &pid).await?;
    let current = rec.version_id.as_ref().and_then(|id| versions.iter().find(|v| &v.id == id));
    let only_release = current.map_or(true, |c| c.release_type == "release");
    let pool: Vec<ProjectVersion> = versions.iter().filter(|v| !only_release || v.release_type == "release").cloned().collect();
    let Some(latest) = provider::pick_best(&pool, None).or_else(|| versions.first().cloned()) else { return Ok(None) };
    let newer = match current {
        Some(c) => latest.id != c.id && latest.date > c.date,
        None => rec.version_id.as_deref() != Some(latest.id.as_str()),
    };
    Ok(newer.then(|| ModpackUpdate { source, project_id: pid, current_version: rec.version_number.clone(), current_version_id: rec.version_id.clone(), latest }))
}
