use super::*;

// ------------------------------------------------------------------ 2. Plan (auflösen)

pub(super) fn report_path(state: &AppState, instance_id: &str) -> std::path::PathBuf {
    state.paths.instance_dir(instance_id).join(REPORT_FILE)
}

pub fn last_report(state: &AppState, instance_id: &str) -> Option<FixReport> {
    std::fs::read(report_path(state, instance_id)).ok().and_then(|b| serde_json::from_slice(&b).ok())
}

pub(super) fn last_crash(state: &AppState, instance_id: &str) -> Option<(Option<String>, Option<i32>)> {
    state.game.latest_crash(instance_id).map(|s| (s.crash_report, s.exit_code))
}

pub async fn quick(state: &AppState, instance_id: &str) -> AppResult<QuickCheck> {
    let inst = state.instances.get(instance_id)?;
    let issues = if inst.loader.kind == LoaderKind::Vanilla { vec![] } else { deps::check(state, instance_id, false).await? };
    let errors = issues.iter().filter(|i| i.severity == "error").count() as u32;
    Ok(QuickCheck { errors, warnings: issues.len() as u32 - errors, crashed: last_crash(state, instance_id).is_some() })
}

/// Neueste zur Instanz passende Version eines Projekts.
pub(super) async fn best(state: &AppState, inst: &Instance, source: Source, project_id: &str) -> Option<ProjectVersion> {
    install::best_version(state, inst, source, project_id).await.ok().flatten()
}

pub(super) fn primary(v: &ProjectVersion) -> Option<&crate::content::VersionFile> {
    v.files.iter().find(|f| f.primary).or(v.files.first())
}

/// Gesperrter Download (CurseForge ohne Freigabe und ohne identische Datei auf Modrinth)?
pub(super) async fn locked(state: &AppState, v: &ProjectVersion) -> bool {
    let Some(f) = primary(v) else { return false };
    if f.url.is_some() {
        return false;
    }
    match &f.sha1 {
        Some(h) => !mr::mirrors(state, std::slice::from_ref(h)).await.contains_key(&h.to_ascii_lowercase()),
        None => true,
    }
}
