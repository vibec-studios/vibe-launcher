use super::*;

// ------------------------------------------------------------------ Manuelle Downloads

/// Datei, die „Auf CurseForge herunterladen“ öffnet: passende (bzw. gewählte) Version für die Instanz.
/// `downloadable`: doch automatisch ladbar (freigegeben oder identisch auf Modrinth).
pub async fn manual_target(state: &AppState, instance_id: &str, source: Source, project_id: &str, version_id: Option<&str>) -> AppResult<ManualTarget> {
    let inst = state.instances.get(instance_id)?;
    let brief = provider::brief(state, source, project_id).await?;
    let version = match version_id {
        Some(v) => provider::version(state, source, &brief.id, v).await?,
        None => best_version(state, &inst, source, &brief.id)
            .await?
            .ok_or_else(|| AppError::NotFound(format!("keine passende Version von {} für {}", brief.title, loader_label(&inst))))?,
    };
    let file = primary_file(&version).ok_or_else(|| AppError::msg(format!("{}: Version {} enthält keine Datei", brief.title, version.version_number)))?;
    let mut downloadable = file.url.is_some();
    if !downloadable {
        if let Some(h) = &file.sha1 {
            downloadable = mr::mirrors(state, std::slice::from_ref(h)).await.contains_key(&h.to_ascii_lowercase());
        }
    }
    let kind = provider::target_kind(brief.project_type, &version, inst.loader.kind, &inst.mc_version);
    let side = brief.side;
    let p = Planned { brief, source, kind, version, file, side };
    Ok(ManualTarget {
        page_url: manual_page(&p),
        file_name: crate::paths::sanitize_file_name(&p.file.filename),
        version_id: p.version.id.clone(),
        version_number: p.version.version_number.clone(),
        downloadable,
    })
}

/// CurseForge-Projekte der Instanz, deren Autor keine Downloads über andere Launcher erlaubt (Projekt-IDs).
pub async fn manual_projects(state: &AppState, instance_id: &str) -> AppResult<Vec<String>> {
    state.instances.get(instance_id)?;
    if !cf::available(state) {
        return Ok(vec![]);
    }
    let idx = ContentIndex::load(&state.paths, instance_id);
    let mut ids: Vec<u64> = idx.files.values().filter(|e| e.source == Source::Curseforge).filter_map(|e| e.project_id.parse().ok()).collect();
    ids.sort_unstable();
    ids.dedup();
    if ids.is_empty() {
        return Ok(vec![]);
    }
    let mods = cf::raw_mods(state, &ids).await?;
    Ok(mods.iter().filter(|m| cf::manual_only(m)).map(|m| m.id.to_string()).collect())
}
