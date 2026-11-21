use super::*;

#[derive(Debug, Clone, Serialize)]
pub struct PreviewFile {
    pub path: String,
    pub name: String,
    /// "added" | "updated" | "removed"
    pub change: String,
    /// Bisheriger Pfad (bei Updates mit neuem Dateinamen)
    pub old_path: Option<String>,
    pub side: Side,
}

#[derive(Debug, Clone, Serialize)]
pub struct PreviewOverride {
    pub path: String,
    /// "new" | "update" | "conflict" (Nutzer-Version bleibt) | "remove"
    pub status: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct ModpackPreview {
    pub current_version: Option<String>,
    pub target: ProjectVersion,
    pub mc_from: String,
    pub mc_to: String,
    pub loader_from: Loader,
    pub loader_to: Loader,
    pub files: Vec<PreviewFile>,
    pub unchanged: u32,
    pub overrides: Vec<PreviewOverride>,
    /// Vom Nutzer hinzugefügte Inhalte, die erhalten bleiben
    pub user_files: u32,
    /// Dateien, die manuell geladen werden müssen (CurseForge)
    pub missing: Vec<MissingDownload>,
    /// Instanz ohne gespeicherten Installationsstand (ältere Installation): Overrides gelten als verändert
    pub legacy: bool,
}

pub(super) fn file_name(rel: &str) -> String {
    rel.rsplit('/').next().unwrap_or(rel).to_string()
}

pub async fn preview(state: &AppState, instance_id: &str, version_id: Option<String>) -> AppResult<ModpackPreview> {
    let inst = state.instances.get(instance_id)?;
    let (rec, legacy) = record_or_fallback(state, &inst).ok_or_else(|| AppError::Invalid("Diese Instanz stammt nicht aus einem aktualisierbaren Modpack".into()))?;
    let (Some(source), Some(pid)) = (rec.source, rec.project_id.clone()) else { return Err(AppError::Invalid("Modpack-Quelle unbekannt".into())) };
    let t = load_target(state, source, &pid, version_id.as_deref()).await?;
    preview_target(state, inst, rec, legacy, t).await
}

pub(crate) async fn preview_target(state: &AppState, inst: Instance, rec: PackRecord, legacy: bool, t: Target) -> AppResult<ModpackPreview> {
    let st = state.clone();
    let inst2 = inst.clone();
    let rec2 = rec.clone();
    let (d, t) = tokio::task::spawn_blocking(move || {
        let d = diff(&st, &inst2, &rec2, legacy, &t);
        (d, t)
    })
    .await?;
    let _ = crate::content::sides::fill_modrinth_sides(state, &inst.id).await;
    let idx = ContentIndex::load(&state.paths, &inst.id);
    let title_of = |rel: &str| {
        let (folder, file) = rel.split_once('/').unwrap_or(("", rel));
        idx.files.get(&index::key(folder, file)).and_then(|e| e.title.clone()).unwrap_or_else(|| file_name(rel))
    };
    let side_of = |rel: &str, side: Option<Side>| {
        let (folder, file) = rel.split_once('/').unwrap_or(("", rel));
        side.or_else(|| idx.files.get(&index::key(folder, file)).and_then(|e| e.side)).unwrap_or(match ContentKind::from_folder(folder) {
            Some(ContentKind::Resourcepack | ContentKind::Shader) => Side::Client,
            _ => Side::Unknown,
        })
    };
    let mut files: Vec<PreviewFile> = d
        .add_or_update
        .iter()
        .map(|(f, old)| {
            let rel = norm_rel(&f.path);
            PreviewFile {
                name: old.as_deref().map(&title_of).unwrap_or_else(|| file_name(&rel)),
                change: if old.is_some() { "updated" } else { "added" }.into(),
                old_path: old.clone().filter(|o| index::strip_disabled(o) != rel),
                side: side_of(old.as_deref().map(index::strip_disabled).unwrap_or(&rel), f.side),
                path: rel,
            }
        })
        .collect();
    files.extend(d.removed.iter().map(|rel| PreviewFile { path: rel.clone(), name: title_of(rel), change: "removed".into(), old_path: None, side: side_of(rel, None) }));
    files.sort_by(|a, b| a.change.cmp(&b.change).then(a.path.cmp(&b.path)));
    Ok(ModpackPreview {
        current_version: rec.version_number.clone(),
        mc_from: inst.mc_version.clone(),
        mc_to: t.plan.mc_version.clone(),
        loader_from: inst.loader.clone(),
        loader_to: t.plan.loader.clone(),
        target: t.version.clone(),
        files,
        unchanged: d.unchanged,
        overrides: d.overrides,
        user_files: d.user_files,
        missing: t.missing.iter().map(|m| m.info.clone()).collect(),
        legacy,
    })
}

pub(super) fn index_entry(f: &PackFile) -> Option<(String, IndexEntry)> {
    let (source, pid, vid) = f.origin.clone()?;
    let rel = norm_rel(&f.path);
    let (folder, file) = rel.split_once('/')?;
    if ContentKind::from_folder(folder).is_none() || file.contains('/') {
        return None;
    }
    Some((
        index::key(folder, file),
        IndexEntry {
            source,
            project_id: pid,
            version_id: vid,
            sha1: f.sha1.clone(),
            sha512: None,
            title: None,
            icon_url: None,
            version_number: None,
            url: Some(f.url.clone()),
            size: f.size,
            date: None,
            release_type: None,
            side: f.side,
        },
    ))
}
