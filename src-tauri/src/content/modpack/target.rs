use super::*;

// ------------------------------------------------------------------ Ziel laden + Vergleich

pub(crate) struct Target {
    pub(crate) version: ProjectVersion,
    pub(crate) plan: PackPlan,
    pub(crate) zip: PathBuf,
    pub(crate) files: Vec<PackFile>,
    pub(crate) missing: Vec<MissingEntry>,
    pub(crate) overrides: BTreeMap<String, (String, u64)>,
}

pub(super) async fn load_target(state: &AppState, source: Source, project_id: &str, version_id: Option<&str>) -> AppResult<Target> {
    let versions = pack_versions(state, source, project_id).await?;
    let version = match version_id {
        Some(v) => versions.iter().find(|x| x.id == v).cloned().ok_or_else(|| AppError::NotFound(format!("Pack-Version {v}")))?,
        None => provider::pick_best(&versions, None).ok_or_else(|| AppError::NotFound("keine Pack-Version".into()))?,
    };
    let file = version
        .files
        .iter()
        .find(|f| f.primary && (f.filename.ends_with(".mrpack") || f.filename.ends_with(".zip") || f.filename.ends_with(".vlpack")))
        .or_else(|| version.files.iter().find(|f| f.filename.ends_with(".mrpack")))
        .or(version.files.first())
        .cloned()
        .ok_or_else(|| AppError::msg("Pack-Version ohne Datei"))?;
    let url = file.url.clone().ok_or_else(|| AppError::msg("Der Autor erlaubt keinen Download dieses Modpacks über andere Launcher"))?;
    let ext = Path::new(&file.filename).extension().and_then(|e| e.to_str()).unwrap_or("zip").to_string();
    let dir = state.paths.tmp().join("packs");
    let zip = dir.join(format!("{}-{}.{ext}", crate::paths::sanitize_file_name(&source.as_string()), crate::paths::sanitize_file_name(&version.id)));
    state.net.download_all(vec![DownloadItem::new(url, zip.clone()).sha1(file.sha1.clone()).size(Some(file.size).filter(|s| *s > 0))], None).await?;
    let zp = zip.clone();
    let plan = tokio::task::spawn_blocking(move || import::analyze(&zp)).await??;
    finish_target(state, version, plan, zip).await
}

pub(crate) async fn finish_target(state: &AppState, version: ProjectVersion, plan: PackPlan, zip: PathBuf) -> AppResult<Target> {
    let mut files = plan.files.clone();
    let mut missing_list = Vec::new();
    if !plan.cf_files.is_empty() {
        cf::key(state)?;
        let r = import::resolve_cf(state, &plan.cf_files).await?;
        files.extend(r.files);
        missing_list = r.missing;
    }
    let zp = zip.clone();
    let prefixes = plan.overrides.clone();
    let overrides = tokio::task::spawn_blocking(move || import::override_entries(&zp, &prefixes)).await??;
    Ok(Target { version, plan, zip, files, missing: missing_list, overrides })
}

pub(super) struct Diff {
    /// (neue Datei, alter Pfad falls ersetzt)
    pub(super) add_or_update: Vec<(PackFile, Option<String>)>,
    pub(super) removed: Vec<String>,
    pub(super) unchanged: u32,
    pub(super) overrides: Vec<PreviewOverride>,
    pub(super) user_files: u32,
}

pub(super) fn exists_any(game: &Path, rel: &str) -> Option<String> {
    let p = safe_join(game, rel)?;
    if p.exists() {
        return Some(rel.to_string());
    }
    let d = format!("{rel}.disabled");
    safe_join(game, &d).filter(|p| p.exists()).map(|_| d)
}

pub(super) fn sha1_of(path: &Path) -> Option<String> {
    crate::net::sha1_file(path).ok()
}

pub(super) fn diff(state: &AppState, inst: &Instance, rec: &PackRecord, legacy: bool, t: &Target) -> Diff {
    let game = state.paths.game_dir(&inst.id);
    let idx = ContentIndex::load(&state.paths, &inst.id);
    let mut old_by_proj: HashMap<String, String> = rec.files.iter().filter_map(|(rel, f)| f.project.clone().map(|p| (p, rel.clone()))).collect();
    let mut matched_old: HashSet<String> = HashSet::new();
    let mut out = Diff { add_or_update: vec![], removed: vec![], unchanged: 0, overrides: vec![], user_files: 0 };
    for f in &t.files {
        let rel = norm_rel(&f.path);
        let pk = proj_key(&f.origin);
        if let Some(old) = rec.files.get(&rel) {
            matched_old.insert(rel.clone());
            if old.sha1.is_some() && old.sha1 == f.sha1 && exists_any(&game, &rel).is_some() {
                out.unchanged += 1;
            } else {
                out.add_or_update.push((f.clone(), Some(rel.clone())));
            }
            continue;
        }
        if let Some(old_rel) = pk.as_ref().and_then(|p| old_by_proj.remove(p)) {
            matched_old.insert(old_rel.clone());
            out.add_or_update.push((f.clone(), Some(old_rel)));
            continue;
        }
        if legacy {
            // ohne Stand: gleicher Name vorhanden = unverändert, sonst gleiches Projekt im Index ersetzen
            if exists_any(&game, &rel).is_some() {
                out.unchanged += 1;
                continue;
            }
            if let Some((src, pid, _)) = &f.origin {
                if let Some(k) = idx.keys_of_project(*src, pid).into_iter().next() {
                    out.add_or_update.push((f.clone(), Some(k)));
                    continue;
                }
            }
        }
        out.add_or_update.push((f.clone(), None));
    }
    for rel in rec.files.keys() {
        if !matched_old.contains(rel) && exists_any(&game, rel).is_some() {
            out.removed.push(rel.clone());
        }
    }
    // Overrides
    for (rel, (new_sha, _)) in &t.overrides {
        let Some(p) = safe_join(&game, rel) else { continue };
        let disk = p.is_file().then(|| sha1_of(&p)).flatten();
        let status = match (&disk, rec.overrides.get(rel)) {
            (None, _) => "new",
            (Some(d), _) if d == new_sha => continue,
            (Some(d), Some(r)) if d == r && !legacy => "update",
            _ => "conflict",
        };
        out.overrides.push(PreviewOverride { path: rel.clone(), status: status.into() });
    }
    for (rel, recorded) in &rec.overrides {
        if t.overrides.contains_key(rel) {
            continue;
        }
        if let Some(p) = safe_join(&game, rel).filter(|p| p.is_file()) {
            if sha1_of(&p).as_deref() == Some(recorded.as_str()) {
                out.overrides.push(PreviewOverride { path: rel.clone(), status: "remove".into() });
            }
        }
    }
    // Nutzer-Inhalte: Dateien in Inhaltsordnern, die weder alt noch neu zum Pack gehören
    let new_rels: HashSet<String> = t.files.iter().map(|f| norm_rel(&f.path)).collect();
    for k in ContentKind::ALL {
        if let Ok(rd) = std::fs::read_dir(game.join(k.folder())) {
            for e in rd.flatten() {
                let rel = format!("{}/{}", k.folder(), index::strip_disabled(&e.file_name().to_string_lossy()));
                if !rec.files.contains_key(&rel) && !new_rels.contains(&rel) && !t.overrides.contains_key(&rel) {
                    out.user_files += 1;
                }
            }
        }
    }
    out
}
